import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  pepSubmit,
  pepPoll,
  pepDetails,
  classifySpecies,
  classifyFallback,
  type Hit,
  type Classification,
} from "@/lib/explorer.functions";

export const MAX_ACCESSIONS = 5000;
export type SearchOptions = { il: boolean; spOnly: boolean };
export type Job = {
  peptide: string;
  state: "waiting" | "running" | "complete" | "error";
  status: string;
  total: number;
  hits: Hit[];
  error: string;
  annotationWarnings: string[];
};
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Network orchestration lives separately from the analysis screen. */
export function useAnalysis() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [classifications, setClassifications] = useState<Record<string, Classification>>({});
  const [running, setRunning] = useState(false);
  const [classificationProgress, setClassificationProgress] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const lastOptions = useRef<SearchOptions>({ il: false, spOnly: false });
  const active = useRef(false);
  const submit = useServerFn(pepSubmit);
  const poll = useServerFn(pepPoll);
  const details = useServerFn(pepDetails);
  const classify = useServerFn(classifySpecies);
  const fallback = useServerFn(classifyFallback);

  function updateJob(index: number, changes: Partial<Job>) {
    setJobs((previous) => previous.map((job, i) => (i === index ? { ...job, ...changes } : job)));
  }

  async function runOne(peptide: string, index: number, options: SearchOptions): Promise<Hit[]> {
    updateJob(index, { state: "running", hits: [], total: 0, error: "", annotationWarnings: [] });
    try {
      let jobId = "";
      const waits = [5, 10, 20, 30, 45, 60];
      for (let attempt = 0; attempt <= waits.length; attempt++) {
        updateJob(index, {
          status: attempt ? `Submitting again (attempt ${attempt + 1})` : "Submitting to UniProt",
        });
        const result = await submit({ data: { peptide, ...options } });
        if (!result.busy) {
          jobId = result.jobId;
          if (!jobId) throw new Error("UniProt did not provide a search ID. Please retry.");
          break;
        }
        if (attempt === waits.length)
          throw new Error(
            "UniProt is temporarily unavailable after several attempts. Please retry later.",
          );
        const retryAfter = "retryAfterSeconds" in result ? Number(result.retryAfterSeconds) : 0;
        const wait = Math.min(120, Math.max(waits[attempt]!, retryAfter || 0));
        updateJob(index, { status: `UniProt is busy; retrying in ${wait} seconds` });
        await sleep(wait * 1000);
      }
      const started = Date.now();
      let accessions: string[] | undefined;
      let delay = 4;
      while (Date.now() - started < 10 * 60 * 1000) {
        const elapsed = Math.round((Date.now() - started) / 1000);
        updateJob(index, {
          status: `Searching UniProt (${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")})`,
        });
        await sleep(delay * 1000);
        const result = await poll({ data: { jobId } });
        if (result.done) {
          accessions = result.accessions;
          break;
        }
        const retryAfter = "retryAfterSeconds" in result ? Number(result.retryAfterSeconds) : 0;
        delay = Math.min(60, Math.max(4, retryAfter || 0));
      }
      if (!accessions)
        throw new Error(
          "UniProt did not finish within 10 minutes. This is an incomplete search; please retry later.",
        );
      updateJob(index, { total: accessions.length });
      const selected = accessions.slice(0, MAX_ACCESSIONS);
      const hits: Hit[] = [];
      const annotationWarnings: string[] = [];
      for (let i = 0; i < selected.length; i += 500) {
        updateJob(index, {
          status: `Loading protein records (${Math.min(i + 500, selected.length)}/${selected.length})`,
        });
        const result = await details({
          data: { peptide, il: options.il, accessions: selected.slice(i, i + 500) },
        });
        hits.push(...result.hits);
        if ("warnings" in result && Array.isArray(result.warnings))
          annotationWarnings.push(...result.warnings);
      }
      const uniqueHits = [...new Map(hits.map((hit) => [hit.accession, hit])).values()];
      updateJob(index, {
        state: "complete",
        hits: uniqueHits,
        annotationWarnings: [...new Set(annotationWarnings)],
        status:
          accessions.length > MAX_ACCESSIONS
            ? "Finished with limited coverage"
            : annotationWarnings.length
              ? "Finished; review protein record warnings"
              : uniqueHits.length
                ? "Protein search complete"
                : "No bacterial matches",
      });
      return uniqueHits;
    } catch (error) {
      updateJob(index, {
        state: "error",
        status: "Search failed",
        error: messageOf(error),
        hits: [],
      });
      return [];
    }
  }

  async function classifyAll(found: Hit[], previous: Record<string, Classification> = {}) {
    const species = [...new Set(found.map((hit) => hit.species))].filter((name) => !previous[name]);
    const map = { ...previous };
    const issues: string[] = [];
    try {
      for (let i = 0; i < species.length; i += 20) {
        setClassificationProgress(
          `Checking BacDive evidence: ${Math.min(i + 20, species.length)}/${species.length} species`,
        );
        try {
          const result = await classify({ data: { species: species.slice(i, i + 20) } });
          result.results.forEach((classification) => {
            map[classification.species] = classification;
          });
          if ("warnings" in result && Array.isArray(result.warnings))
            issues.push(...result.warnings);
          setClassifications({ ...map });
        } catch (error) {
          issues.push(
            `BacDive lookup failed: ${messageOf(error)}. These species remain unclassified.`,
          );
          species.slice(i, i + 20).forEach((name) => {
            map[name] = {
              species: name,
              category: "Unclassified",
              bsl: null,
              bacdiveIds: [],
              source: "none",
              note: `BacDive evidence lookup unavailable: ${messageOf(error)}`,
            };
          });
          setClassifications({ ...map });
        }
      }
      const unresolved = species.filter(
        (name) => (map[name]?.category ?? "Unclassified") === "Unclassified",
      );
      for (let i = 0; i < unresolved.length; i += 6) {
        setClassificationProgress(
          `Checking additional evidence: ${Math.min(i + 6, unresolved.length)}/${unresolved.length} unclassified species`,
        );
        try {
          const result = await fallback({ data: { species: unresolved.slice(i, i + 6) } });
          result.results.forEach((classification) => {
            const bacdive = map[classification.species];
            // Keep BacDive notes and biosafety evidence when no stronger evidence is found.
            map[classification.species] =
              classification.category !== "Unclassified" || !bacdive
                ? {
                    ...classification,
                    bacdiveIds: bacdive?.bacdiveIds ?? classification.bacdiveIds,
                    bsl: bacdive?.bsl ?? classification.bsl,
                    note: [bacdive?.note, classification.note].filter(Boolean).join("; "),
                  }
                : {
                    ...bacdive,
                    note: [bacdive.note, classification.note].filter(Boolean).join("; "),
                  };
          });
          if ("warnings" in result && Array.isArray(result.warnings))
            issues.push(...result.warnings);
          setClassifications({ ...map });
        } catch (error) {
          issues.push(
            `Additional evidence lookup failed: ${messageOf(error)}. Missing evidence does not establish commensalism.`,
          );
          unresolved.slice(i, i + 6).forEach((name) => {
            const previous = map[name] ?? {
              species: name,
              category: "Unclassified" as const,
              bsl: null,
              bacdiveIds: [],
            };
            map[name] = {
              ...previous,
              note: [previous.note, `Additional evidence lookup unavailable: ${messageOf(error)}`]
                .filter(Boolean)
                .join("; "),
            };
          });
          setClassifications({ ...map });
        }
      }
    } finally {
      setClassificationProgress("");
      setWarnings([...new Set(issues)]);
    }
  }

  async function run(peptides: string[], options: SearchOptions) {
    if (active.current || !peptides.length) return;
    active.current = true;
    lastOptions.current = { ...options };
    setRunning(true);
    setWarnings([]);
    setClassifications({});
    setJobs(
      peptides.map((peptide) => ({
        peptide,
        state: "waiting",
        status: "Waiting to search",
        total: 0,
        hits: [],
        error: "",
        annotationWarnings: [],
      })),
    );
    try {
      const all: Hit[][] = Array.from({ length: peptides.length }, () => []);
      let next = 0;
      const worker = async () => {
        while (next < peptides.length) {
          const index = next++;
          all[index] = await runOne(peptides[index]!, index, options);
        }
      };
      await Promise.all([worker(), worker()]);
      await classifyAll(all.flat());
    } finally {
      active.current = false;
      setRunning(false);
    }
  }

  async function retry(index: number) {
    if (active.current || !jobs[index]) return;
    active.current = true;
    setRunning(true);
    try {
      const hits = await runOne(jobs[index]!.peptide, index, lastOptions.current);
      await classifyAll([
        ...jobs
          .filter((job, i) => i !== index && job.state === "complete")
          .flatMap((job) => job.hits),
        ...hits,
      ]);
    } finally {
      active.current = false;
      setRunning(false);
    }
  }

  async function retryClassification() {
    if (active.current) return;
    active.current = true;
    setRunning(true);
    try {
      await classifyAll(jobs.filter((job) => job.state === "complete").flatMap((job) => job.hits));
    } finally {
      active.current = false;
      setRunning(false);
    }
  }

  return {
    jobs,
    classifications,
    running,
    classificationProgress,
    warnings,
    run,
    retry,
    retryClassification,
  };
}
