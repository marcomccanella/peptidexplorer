// Test-process-only scientific responses. The browser still calls the real app server.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

if (process.env.BEACON_TEST_FIXTURES !== "1") {
  throw new Error("Fixture upstreams may only run in an explicitly configured test process.");
}
const fixtures = JSON.parse(
  readFileSync(new URL("../fixtures/bacterial-peptides.json", import.meta.url), "utf8"),
);
const proteins = JSON.parse(
  readFileSync(new URL("../fixtures/proteins.json", import.meta.url), "utf8"),
);
const originalFetch = globalThis.fetch;
const jobs = new Map();
const submissionCounts = new Map();
let failedPeptideAttempts = 0;
const json = (value) =>
  new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
const strains = {
  "Escherichia/coli": { id: 101, bsl: 2 },
  "Bacillus/subtilis": { id: 102, bsl: 1 },
  "Staphylococcus/aureus": { id: 103, bsl: 2 },
};

globalThis.fetch = async (input, init = {}) => {
  const address = typeof input === "string" || input instanceof URL ? String(input) : input.url;
  const url = new URL(address);
  if (url.hostname === "peptidesearch.uniprot.org") {
    if (init.method === "POST") {
      const parameters = new URLSearchParams(String(init.body));
      if (parameters.get("lEQi") !== "off") {
        return new Response("The restored interface must use exact I/L matching.", { status: 400 });
      }
      const peptide = parameters.get("peps");
      if (peptide === "AAAAAAA" && failedPeptideAttempts++ === 0)
        return new Response("Invalid peptide job", { status: 400 });
      const id = createHash("sha256")
        .update(peptide ?? "")
        .digest("hex")
        .slice(0, 32);
      const row = fixtures.inputs.find((entry) => entry.peptide === peptide);
      const count = (submissionCounts.get(peptide) ?? 0) + 1;
      submissionCounts.set(peptide, count);
      const accession =
        peptide === "CCCCCCC"
          ? "Q9ZZZ9"
          : peptide === "VTYDPVSKELTIQPGCSS" && count > 1
            ? `${row.accession},Q9ZZZ9`
            : (row?.accession ?? "");
      jobs.set(id, { accession, polls: 0 });
      return new Response(null, {
        status: 202,
        headers: {
          Location: `https://peptidesearch.uniprot.org/asyncrest/jobs/${id}`,
          "Retry-After": "1",
        },
      });
    }
    const id = url.pathname.split("/").at(-1);
    const job = jobs.get(id);
    if (!job) return new Response("Job not found", { status: 404 });
    if (job.polls++ === 0)
      return new Response(null, {
        status: 303,
        headers: { Location: address, "Retry-After": "1" },
      });
    return new Response(job.accession, { headers: { "Content-Type": "text/plain" } });
  }
  if (url.hostname === "rest.uniprot.org" && url.pathname === "/uniprotkb/search") {
    const query = url.searchParams.get("query") ?? "";
    return json({
      results: proteins.filter((protein) =>
        query.includes(`accession:${protein.primaryAccession}`),
      ),
    });
  }
  if (url.hostname === "api.bacdive.dsmz.de") {
    const taxon = url.pathname.match(/\/taxon\/([^/]+\/[^/]+)/)?.[1];
    if (taxon) {
      const strain = strains[decodeURIComponent(taxon)];
      return json({ count: strain ? 1 : 0, next: null, results: strain ? [strain.id] : [] });
    }
    if (url.pathname.includes("/fetch/")) {
      const ids = url.pathname.split("/fetch/")[1].split(";").map(Number);
      return json({
        results: Object.fromEntries(
          Object.values(strains)
            .filter((strain) => ids.includes(strain.id))
            .map((strain) => [
              String(strain.id),
              {
                General: { "BacDive ID": strain.id },
                "Interaction and safety": {
                  "biosafety level": { "biosafety level": String(strain.bsl) },
                },
              },
            ]),
        ),
      });
    }
  }
  if (url.hostname === "www.bv-brc.org") return json([]);
  if (url.hostname === "www.ebi.ac.uk") return json({ hitCount: 0 });
  if (
    ["peptidesearch.uniprot.org", "rest.uniprot.org", "api.bacdive.dsmz.de"].includes(url.hostname)
  ) {
    throw new Error(`Unhandled scientific test request: ${address}`);
  }
  return originalFetch(input, init);
};
