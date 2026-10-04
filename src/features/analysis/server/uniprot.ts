import { COG_CAT, COG_NAMES } from "../data/cog.ts";
import { ACCESSION_RE, JOB_ID_RE, PEPTIDE_RE, type Hit, type Location } from "../model/types.ts";
import {
  jsonResponse,
  mapConcurrent,
  paginationUrl,
  request,
  retryAfterSeconds,
  transientStatus,
  type RequestOptions,
} from "./http.ts";

const PEPTIDE_API = "https://peptidesearch.uniprot.org/asyncrest";
const PROTEIN_API = "https://rest.uniprot.org/uniprotkb";

type Feature = {
  type?: string;
  location?: { start?: { value?: number }; end?: { value?: number } };
};
export type UniProtEntry = {
  primaryAccession?: string;
  entryType?: string;
  organism?: { scientificName?: string; taxonId?: number; lineage?: string[] };
  sequence?: { value?: string };
  proteinDescription?: {
    recommendedName?: { fullName?: { value?: string } };
    submissionNames?: { fullName?: { value?: string } }[];
  };
  comments?: { subcellularLocations?: { location?: { value?: string } }[] }[];
  keywords?: { name?: string }[];
  features?: Feature[];
  uniProtKBCrossReferences?: { database?: string; id?: string }[];
};

function validatePeptide(peptide: string) {
  if (!PEPTIDE_RE.test(peptide))
    throw new Error("Enter 7–60 standard amino-acid letters per peptide.");
}

export async function submitPeptide(
  data: { peptide: string; il: boolean; spOnly: boolean },
  options: RequestOptions = {},
): Promise<{ jobId: string; busy: boolean; retryAfterSeconds: number }> {
  validatePeptide(data.peptide);
  let response: Response;
  try {
    response = await request(
      `${PEPTIDE_API}/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          peps: data.peptide,
          lEQi: data.il ? "on" : "off",
          spOnly: data.spOnly ? "on" : "off",
        }),
        redirect: "manual",
      },
      { ...options, attempts: 1 },
    );
  } catch {
    return { jobId: "", busy: true, retryAfterSeconds: 5 };
  }
  if (transientStatus(response.status)) {
    const wait = retryAfterSeconds(response);
    await response.body?.cancel();
    return { jobId: "", busy: true, retryAfterSeconds: wait };
  }
  const location = response.headers.get("location");
  if (response.status === 202 && location) {
    const target = new URL(location, `${PEPTIDE_API}/`);
    const jobId = target.pathname.match(/\/asyncrest\/jobs\/([A-Za-z0-9_-]+)\/?$/)?.[1] ?? "";
    await response.body?.cancel();
    // The live service currently emits an http Location even when submitted over https.
    // Accept only the known hostname and reconstruct every poll URL over HTTPS below.
    if (
      (target.protocol === "https:" || target.protocol === "http:") &&
      target.hostname === new URL(PEPTIDE_API).hostname &&
      !target.port &&
      JOB_ID_RE.test(jobId)
    ) {
      return { jobId, busy: false, retryAfterSeconds: retryAfterSeconds(response, 4) };
    }
    throw new Error("UniProt returned an invalid search job. Please retry.");
  }
  await response.body?.cancel();
  throw new Error(
    `UniProt could not start the peptide search (HTTP ${response.status}). Please retry later.`,
  );
}

export function parseAccessions(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const tokens = trimmed.split(/[\s,]+/);
  if (tokens.some((token) => !ACCESSION_RE.test(token))) {
    throw new Error("UniProt returned an unexpected peptide-search response. Please retry.");
  }
  return [...new Set(tokens)];
}

export async function pollPeptide(
  jobId: string,
  options: RequestOptions = {},
): Promise<{ done: boolean; accessions: string[]; retryAfterSeconds: number }> {
  if (!JOB_ID_RE.test(jobId)) throw new Error("Invalid peptide search job.");
  let response: Response;
  try {
    response = await request(
      `${PEPTIDE_API}/jobs/${jobId}`,
      { redirect: "manual" },
      { ...options, attempts: 1 },
    );
  } catch {
    return { done: false, accessions: [], retryAfterSeconds: 5 };
  }
  // The documented running response is 303; following it can loop back to the job URL.
  if (response.status === 303 || response.status === 202 || transientStatus(response.status)) {
    const wait = retryAfterSeconds(response, 4);
    await response.body?.cancel();
    return { done: false, accessions: [], retryAfterSeconds: wait };
  }
  if (response.status === 404 || response.status === 410) {
    await response.body?.cancel();
    throw new Error("The UniProt search job expired or was not found. Run the search again.");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      `UniProt could not check the peptide search (HTTP ${response.status}). Please retry later.`,
    );
  }
  let text: string;
  try {
    text = await response.text();
  } catch {
    return { done: false, accessions: [], retryAfterSeconds: 5 };
  }
  // Never turn an HTML error page or an unexpected status payload into a false zero-match result.
  return { done: true, accessions: parseAccessions(text), retryAfterSeconds: 0 };
}

export function matchPositions(sequence: string, peptide: string, il: boolean): number[] {
  const normalize = (value: string) => (il ? value.replace(/I/g, "L") : value);
  const source = normalize(sequence);
  const query = normalize(peptide);
  if (!query) return [];
  const positions: number[] = [];
  let index = source.indexOf(query);
  while (index >= 0) {
    positions.push(index);
    index = source.indexOf(query, index + 1);
  }
  return positions;
}

export function flanksOf(sequence: string, peptide: string, il: boolean, length = 15): string[] {
  return matchPositions(sequence, peptide, il)
    .filter((index) => index >= length && index + peptide.length + length <= sequence.length)
    .slice(0, 20)
    .map(
      (index) =>
        sequence.slice(index - length, index) +
        sequence.slice(index + peptide.length, index + peptide.length + length),
    );
}

export function locationOf(entry: UniProtEntry): Location {
  const locations = (entry.comments ?? [])
    .flatMap((comment) => comment.subcellularLocations ?? [])
    .map((location) => location.location?.value ?? "")
    .join(" | ");
  const keywords = (entry.keywords ?? []).map((keyword) => keyword.name ?? "").join(" | ");
  const text = `${locations} | ${keywords}`.toLowerCase();
  const features = entry.features ?? [];
  const transmembrane =
    features.some((feature) => feature.type === "Transmembrane") || text.includes("transmembrane");
  const lipid =
    features.some((feature) => feature.type === "Lipidation") ||
    /lipoprotein|lipid[- ]anchor|gpi[- ]anchor/.test(text);
  if (/cell wall|peptidoglycan[- ]anchor/.test(text)) return "Cell wall";
  if (lipid) return "Anchored to membrane";
  if (/membrane/.test(text) || transmembrane) return "Integral to membrane";
  if (/secreted|extracellular/.test(text)) return "Extracellular";
  if (/cytoplasm/.test(text)) return "Cytoplasm";
  return "Unknown";
}

function cogOf(entry: UniProtEntry): string {
  const categories = new Set<string>();
  for (const reference of entry.uniProtKBCrossReferences ?? []) {
    if (reference.database !== "eggNOG" || !reference.id || !/^COG\d{4}$/.test(reference.id))
      continue;
    for (const letter of COG_CAT[reference.id] ?? "") {
      const name = COG_NAMES[letter];
      if (name) categories.add(name);
    }
  }
  return categories.size ? [...categories].join("; ") : "Not in COGs";
}

export function phylumOf(lineage: string[]): string {
  // UniProt lineage also contains superkingdoms and kingdoms; lineage[1] is not always a phylum.
  const historical = new Set([
    "Proteobacteria",
    "Firmicutes",
    "Actinobacteria",
    "Bacteroidetes",
    "Cyanobacteria",
    "Spirochaetes",
    "Chlamydiae",
    "Deinococcus-Thermus",
    "Tenericutes",
    "Verrucomicrobia",
    "Acidobacteria",
    "Aquificae",
    "Thermotogae",
    "Fusobacteria",
    "Chloroflexi",
    "Planctomycetes",
  ]);
  return lineage.find((taxon) => historical.has(taxon) || /(?:ota|etes)$/.test(taxon)) ?? "Unknown";
}

export function entryToHit(entry: UniProtEntry, peptide: string, il: boolean): Hit | null {
  const sequence = entry.sequence?.value ?? "";
  const positions = matchPositions(sequence, peptide, il);
  if (
    !positions.length ||
    !entry.primaryAccession ||
    !(entry.organism?.lineage ?? []).includes("Bacteria")
  )
    return null;
  const organism = entry.organism?.scientificName ?? "Unknown";
  const words = organism
    .replace(/^Candidatus\s+/, "")
    .replace(/["']/g, "")
    .trim()
    .split(/\s+/);
  const signals = (entry.features ?? []).filter((feature) => feature.type === "Signal");
  return {
    peptide,
    accession: entry.primaryAccession,
    reviewed:
      /\breviewed\b/i.test(entry.entryType ?? "") && !/unreviewed/i.test(entry.entryType ?? ""),
    protein:
      entry.proteinDescription?.recommendedName?.fullName?.value ??
      entry.proteinDescription?.submissionNames?.[0]?.fullName?.value ??
      "Unknown protein",
    organism,
    species: words.slice(0, 2).join(" "),
    taxid: String(entry.organism?.taxonId ?? ""),
    phylum: phylumOf(entry.organism?.lineage ?? []),
    positions: positions.map((index) => `${index + 1}-${index + peptide.length}`).join(";"),
    signal: signals.length > 0,
    inSignal: signals.some((feature) => {
      const start = feature.location?.start?.value;
      const end = feature.location?.end?.value;
      return (
        start !== undefined &&
        end !== undefined &&
        positions.some((index) => index + 1 >= start && index + peptide.length <= end)
      );
    }),
    flanks: flanksOf(sequence, peptide, il),
    location: locationOf(entry),
    cog: cogOf(entry),
  };
}

function nextLink(response: Response): string | null {
  return response.headers.get("link")?.match(/<([^>]+)>;\s*rel="?next"?/)?.[1] ?? null;
}

export async function loadPeptideDetails(
  data: { peptide: string; il: boolean; accessions: string[] },
  options: RequestOptions = {},
): Promise<{ hits: Hit[]; warnings: string[] }> {
  validatePeptide(data.peptide);
  if (
    data.accessions.length > 500 ||
    data.accessions.some((accession) => !ACCESSION_RE.test(accession))
  )
    throw new Error("Invalid protein accession list.");
  const accessions = [...new Set(data.accessions)];
  const canonical = [...new Set(accessions.map((accession) => accession.split("-")[0]!))];
  const chunks: string[][] = [];
  for (let index = 0; index < canonical.length; index += 100)
    chunks.push(canonical.slice(index, index + 100));
  const entries = (
    await mapConcurrent(chunks, 2, async (chunk) => {
      // Retrieve every requested accession before filtering. Otherwise an excluded
      // nonbacterial record cannot be distinguished from a deleted or missing record.
      const query = `(${chunk.map((accession) => `accession:${accession}`).join(" OR ")})`;
      const params = new URLSearchParams({
        query,
        fields:
          "accession,reviewed,protein_name,organism_name,organism_id,lineage,sequence,cc_subcellular_location,keyword,ft_transmem,ft_lipid,ft_signal,xref_eggnog",
        format: "json",
        size: "500",
      });
      let url: string | null = `${PROTEIN_API}/search?${params}`;
      const seen = new Set<string>();
      const output: UniProtEntry[] = [];
      while (url) {
        if (seen.has(url) || seen.size >= 20)
          throw new Error("UniProt returned invalid result pagination. Please retry.");
        seen.add(url);
        const response = await request(url, {}, options);
        const payload = await jsonResponse<{ results?: UniProtEntry[] }>(response, "UniProt REST");
        if (!Array.isArray(payload.results))
          throw new Error("UniProt returned an unexpected protein response. Please retry.");
        output.push(...payload.results);
        const next = nextLink(response);
        url = next ? paginationUrl(next, url, `${PROTEIN_API}/search`) : null;
      }
      return output;
    })
  ).flat();
  const hits: Hit[] = [];
  const warnings: string[] = [];
  const returnedAccessions = new Set(entries.map((entry) => entry.primaryAccession));
  const missing = canonical.filter((accession) => !returnedAccessions.has(accession));
  if (missing.length) {
    warnings.push(
      `UniProt REST did not return ${missing.length} requested protein record${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}. These accessions may have been deleted or remapped, so their bacterial membership could not be checked.`,
    );
  }
  for (const entry of entries) {
    if (!entry.primaryAccession) continue;
    const lineage = entry.organism?.lineage;
    if (!Array.isArray(lineage) || !lineage.length) {
      warnings.push(
        `UniProt omitted the taxonomy lineage for ${entry.primaryAccession}; bacterial membership could not be checked.`,
      );
      continue;
    }
    if (!lineage.includes("Bacteria")) continue;
    if (accessions.includes(entry.primaryAccession)) {
      if (!entry.sequence?.value) {
        throw new Error(
          `UniProt omitted the sequence for ${entry.primaryAccession}. Please retry.`,
        );
      }
      const hit = entryToHit(entry, data.peptide, data.il);
      if (hit) hits.push(hit);
      else {
        warnings.push(
          `Bacterial protein ${entry.primaryAccession} no longer contains this peptide in UniProt REST. The peptide-search and protein databases may use different releases.`,
        );
      }
    }
    // Isoform coordinates must come from its own sequence, never the canonical sequence.
    for (const isoform of accessions.filter((accession) =>
      accession.startsWith(`${entry.primaryAccession}-`),
    )) {
      const response = await request(`${PROTEIN_API}/${isoform}.fasta`, {}, options);
      if (!response.ok)
        throw new Error(
          `UniProt could not retrieve isoform ${isoform} (HTTP ${response.status}). Please retry.`,
        );
      const fasta = await response.text();
      if (!fasta.startsWith(">")) throw new Error("UniProt returned an invalid isoform sequence.");
      const sequence = fasta.split(/\r?\n/).slice(1).join("").trim();
      const hit = entryToHit(
        { ...entry, primaryAccession: isoform, sequence: { value: sequence }, features: [] },
        data.peptide,
        data.il,
      );
      if (hit) hits.push(hit);
      warnings.push(
        `Signal and membrane feature coordinates are unavailable for isoform ${isoform}.`,
      );
    }
  }
  return {
    hits: [...new Map(hits.map((hit) => [hit.accession, hit])).values()].sort((a, b) =>
      a.accession.localeCompare(b.accession),
    ),
    warnings,
  };
}
