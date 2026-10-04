import { useMemo, useRef, useState, type ReactNode } from "react";
import { useHydrated } from "@tanstack/react-router";
import { Dna, Download, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type Category, type Hit } from "@/lib/explorer.functions";
import { peptideProps, type PeptideProps } from "../model/peptide-props";
import { parsePeptides } from "../model/peptides";
import { MAX_ACCESSIONS, useAnalysis } from "../use-analysis";
import { Heatmap, HorizontalBar, LocationPie } from "./charts";
import { downloadSvgAsPng } from "../download-chart";

const EXAMPLES = "VVEEAPAPGITPEL\nGAIPFAAADPLRVIPS\nMFENITAAPADPILG";
const CATEGORIES: Category[] = ["Potential Pathogenic", "Unclassified"];
const PROPERTY_COLUMNS: {
  label: string;
  get: (row: PeptideProps) => number;
  format: (value: number) => string;
}[] = [
  { label: "Length", get: (row) => row.length, format: String },
  { label: "MW (Da)", get: (row) => row.mw, format: (value) => value.toFixed(1) },
  { label: "Net charge (pH 7)", get: (row) => row.charge7, format: (value) => value.toFixed(2) },
  { label: "pI", get: (row) => row.pi, format: (value) => value.toFixed(2) },
  { label: "GRAVY", get: (row) => row.gravy, format: (value) => value.toFixed(2) },
  { label: "Aromaticity", get: (row) => row.aromaticity, format: (value) => value.toFixed(2) },
];
const field =
  "w-full min-w-0 rounded border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";
const help = "mt-1.5 text-xs leading-relaxed text-muted-foreground";

export function AnalysisScreen() {
  const hydrated = useHydrated();
  const [input, setInput] = useState(EXAMPLES);
  const [reviewedOnly, setReviewedOnly] = useState(false);
  const {
    jobs,
    classifications,
    running,
    classificationProgress,
    warnings,
    run,
    retry,
    retryClassification,
  } = useAnalysis();
  const parsed = useMemo(() => parsePeptides(input), [input]);
  const completedJobs = jobs.filter((job) => job.state === "complete");
  const hits = completedJobs.flatMap((job) => job.hits);
  const peptides = completedJobs.map((job) => job.peptide);
  const failedCount = jobs.filter((job) => job.state === "error").length;
  const limitedCount = completedJobs.filter((job) => job.total > MAX_ACCESSIONS).length;
  const proteinWarnings = [...new Set(completedJobs.flatMap((job) => job.annotationWarnings))];
  const finished = jobs.length > 0 && !running;
  const categoryOf = (hit: Hit): Category =>
    classifications[hit.species]?.category ?? "Unclassified";
  const countSpecies = (selected: Hit[]) => new Set(selected.map((hit) => hit.species)).size;
  const categoryMatrix = peptides.map((peptide) =>
    CATEGORIES.map((category) =>
      countSpecies(hits.filter((hit) => hit.peptide === peptide && categoryOf(hit) === category)),
    ),
  );
  const phylumSpecies = new Map<string, Set<string>>();
  hits.forEach((hit) => {
    if (!phylumSpecies.has(hit.phylum)) phylumSpecies.set(hit.phylum, new Set());
    phylumSpecies.get(hit.phylum)!.add(hit.species);
  });
  const phyla = [...phylumSpecies]
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 10)
    .map(([phylum]) => phylum);
  const phylumMatrix = peptides.map((peptide) =>
    phyla.map((phylum) =>
      countSpecies(hits.filter((hit) => hit.peptide === peptide && hit.phylum === phylum)),
    ),
  );
  const uniqueProteins = [...new Map(hits.map((hit) => [hit.accession, hit])).values()];
  const locationCounts: Record<string, number> = {};
  const cogCounts: Record<string, number> = {};
  uniqueProteins.forEach((hit) => {
    locationCounts[hit.location] = (locationCounts[hit.location] ?? 0) + 1;
    cogCounts[hit.cog] = (cogCounts[hit.cog] ?? 0) + 1;
  });
  const cogItems = Object.entries(cogCounts)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
  const propertyRows = useMemo(() => jobs.map((job) => peptideProps(job.peptide)), [jobs]);
  const propertyValues = propertyRows.map((row) =>
    PROPERTY_COLUMNS.map((column) => {
      const values = propertyRows.map(column.get);
      const min = Math.min(...values),
        max = Math.max(...values);
      return max - min < 1e-9 ? 0.5 : (column.get(row) - min) / (max - min);
    }),
  );
  const propertyTexts = propertyRows.map((row) =>
    PROPERTY_COLUMNS.map((column) => column.format(column.get(row))),
  );
  const categoryChart = useRef<SVGSVGElement>(null);
  const phylumChart = useRef<SVGSVGElement>(null);
  const locationChart = useRef<SVGSVGElement>(null);
  const cogChart = useRef<SVGSVGElement>(null);
  const propertyChart = useRef<SVGSVGElement>(null);

  function downloadCsv() {
    const header = [
      "peptide",
      "accession",
      "reviewed",
      "protein",
      "organism",
      "species",
      "taxid",
      "phylum",
      "category",
      "source",
      "evidence",
      "classification_note",
      "bacdive_bsl",
      "positions",
      "signal_peptide",
      "location",
      "cog_category",
      "search_coverage",
      "protein_annotation_notes",
    ];
    const rows = hits.map((hit) => {
      const classification = classifications[hit.species];
      const job = completedJobs.find((item) => item.peptide === hit.peptide)!;
      return [
        hit.peptide,
        hit.accession,
        hit.reviewed,
        hit.protein,
        hit.organism,
        hit.species,
        hit.taxid,
        hit.phylum,
        categoryOf(hit),
        classification?.source ?? "none",
        classification?.evidence ?? "",
        classification?.note ?? "",
        classification?.bsl ?? "",
        hit.positions,
        hit.inSignal ? "peptide in signal peptide" : hit.signal ? "protein has signal peptide" : "",
        hit.location,
        hit.cog,
        job.total > MAX_ACCESSIONS
          ? `limited: first ${MAX_ACCESSIONS} of ${job.total} UniProt entries`
          : job.annotationWarnings.length
            ? "needs review: protein record warnings"
            : "complete",
        job.annotationWarnings.join("; "),
      ];
    });
    const csv = [header, ...rows]
      .map((row) =>
        row
          .map((value) => {
            const text = String(value);
            const safe = /^[=+@-]/.test(text) ? `'${text}` : text;
            return `"${safe.replace(/"/g, '""')}"`;
          })
          .join(","),
      )
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "bacterial_beacon_hits.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-5 py-5 sm:px-8">
          <div
            className="flex size-9 shrink-0 items-center justify-center rounded bg-accent text-accent-foreground"
            aria-hidden="true"
          >
            <Dna size={20} strokeWidth={1.8} />
          </div>
          <h1 className="text-lg font-semibold sm:text-xl">
            Peptide Taxonomy &amp; Bacterial Pathogenicity
          </h1>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-5 pb-16 sm:px-8">
        <section className="grid border-x border-b border-border bg-card lg:grid-cols-[minmax(0,2fr)_minmax(290px,1fr)]">
          <div className="min-w-0 p-5 sm:p-7 lg:border-r lg:border-border">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <label htmlFor="peptides" className="text-xs font-bold uppercase text-primary">
                Peptide sequences
              </label>
              <span id="peptide-help" className="text-xs text-muted-foreground">
                One per line or FASTA · 7–60 aa · max 25
              </span>
            </div>
            <textarea
              id="peptides"
              aria-describedby="peptide-help input-feedback"
              aria-invalid={parsed.errors.length > 0}
              className={`${field} h-64 resize-y font-mono leading-relaxed disabled:opacity-70`}
              disabled={!hydrated || running}
              spellCheck={false}
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
            <div className="mt-2 flex flex-wrap items-start justify-between gap-2">
              <div id="input-feedback" className="text-xs" aria-live="polite">
                {parsed.errors.length ? (
                  <ul className="list-disc space-y-1 pl-5 text-destructive">
                    {parsed.errors.map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">
                    {parsed.peptides.length} unique peptide{parsed.peptides.length === 1 ? "" : "s"}{" "}
                    ready.
                    {parsed.duplicatesRemoved > 0 &&
                      ` ${parsed.duplicatesRemoved} duplicate${parsed.duplicatesRemoved === 1 ? "" : "s"} removed.`}
                  </p>
                )}
              </div>
              <Button
                variant="link"
                size="sm"
                disabled={!hydrated || running}
                onClick={() => setInput(EXAMPLES)}
              >
                Load examples
              </Button>
            </div>
            <div className="mt-5 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              <p className="mb-1.5 font-semibold uppercase text-primary">Pipeline</p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>
                  Peptides are searched in UniProt to find exact matches in bacterial proteins, and
                  species taxonomy is retrieved.
                </li>
                <li>
                  Species are then checked using{" "}
                  <a
                    className="text-primary underline underline-offset-2"
                    href="https://bacdive.dsmz.de"
                    target="_blank"
                    rel="noreferrer"
                  >
                    BacDive (DSMZ)
                  </a>{" "}
                  biosafety level (BSL) and pathogenicity records. BSL ≥ 2 or reported pathogenicity
                  is listed as Potential Pathogenic.
                </li>
                <li>
                  Unclassified species are further checked against BV-BRC disease records. NCBI
                  Pathogen Detection provides surveillance context.
                </li>
                <li>
                  Positive pathogenicity evidence is listed as Potential Pathogenic, otherwise
                  Unclassified. BSL 1 alone does not establish commensalism.
                </li>
              </ol>
            </div>
          </div>
          <aside className="min-w-0 border-t border-border bg-muted/40 p-5 sm:p-7 lg:border-t-0">
            <h2 className="mb-5 border-b border-border pb-3 text-xs font-bold uppercase text-foreground">
              Search settings
            </h2>
            <div className="space-y-5">
              <div>
                <label
                  htmlFor="database"
                  className="mb-1.5 block text-xs font-semibold text-primary"
                >
                  Database
                </label>
                <select
                  id="database"
                  className={field}
                  disabled={!hydrated || running}
                  value={reviewedOnly ? "sp" : "all"}
                  onChange={(event) => setReviewedOnly(event.target.value === "sp")}
                >
                  <option value="all">All UniProtKB</option>
                  <option value="sp">Swiss-Prot only</option>
                </select>
                <p className={help}>
                  All entries cover more strains. Swiss-Prot includes manually reviewed proteins
                  only.
                </p>
              </div>
              <Button
                disabled={!hydrated || running || parsed.errors.length > 0}
                onClick={() => run(parsed.peptides, { il: false, spOnly: reviewedOnly })}
                className="h-11 w-full"
              >
                {!hydrated ? (
                  "Loading app…"
                ) : running ? (
                  "Running…"
                ) : (
                  <>
                    <Play size={16} fill="currentColor" /> Run search
                  </>
                )}
              </Button>
            </div>
          </aside>
        </section>

        {jobs.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 text-base font-semibold">Search results</h2>
            <div role="status" aria-live="polite" className="mb-3 text-sm">
              {running
                ? classificationProgress ||
                  `Protein searches: ${completedJobs.length} of ${jobs.length} complete${failedCount ? `, ${failedCount} failed` : ""}.`
                : `${completedJobs.length} of ${jobs.length} protein searches completed${failedCount ? `; ${failedCount} failed` : ""}.`}
            </div>
            {(failedCount > 0 || limitedCount > 0) && (
              <p
                role="alert"
                className="mb-3 rounded border border-destructive/30 p-3 text-sm text-destructive"
              >
                Results have incomplete coverage.
                {failedCount > 0 &&
                  ` ${failedCount} failed peptide search${failedCount === 1 ? " is" : "es are"} excluded from charts and exports.`}
                {limitedCount > 0 &&
                  ` ${limitedCount} search${limitedCount === 1 ? " was" : "es were"} limited to the first ${MAX_ACCESSIONS} UniProt entries; more bacterial matches may exist.`}
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full border border-border bg-card text-left text-sm">
                <thead className="bg-secondary text-secondary-foreground">
                  <tr>
                    {[
                      "Peptide",
                      "Status",
                      "Bacterial proteins",
                      "Organisms",
                      "Species",
                      "Pathogenic / Unclass. species",
                    ].map((label) => (
                      <th key={label} scope="col" className="px-3 py-2.5">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job, index) => {
                    const species = [...new Set(job.hits.map((hit) => hit.species))];
                    const byCategory = CATEGORIES.map(
                      (category) =>
                        species.filter(
                          (name) =>
                            (classifications[name]?.category ?? "Unclassified") === category,
                        ).length,
                    );
                    const ready = job.state === "complete";
                    return (
                      <tr key={job.peptide} className="border-t border-border">
                        <td className="px-3 py-2.5 font-mono text-primary">{job.peptide}</td>
                        <td className="min-w-52 px-3 py-2.5">
                          {job.status}
                          {job.error && <p className="mt-1 text-destructive">{job.error}</p>}
                          {job.total > MAX_ACCESSIONS && (
                            <p className="mt-1 text-destructive">
                              First {MAX_ACCESSIONS} of {job.total} UniProt entries processed.
                            </p>
                          )}
                          {job.state === "error" && (
                            <Button
                              size="sm"
                              variant="link"
                              disabled={running}
                              onClick={() => retry(index)}
                            >
                              Retry search
                            </Button>
                          )}
                        </td>
                        <td className="px-3 py-2.5">{ready ? job.hits.length : "—"}</td>
                        <td className="px-3 py-2.5">
                          {ready ? new Set(job.hits.map((hit) => hit.organism)).size : "—"}
                        </td>
                        <td className="px-3 py-2.5">{ready ? species.length : "—"}</td>
                        <td className="px-3 py-2.5">
                          {!ready
                            ? "—"
                            : running && job.hits.length > 0
                              ? "Evidence checks pending"
                              : byCategory.join(" / ")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {proteinWarnings.length > 0 && (
              <div role="alert" className="mt-4 rounded border border-destructive/30 p-3 text-sm">
                <p className="font-semibold">Some protein records need review.</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {proteinWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
            {warnings.length > 0 && (
              <div role="alert" className="mt-4 rounded border border-destructive/30 p-3 text-sm">
                <p className="font-semibold">Some species evidence checks could not finish.</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
                <Button
                  className="mt-3"
                  variant="outline"
                  size="sm"
                  disabled={running}
                  onClick={retryClassification}
                >
                  Retry species evidence
                </Button>
              </div>
            )}
          </section>
        )}

        {finished && hits.length === 0 && completedJobs.length > 0 && (
          <p className="mt-4 text-sm">
            {proteinWarnings.length
              ? "No bacterial matches were confirmed in the loaded records. Some protein records could not be verified; review the warnings."
              : "No bacterial matches were found in the completed searches."}
            {failedCount > 0 && " The failed searches have no result yet."}
          </p>
        )}
        {finished && hits.length > 0 && (
          <>
            <section className="mt-8 grid gap-5 lg:grid-cols-2">
              <Plot
                onDownload={() => downloadSvgAsPng(categoryChart.current, "species_evidence.png")}
              >
                <Heatmap
                  ref={categoryChart}
                  title="Potential pathogenic or unclassified species mapped per peptide"
                  rows={peptides}
                  cols={CATEGORIES}
                  values={categoryMatrix}
                  legendLabel="Species"
                />
              </Plot>
              <Plot onDownload={() => downloadSvgAsPng(phylumChart.current, "phylum_heatmap.png")}>
                <Heatmap
                  ref={phylumChart}
                  title="Taxonomic distribution (top phyla)"
                  rows={peptides}
                  cols={phyla}
                  values={phylumMatrix}
                  legendLabel="Species"
                />
              </Plot>
              <Plot
                onDownload={() =>
                  downloadSvgAsPng(locationChart.current, "subcellular_location.png")
                }
              >
                <LocationPie
                  ref={locationChart}
                  counts={locationCounts}
                  title="Subcellular location (UniProt)"
                />
              </Plot>
              <Plot onDownload={() => downloadSvgAsPng(cogChart.current, "cog_categories.png")}>
                <HorizontalBar ref={cogChart} items={cogItems} title="COG functional categories" />
              </Plot>
            </section>
          </>
        )}

        {finished && (
          <section className="mt-8 grid gap-5">
            <h2 className="text-base font-semibold">Peptide properties</h2>
            <Plot
              onDownload={() => downloadSvgAsPng(propertyChart.current, "peptide_properties.png")}
            >
              <Heatmap
                ref={propertyChart}
                title="Peptide properties (relative scale per property)"
                rows={propertyRows.map((row) => row.peptide)}
                cols={PROPERTY_COLUMNS.map((column) => column.label)}
                values={propertyValues}
                texts={propertyTexts}
                legendLabel="Relative"
              />
            </Plot>
            <div className="overflow-x-auto border border-border bg-card">
              <table className="w-full text-left text-sm">
                <thead className="bg-secondary text-secondary-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2.5">
                      Peptide
                    </th>
                    {PROPERTY_COLUMNS.map((column) => (
                      <th key={column.label} scope="col" className="px-3 py-2.5">
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {propertyRows.map((row) => (
                    <tr key={row.peptide} className="border-t border-border">
                      <td className="px-3 py-2.5 font-mono text-primary">{row.peptide}</td>
                      {PROPERTY_COLUMNS.map((column) => (
                        <td key={column.label} className="px-3 py-2.5">
                          {column.format(column.get(row))}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {finished && hits.length > 0 && (
          <>
            <section className="mt-8">
              <div className="mb-1 flex items-center justify-between">
                <h2 className="font-semibold">Hits ({hits.length})</h2>
                <Button variant="outline" size="sm" onClick={downloadCsv}>
                  <Download size={15} /> Download CSV
                </Button>
              </div>
              <div className="max-h-[500px] overflow-auto border border-border bg-card">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-secondary text-secondary-foreground">
                    <tr>
                      {[
                        "Peptide",
                        "Protein",
                        "Organism",
                        "Phylum",
                        "Category",
                        "Source",
                        "Signal",
                        "Location",
                        "COG",
                        "Position",
                        "Links",
                      ].map((label) => (
                        <th key={label} scope="col" className="px-3 py-2.5">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {hits.map((hit) => {
                      const classification = classifications[hit.species];
                      return (
                        <tr
                          key={`${hit.peptide}-${hit.accession}`}
                          className="border-t border-border"
                        >
                          <td className="px-3 py-2.5 font-mono text-primary">{hit.peptide}</td>
                          <td className="px-3 py-2.5">
                            {hit.protein}
                            {hit.reviewed && " ★"}
                          </td>
                          <td className="px-3 py-2.5 italic">{hit.organism}</td>
                          <td className="px-3 py-2.5">{hit.phylum}</td>
                          <td className="px-3 py-2.5">{categoryOf(hit)}</td>
                          <td className="min-w-56 px-3 py-2.5">
                            {classification?.source && classification.source !== "none" && (
                              <span className="font-semibold">{classification.source}: </span>
                            )}
                            {classification?.evidence || "No classification evidence"}
                            {classification?.note && (
                              <p className="mt-1 text-muted-foreground">{classification.note}</p>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            {hit.inSignal
                              ? "Peptide in signal peptide"
                              : hit.signal
                                ? "Protein has signal peptide"
                                : "—"}
                          </td>
                          <td className="px-3 py-2.5">{hit.location}</td>
                          <td className="px-3 py-2.5">{hit.cog}</td>
                          <td className="px-3 py-2.5">{hit.positions}</td>
                          <td className="space-x-2 whitespace-nowrap px-3 py-2.5 text-primary">
                            <a
                              className="underline underline-offset-2"
                              target="_blank"
                              rel="noreferrer"
                              href={`https://www.uniprot.org/uniprotkb/${hit.accession}`}
                            >
                              UniProt
                            </a>
                            {hit.taxid && (
                              <a
                                className="underline underline-offset-2"
                                target="_blank"
                                rel="noreferrer"
                                href={`https://www.ncbi.nlm.nih.gov/Taxonomy/Browser/wwwtax.cgi?id=${hit.taxid}`}
                              >
                                NCBI
                              </a>
                            )}
                            {classification?.bacdiveIds[0] ? (
                              <a
                                className="underline underline-offset-2"
                                target="_blank"
                                rel="noreferrer"
                                href={`https://bacdive.dsmz.de/strain/${classification.bacdiveIds[0]}`}
                              >
                                BacDive
                              </a>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className={help}>★ = Swiss-Prot reviewed entry.</p>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function Plot({
  children,
  onDownload,
}: {
  children: ReactNode;
  onDownload: () => void | Promise<void>;
}) {
  const [error, setError] = useState("");
  async function download() {
    setError("");
    try {
      await onDownload();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not export this chart.");
    }
  }
  return (
    <div className="min-w-0 overflow-x-auto border border-border bg-card p-4">
      <Button variant="outline" size="sm" onClick={download} className="mb-4">
        <Download size={15} /> Download PNG
      </Button>
      {error && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {children}
    </div>
  );
}
