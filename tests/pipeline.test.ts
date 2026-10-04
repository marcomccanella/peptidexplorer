import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ACCESSION_RE, PEPTIDE_RE } from "../src/features/analysis/model/types.ts";
import {
  classifyBacDiveEntries,
  classifyBacDiveSpecies,
  classifyFallbackList,
  classifySpeciesList,
  diseaseEvidence,
} from "../src/features/analysis/server/classification.ts";
import {
  paginationUrl,
  request,
  retryAfterSeconds,
  type Fetcher,
} from "../src/features/analysis/server/http.ts";
import {
  entryToHit,
  flanksOf,
  loadPeptideDetails,
  matchPositions,
  parseAccessions,
  phylumOf,
  pollPeptide,
  submitPeptide,
  type UniProtEntry,
} from "../src/features/analysis/server/uniprot.ts";

const peptide = "ACDEFGH";
const jobId = "PM20261004abcdef1234567890";
const json = (payload: unknown, headers?: HeadersInit) =>
  new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json", ...headers },
  });
const entry = (
  accession = "P00803",
  sequence = `IIIIIIIIIIIIIII${peptide}LLLLLLLLLLLLLLL`,
): UniProtEntry => ({
  primaryAccession: accession,
  entryType: "UniProtKB reviewed (Swiss-Prot)",
  organism: {
    scientificName: "Escherichia coli (strain K12)",
    taxonId: 83333,
    lineage: ["Bacteria", "Pseudomonadati", "Pseudomonadota", "Gammaproteobacteria"],
  },
  sequence: { value: sequence },
  proteinDescription: { recommendedName: { fullName: { value: "Example protein" } } },
});

test("HTTP requests retry temporary failures, honor Retry-After and always have a deadline", async () => {
  const pauses: number[] = [];
  let calls = 0;
  const fetcher: Fetcher = async (_url, init) => {
    assert.ok(init?.signal);
    calls++;
    if (calls === 1) return new Response(null, { status: 503, headers: { "Retry-After": "2" } });
    if (calls === 2) throw new TypeError("network dropped");
    return json({ ok: true });
  };
  const result = await request(
    "https://example.org",
    {},
    {
      fetcher,
      sleep: async (ms) => {
        pauses.push(ms);
      },
    },
  );
  assert.equal(result.status, 200);
  assert.equal(calls, 3);
  assert.deepEqual(pauses, [2000, 2000]);
});

test("HTTP client does not retry input errors and fails after bounded network retries", async () => {
  let calls = 0;
  const response = await request(
    "https://example.org",
    {},
    {
      fetcher: async () => {
        calls++;
        return new Response(null, { status: 400 });
      },
    },
  );
  assert.equal(response.status, 400);
  assert.equal(calls, 1);
  await assert.rejects(
    request(
      "https://example.org",
      {},
      {
        fetcher: async () => {
          throw new Error("offline");
        },
        attempts: 2,
        sleep: async () => {},
      },
    ),
    /internet connection/,
  );
  assert.equal(retryAfterSeconds(new Response(null, { headers: { "Retry-After": "99999" } })), 60);
});

test("API pagination rejects off-host or unexpected-path links", () => {
  assert.equal(
    paginationUrl(
      "?cursor=two",
      "https://rest.uniprot.org/uniprotkb/search?cursor=one",
      "https://rest.uniprot.org/uniprotkb/search",
    ),
    "https://rest.uniprot.org/uniprotkb/search?cursor=two",
  );
  assert.throws(
    () =>
      paginationUrl(
        "https://example.org/private",
        "https://rest.uniprot.org/uniprotkb/search",
        "https://rest.uniprot.org/uniprotkb/search",
      ),
    /unexpected pagination/,
  );
});

test("submission searches peptides without an exact-taxid filter and validates the accepted job", async () => {
  const fetcher: Fetcher = async (url, init) => {
    assert.equal(String(url), "https://peptidesearch.uniprot.org/asyncrest/");
    assert.equal(init?.redirect, "manual");
    const params = init?.body as URLSearchParams;
    assert.equal(params.get("peps"), peptide);
    // The peptide API matches taxIds exactly; bacteria are filtered by lineage in the REST stage.
    assert.equal(params.get("taxIds"), null);
    assert.equal(params.get("lEQi"), "on");
    assert.equal(params.get("spOnly"), "off");
    return new Response(null, { status: 202, headers: { Location: `/asyncrest/jobs/${jobId}` } });
  };
  assert.deepEqual(await submitPeptide({ peptide, il: true, spOnly: false }, { fetcher }), {
    jobId,
    busy: false,
    retryAfterSeconds: 4,
  });
  const legacyLocation = await submitPeptide(
    { peptide, il: false, spOnly: false },
    {
      fetcher: async () =>
        new Response(null, {
          status: 202,
          headers: { Location: `http://peptidesearch.uniprot.org/asyncrest/jobs/${jobId}` },
        }),
    },
  );
  assert.equal(legacyLocation.jobId, jobId);
  await assert.rejects(
    submitPeptide({ peptide: "ABCDEFG", il: false, spOnly: false }, { fetcher }),
    /standard amino/,
  );
  await assert.rejects(
    submitPeptide(
      { peptide, il: false, spOnly: false },
      {
        fetcher: async () =>
          new Response(null, {
            status: 202,
            headers: { Location: `https://example.org/asyncrest/jobs/${jobId}` },
          }),
      },
    ),
    /invalid search job/,
  );
});

test("submission distinguishes transient unavailability from a permanent rejection", async () => {
  const busy = await submitPeptide(
    { peptide, il: false, spOnly: false },
    { fetcher: async () => new Response(null, { status: 503, headers: { "Retry-After": "20" } }) },
  );
  assert.equal(busy.busy, true);
  assert.equal(busy.retryAfterSeconds, 20);
  await assert.rejects(
    submitPeptide(
      { peptide, il: false, spOnly: false },
      { fetcher: async () => new Response(null, { status: 400 }) },
    ),
    /HTTP 400/,
  );
});

test("polling treats UniProt's documented 303 as running and respects its retry delay", async () => {
  const result = await pollPeptide(jobId, {
    fetcher: async (_url, init) => {
      assert.equal(init?.redirect, "manual");
      return new Response(null, {
        status: 303,
        headers: { "Retry-After": "30", Location: `/asyncrest/jobs/${jobId}` },
      });
    },
  });
  assert.deepEqual(result, { done: false, accessions: [], retryAfterSeconds: 30 });
});

test("completed jobs preserve isoforms, remove duplicates and accept only genuine accession payloads", async () => {
  assert.deepEqual(parseAccessions("P00803,A0A024R3X4,P00803,P63038-2\nO07595"), [
    "P00803",
    "A0A024R3X4",
    "P63038-2",
    "O07595",
  ]);
  assert.deepEqual(await pollPeptide(jobId, { fetcher: async () => new Response(" ") }), {
    done: true,
    accessions: [],
    retryAfterSeconds: 0,
  });
  await assert.rejects(
    pollPeptide(jobId, { fetcher: async () => new Response("<html>Maintenance</html>") }),
    /unexpected peptide-search response/,
  );
  await assert.rejects(
    pollPeptide(jobId, { fetcher: async () => new Response(null, { status: 404 }) }),
    /expired/,
  );
  assert.equal(ACCESSION_RE.test("Z12345"), false);
  assert.equal(PEPTIDE_RE.test("XXXXXXX"), false);
});

test("matches include overlaps and every occurrence, including signal matches beyond the fifth", () => {
  assert.deepEqual(matchPositions("AAAAAAAAAA", "AAAAAAA", false), [0, 1, 2, 3]);
  const sequence = `${peptide}I`.repeat(7);
  const protein = entry("P00803", sequence);
  protein.features = [{ type: "Signal", location: { start: { value: 49 }, end: { value: 55 } } }];
  const hit = entryToHit(protein, peptide, false)!;
  assert.equal(hit.positions.split(";").length, 7);
  assert.equal(hit.inSignal, true);
});

test("I/L equivalence finds matches without rewriting the flanking sequence", () => {
  assert.deepEqual(matchPositions("MALLLLLM", "AILLLLM", false), []);
  assert.deepEqual(matchPositions("MALLLLLM", "AILLLLM", true), [1]);
  assert.deepEqual(flanksOf(`IIIIIIIIIIIIIII${peptide}LLLLLLLLLLLLLLL`, peptide, true), [
    "IIIIIIIIIIIIIIILLLLLLLLLLLLLLL",
  ]);
  assert.deepEqual(flanksOf(peptide, peptide, false), []);
});

test("protein mapping excludes nonbacteria and stale nonmatching entries, resolves phylum rank and all COG categories", () => {
  const protein = entry();
  protein.features = [{ type: "Lipidation" }];
  protein.uniProtKBCrossReferences = [{ database: "eggNOG", id: "COG0028" }];
  const hit = entryToHit(protein, peptide, false)!;
  assert.equal(hit.phylum, "Pseudomonadota");
  assert.equal(hit.location, "Anchored to membrane");
  assert.equal(hit.reviewed, true);
  assert.match(hit.cog, /Amino acid.*; Coenzyme/);
  assert.equal(phylumOf(["Bacteria", "Bacillati", "Bacillota"]), "Bacillota");
  assert.equal(entryToHit({ ...protein, sequence: { value: "MMMMMMM" } }, peptide, false), null);
  assert.equal(
    entryToHit({ ...protein, organism: { lineage: ["Eukaryota"] } }, peptide, false),
    null,
  );
});

test("protein details follow UniProt Link pagination and deduplicate entries", async () => {
  let calls = 0;
  const fetcher: Fetcher = async (url) => {
    calls++;
    if (calls === 1) {
      assert.doesNotMatch(decodeURIComponent(String(url)), /taxonomy_id:/);
      return json(
        { results: [entry()] },
        { Link: '<https://rest.uniprot.org/uniprotkb/search?cursor=page2>; rel="next"' },
      );
    }
    assert.match(String(url), /cursor=page2/);
    return json({ results: [entry(), entry("O07595")] });
  };
  const result = await loadPeptideDetails(
    { peptide, il: false, accessions: ["P00803", "O07595", "P00803"] },
    { fetcher },
  );
  assert.equal(calls, 2);
  assert.deepEqual(
    result.hits.map((hit) => hit.accession),
    ["O07595", "P00803"],
  );
  assert.deepEqual(result.warnings, []);
});

test("isoforms use their own sequence and never inherit canonical signal coordinates", async () => {
  const canonical = entry("P00803", "MMMMMMMMMMMMMMMMMMMM");
  canonical.features = [{ type: "Signal", location: { start: { value: 1 }, end: { value: 20 } } }];
  const result = await loadPeptideDetails(
    { peptide, il: false, accessions: ["P00803-2"] },
    {
      fetcher: async (url) =>
        String(url).endsWith(".fasta")
          ? new Response(`>isoform\nMMM${peptide}MMM\n`)
          : json({ results: [canonical] }),
    },
  );
  assert.equal(result.hits[0]?.accession, "P00803-2");
  assert.equal(result.hits[0]?.positions, "4-10");
  assert.equal(result.hits[0]?.signal, false);
  assert.equal(result.warnings.length, 1);
});

test("missing protein sequences fail visibly and release mismatches produce an explicit warning", async () => {
  await assert.rejects(
    loadPeptideDetails(
      { peptide, il: false, accessions: ["P00803"] },
      { fetcher: async () => json({ results: [{ ...entry(), sequence: {} }] }) },
    ),
    /omitted the sequence/,
  );
  const mismatch = await loadPeptideDetails(
    { peptide, il: false, accessions: ["P00803"] },
    { fetcher: async () => json({ results: [entry("P00803", "MMMMMMMMMMM")] }) },
  );
  assert.deepEqual(mismatch.hits, []);
  assert.match(mismatch.warnings[0] ?? "", /different releases/);
});

test("missing requested records warn while returned nonbacterial records are excluded without implying missing coverage", async () => {
  const nonbacterial = {
    ...entry("O07595"),
    organism: {
      scientificName: "Example eukaryote",
      taxonId: 999,
      lineage: ["Eukaryota", "Fungi"],
    },
  };
  const result = await loadPeptideDetails(
    { peptide, il: false, accessions: ["P00803", "O07595", "P00644"] },
    { fetcher: async () => json({ results: [entry(), nonbacterial] }) },
  );
  assert.deepEqual(
    result.hits.map((hit) => hit.accession),
    ["P00803"],
  );
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0] ?? "", /did not return 1 requested protein record: P00644/);
  assert.doesNotMatch(result.warnings[0] ?? "", /O07595/);
  const filtered = await loadPeptideDetails(
    { peptide, il: false, accessions: ["O07595"] },
    { fetcher: async () => json({ results: [nonbacterial] }) },
  );
  assert.deepEqual(filtered, { hits: [], warnings: [] });
  const missingLineage = await loadPeptideDetails(
    { peptide, il: false, accessions: ["P00803"] },
    {
      fetcher: async () =>
        json({ results: [{ ...entry(), organism: { scientificName: "Unresolved taxon" } }] }),
    },
  );
  assert.deepEqual(missingLineage.hits, []);
  assert.match(missingLineage.warnings[0] ?? "", /omitted the taxonomy lineage/);
});

test("biosafety level 1 is not commensal evidence; explicit pathogenicity and higher levels remain visible", () => {
  const low = classifyBacDiveEntries("Bacillus subtilis", [{ "biosafety level": "1" }], [1], 400);
  assert.equal(low.category, "Unclassified");
  assert.equal(low.bsl, 1);
  assert.match(low.note!, /1 of 400/);
  assert.match(low.note!, /does not establish commensalism/);
  const high = classifyBacDiveEntries(
    "Example bacterium",
    [{ risk: [{ biosafety_level: "1; 2" }, { pathogenicity_human: "yes" }] }],
    [1],
  );
  assert.equal(high.category, "Potential Pathogenic");
  assert.equal(high.bsl, 2);
  assert.match(high.evidence!, /Human or animal pathogenicity/);
});

test("BacDive uses public v2 endpoints, bounds strain sampling and reports it", async () => {
  const ids = Array.from({ length: 100 }, (_, index) => index + 1);
  const fetcher: Fetcher = async (url, init) => {
    assert.equal(new Headers(init?.headers).has("Authorization"), false);
    assert.match(String(url), /api\.bacdive\.dsmz\.de\/v2\//);
    if (String(url).includes("/taxon/")) return json({ count: 350, next: "?page=1", results: ids });
    const requested = String(url).split("/fetch/")[1]!.split(";");
    assert.equal(requested.length, 50);
    return json({
      results: Object.fromEntries(requested.map((id) => [id, { "biosafety level": "1" }])),
    });
  };
  const result = await classifyBacDiveSpecies("Bacillus subtilis", { fetcher });
  assert.equal(result.bacdiveIds.length, 50);
  assert.equal(result.category, "Unclassified");
  assert.match(result.note!, /50 of 350/);
});

test("classification keeps service failures distinct from successful absence of evidence", async () => {
  const result = await classifySpeciesList(
    { species: ["Bacillus subtilis", "Bacillus subtilis"] },
    { attempts: 1, fetcher: async () => new Response(null, { status: 503 }) },
  );
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0]?.category, "Unclassified");
  assert.equal(result.warnings.length, 1);
  assert.match(result.results[0]?.note ?? "", /lookup failed/);
  assert.equal(result.authError, false);
});

test("NCBI surveillance membership, clinical isolation and healthy genome labels do not prove pathogenicity", async () => {
  assert.equal(
    diseaseEvidence([
      { disease: "healthy donor" },
      { disease: "unknown" },
      { disease: "asymptomatic" },
    ]),
    null,
  );
  const result = await classifyFallbackList(
    { species: ["Listeria innocua"] },
    {
      fetcher: async () =>
        json([{ disease: "healthy", isolation_source: "blood", host_name: "human" }]),
    },
  );
  assert.equal(result.results[0]?.category, "Unclassified");
  assert.match(
    result.results[0]?.note ?? "",
    /surveillance coverage does not establish pathogenicity/,
  );
  assert.deepEqual(result.warnings, []);
});

test("explicit disease records support a qualified association while fallback outages stay visible", async () => {
  const associated = await classifyFallbackList(
    { species: ["Escherichia coli"] },
    { fetcher: async () => json([{ disease: ["none", "urinary tract infection"] }]) },
  );
  assert.equal(associated.results[0]?.category, "Potential Pathogenic");
  assert.equal(associated.results[0]?.source, "BV-BRC");
  const failed = await classifyFallbackList(
    { species: ["Escherichia coli"] },
    { attempts: 1, fetcher: async () => new Response(null, { status: 503 }) },
  );
  assert.equal(failed.results[0]?.category, "Unclassified");
  assert.equal(failed.warnings.length, 1);
});

test("seeded bacterial peptide fixture completes submit, running, results, mapping and evidence stages through a controlled transport", async () => {
  const fixture = JSON.parse(
    await readFile(new URL("./fixtures/bacterial-peptides.json", import.meta.url), "utf8"),
  ) as {
    inputs: {
      peptide: string;
      accession?: string;
      organism?: string;
      taxid?: number;
      expectedMatch: boolean;
    }[];
  };
  for (const input of fixture.inputs) {
    let polls = 0;
    const fetcher: Fetcher = async (url, init) => {
      const address = String(url);
      if (address.endsWith("/asyncrest/") && init?.method === "POST")
        return new Response(null, {
          status: 202,
          headers: { Location: `/asyncrest/jobs/${jobId}` },
        });
      if (address.includes("/jobs/")) {
        polls++;
        return polls === 1
          ? new Response(null, { status: 303, headers: { "Retry-After": "1" } })
          : new Response(input.expectedMatch ? input.accession : "");
      }
      if (address.includes("/uniprotkb/search"))
        return json({
          results: [
            {
              ...entry(input.accession, `MMMMMMMMMMMMMMM${input.peptide}MMMMMMMMMMMMMMM`),
              organism: {
                scientificName: input.organism,
                taxonId: input.taxid,
                lineage: ["Bacteria", "Pseudomonadota"],
              },
            },
          ],
        });
      if (address.includes("/v2/taxon/")) return json({ count: 1, results: [1] });
      if (address.includes("/v2/fetch/"))
        return json({ results: { "1": { "biosafety level": "2" } } });
      throw new Error(`Unexpected test URL: ${address}`);
    };
    const submitted = await submitPeptide(
      { peptide: input.peptide, il: false, spOnly: false },
      { fetcher },
    );
    assert.equal(submitted.busy, false);
    assert.equal((await pollPeptide(submitted.jobId, { fetcher })).done, false);
    const completed = await pollPeptide(submitted.jobId, { fetcher });
    assert.equal(completed.done, true);
    const details = await loadPeptideDetails(
      { peptide: input.peptide, il: false, accessions: completed.accessions },
      { fetcher },
    );
    assert.equal(details.hits.length, input.expectedMatch ? 1 : 0);
    const species = details.hits.map((hit) => hit.species);
    const evidence = await classifySpeciesList({ species }, { fetcher });
    assert.equal(evidence.results.length, input.expectedMatch ? 1 : 0);
    assert.deepEqual(evidence.warnings, []);
  }
});
