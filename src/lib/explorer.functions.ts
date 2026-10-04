import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ACCESSION_RE, JOB_ID_RE, PEPTIDE_RE } from "../features/analysis/model/types";

export type { Category, Classification, Hit, Location } from "../features/analysis/model/types";

// This stable facade is the only browser-facing entry point to external data services.
// Dynamic imports keep API clients, reference tables, and caches on the server.
export const pepSubmit = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({ peptide: z.string().regex(PEPTIDE_RE), il: z.boolean(), spOnly: z.boolean() })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { submitPeptide } = await import("../features/analysis/server/uniprot");
    return submitPeptide(data);
  });

export const pepPoll = createServerFn({ method: "POST" })
  .validator((input) => z.object({ jobId: z.string().regex(JOB_ID_RE) }).parse(input))
  .handler(async ({ data }) => {
    const { pollPeptide } = await import("../features/analysis/server/uniprot");
    return pollPeptide(data.jobId);
  });

export const pepDetails = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        peptide: z.string().regex(PEPTIDE_RE),
        il: z.boolean(),
        accessions: z.array(z.string().regex(ACCESSION_RE)).max(500),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { loadPeptideDetails } = await import("../features/analysis/server/uniprot");
    return loadPeptideDetails(data);
  });

export const classifySpecies = createServerFn({ method: "POST" })
  .validator((input) =>
    z.object({ species: z.array(z.string().trim().min(1).max(200)).max(40) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { classifySpeciesList } = await import("../features/analysis/server/classification");
    return classifySpeciesList(data);
  });

export const classifyFallback = createServerFn({ method: "POST" })
  .validator((input) =>
    z.object({ species: z.array(z.string().trim().min(1).max(200)).max(6) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { classifyFallbackList } = await import("../features/analysis/server/classification");
    return classifyFallbackList(data);
  });
