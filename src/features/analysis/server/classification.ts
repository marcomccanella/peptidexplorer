import { NCBI_PATHOGEN_GROUPS } from "../data/ncbi-pathogens.ts";
import type { Classification } from "../model/types.ts";
import { jsonResponse, mapConcurrent, request, type RequestOptions } from "./http.ts";

const BACDIVE_API = "https://api.bacdive.dsmz.de/v2";
const MAX_STRAINS = 50;
const CACHE_TTL = 60 * 60 * 1000;
type CacheEntry = { result: Classification; expires: number };
const bacdiveCache = new Map<string, CacheEntry>();
const fallbackCache = new Map<string, CacheEntry>();

function cached(cache: Map<string, CacheEntry>, species: string): Classification | null {
  const entry = cache.get(species);
  if (!entry) return null;
  if (entry.expires <= Date.now()) {
    cache.delete(species);
    return null;
  }
  return entry.result;
}

function remember(cache: Map<string, CacheEntry>, result: Classification) {
  if (cache.size >= 2000) cache.delete(cache.keys().next().value!);
  cache.set(result.species, { result, expires: Date.now() + CACHE_TTL });
  return result;
}

export function findValues(object: unknown, key: string): unknown[] {
  const out: unknown[] = [];
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const visit = (current: unknown) => {
    if (!current || typeof current !== "object") return;
    for (const [field, value] of Object.entries(current)) {
      if (normalize(field) === normalize(key)) out.push(value);
      visit(value);
    }
  };
  visit(object);
  return out;
}

export function classifyBacDiveEntries(
  species: string,
  entries: unknown[],
  ids: number[],
  availableCount = ids.length,
): Classification {
  const levels = findValues(entries, "biosafety level")
    .flatMap((value) => String(value).match(/\b[1-4]\b/g) ?? [])
    .map(Number);
  const pathogenicity = [
    ...findValues(entries, "pathogenicity human"),
    ...findValues(entries, "pathogenicity animal"),
  ].map((value) => String(value).trim().toLowerCase());
  const positive = pathogenicity.some((value) => /^yes\b/.test(value));
  const bsl = levels.length ? Math.max(...levels) : null;
  const pathogenic = positive || (bsl !== null && bsl >= 2);
  const evidence = [
    bsl !== null ? `Highest reported biosafety/risk level: ${bsl}` : "",
    positive ? "Human or animal pathogenicity reported for at least one strain" : "",
  ]
    .filter(Boolean)
    .join("; ");
  const notes = [
    availableCount > ids.length
      ? `Examined ${ids.length} of ${availableCount} available BacDive strain records.`
      : `Examined ${ids.length} BacDive strain record${ids.length === 1 ? "" : "s"}.`,
    "Strain evidence does not establish the behavior of every member of this species.",
    !pathogenic
      ? "Biosafety level 1 or absent pathogenicity evidence does not establish commensalism."
      : "Biosafety/risk levels are containment designations, not a clinical diagnosis.",
  ];
  return {
    species,
    category: pathogenic ? "Potential Pathogenic" : "Unclassified",
    bsl,
    bacdiveIds: ids,
    source: "BacDive",
    evidence:
      evidence ||
      "No explicit human/animal pathogenicity or biosafety-level evidence in the examined records",
    note: notes.join(" "),
  };
}

export async function classifyBacDiveSpecies(
  species: string,
  options: RequestOptions = {},
): Promise<Classification> {
  // Custom fetchers are used in tests and must never reuse results from another transport.
  if (!options.fetcher) {
    const previous = cached(bacdiveCache, species);
    if (previous) return previous;
  }
  const words = species.trim().split(/\s+/);
  const genus = words[0];
  const epithet = words[1];
  if (
    words.length !== 2 ||
    !genus ||
    !epithet ||
    !/^[A-Za-z][A-Za-z-]*$/.test(genus) ||
    !/^[a-z][a-z-]*$/.test(epithet) ||
    /^sp\.?$/.test(epithet)
  ) {
    return {
      species,
      category: "Unclassified",
      bsl: null,
      bacdiveIds: [],
      note: "A resolved genus and species name is needed for a BacDive lookup.",
    };
  }
  const taxonomy = await jsonResponse<{ count?: number; results?: (number | { id?: number })[] }>(
    await request(
      `${BACDIVE_API}/taxon/${encodeURIComponent(genus)}/${encodeURIComponent(epithet)}`,
      { headers: { Accept: "application/json" } },
      options,
    ),
    "BacDive",
  );
  if (!Array.isArray(taxonomy.results))
    throw new Error("BacDive returned an unexpected taxonomy response. Please retry.");
  const ids = [
    ...new Set(
      taxonomy.results
        .map((entry) => (typeof entry === "number" ? entry : entry.id))
        .filter((id): id is number => typeof id === "number" && Number.isInteger(id) && id > 0),
    ),
  ].slice(0, MAX_STRAINS);
  if (!ids.length) {
    const result: Classification = {
      species,
      category: "Unclassified",
      bsl: null,
      bacdiveIds: [],
      source: "BacDive",
      note: "No matching strain records found in BacDive. This does not establish commensalism.",
    };
    return options.fetcher ? result : remember(bacdiveCache, result);
  }
  const details = await jsonResponse<{ results?: Record<string, unknown> }>(
    await request(
      `${BACDIVE_API}/fetch/${ids.join(";")}`,
      { headers: { Accept: "application/json" } },
      options,
    ),
    "BacDive",
  );
  if (!details.results || typeof details.results !== "object" || Array.isArray(details.results))
    throw new Error("BacDive returned an unexpected strain response. Please retry.");
  const receivedIds = ids.filter((id) => Object.hasOwn(details.results!, String(id)));
  if (receivedIds.length !== ids.length)
    throw new Error("BacDive returned incomplete strain records. Please retry.");
  const result = classifyBacDiveEntries(
    species,
    Object.values(details.results),
    receivedIds,
    taxonomy.count ?? taxonomy.results.length,
  );
  return options.fetcher ? result : remember(bacdiveCache, result);
}

export async function classifySpeciesList(
  data: { species: string[] },
  options: RequestOptions = {},
) {
  const warnings: string[] = [];
  const results = await mapConcurrent(
    [...new Set(data.species)],
    4,
    async (species): Promise<Classification> => {
      try {
        return await classifyBacDiveSpecies(species, options);
      } catch (error) {
        const note = `BacDive lookup failed: ${error instanceof Error ? error.message : "service unavailable"}`;
        warnings.push(`${species}: ${note}`);
        // Failures are never cached as a successful negative lookup.
        return { species, category: "Unclassified", bsl: null, bacdiveIds: [], note };
      }
    },
  );
  return { results, authError: false, warnings };
}

export function surveillanceGroup(species: string): string | null {
  const genus = species.split(" ")[0];
  return (
    NCBI_PATHOGEN_GROUPS.find((group) =>
      group.includes(" ") ? group === species : group === genus,
    ) ?? null
  );
}

const NO_DISEASE =
  /^(?:none|no|n\/?a|not applicable|healthy(?:\s+.*)?|missing|unknown|not provided|not collected|asymptomatic(?:\s+.*)?|-)$/i;
export function diseaseEvidence(rows: { disease?: string[] | string }[]): string | null {
  for (const row of rows) {
    const values = Array.isArray(row.disease) ? row.disease : row.disease ? [row.disease] : [];
    const disease = values.find(
      (value) => typeof value === "string" && value.trim() && !NO_DISEASE.test(value.trim()),
    );
    if (disease) return `BV-BRC disease association in a genome record: ${disease.trim()}`;
  }
  return null;
}

export async function classifyFallbackList(
  data: { species: string[] },
  options: RequestOptions = {},
) {
  const warnings: string[] = [];
  const results = await mapConcurrent(
    [...new Set(data.species)],
    2,
    async (species): Promise<Classification> => {
      if (!options.fetcher) {
        const previous = cached(fallbackCache, species);
        if (previous) return previous;
      }
      const base: Classification = {
        species,
        category: "Unclassified",
        bsl: null,
        bacdiveIds: [],
        source: "none",
      };
      if (!/^[A-Za-z][A-Za-z-]* [a-z][a-z-]*$/.test(species) || / sp$/.test(species))
        return { ...base, note: "Species name is unresolved." };
      const group = surveillanceGroup(species);
      // Surveillance membership, clinical isolation, and sequence-record counts are not pathogenicity evidence.
      const context = group
        ? `Included in NCBI Pathogen Detection surveillance group ${group}; surveillance coverage does not establish pathogenicity.`
        : "";
      try {
        const query = `eq(species,${encodeURIComponent(species)})&select(disease)&limit(200)`;
        const response = await request(
          `https://www.bv-brc.org/api/genome/?${query}`,
          { headers: { Accept: "application/json" } },
          { attempts: 2, timeoutMs: 10_000, ...options },
        );
        const rows = await jsonResponse<{ disease?: string[] | string }[]>(response, "BV-BRC");
        if (!Array.isArray(rows)) throw new Error("BV-BRC returned an unexpected genome response.");
        const evidence = diseaseEvidence(rows);
        const result: Classification = evidence
          ? {
              ...base,
              category: "Potential Pathogenic",
              source: "BV-BRC",
              evidence,
              note: "Association from up to 200 genome records; strains of the same species can differ in pathogenicity.",
            }
          : {
              ...base,
              ...(group ? { source: "NCBI Pathogens" as const } : {}),
              note: [
                context,
                "No explicit disease association found in up to 200 examined genome records. This does not establish commensalism.",
              ]
                .filter(Boolean)
                .join(" "),
            };
        return options.fetcher ? result : remember(fallbackCache, result);
      } catch (error) {
        const note = `Additional evidence lookup failed: ${error instanceof Error ? error.message : "service unavailable"}`;
        warnings.push(`${species}: ${note}`);
        return { ...base, note: [context, note].filter(Boolean).join(" ") };
      }
    },
  );
  return { results, warnings };
}
