// Deliberately uses the real scientific services. Temporary upstream failures fail this check.
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import {
  submitPeptide,
  pollPeptide,
  loadPeptideDetails,
} from "../src/features/analysis/server/uniprot.ts";
import {
  classifySpeciesList,
  classifyFallbackList,
} from "../src/features/analysis/server/classification.ts";

const fixtures = JSON.parse(
  readFileSync(new URL("./fixtures/bacterial-peptides.json", import.meta.url), "utf8"),
);
const options = { attempts: 2, timeoutMs: 20_000 };
const report = {
  checkedAt: new Date().toISOString(),
  fixtureSeed: fixtures.seed,
  source: fixtures.source,
  inputs: [],
  downstream: [],
  classifications: [],
  errors: [],
  fullSearchPassed: false,
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (const input of fixtures.inputs) {
  const check = {
    peptide: input.peptide,
    expectedAccession: input.accession ?? null,
    searchPassed: false,
  };
  report.inputs.push(check);
  try {
    let submission;
    for (let attempt = 0; attempt < 2; attempt++) {
      submission = await submitPeptide(
        { peptide: input.peptide, il: false, spOnly: false },
        options,
      );
      if (!submission.busy) break;
      if (attempt === 0) await sleep(submission.retryAfterSeconds * 1000);
    }
    if (!submission || submission.busy)
      throw new Error(
        "UniProt peptide search is unavailable; this input was not successfully searched.",
      );
    const started = Date.now();
    let result;
    while (Date.now() - started < 180_000) {
      result = await pollPeptide(submission.jobId, options);
      if (result.done) break;
      await sleep(result.retryAfterSeconds * 1000);
    }
    if (!result?.done) throw new Error("UniProt peptide search did not finish within 3 minutes.");
    check.accessions = result.accessions;
    if (input.accession)
      assert.ok(
        result.accessions.includes(input.accession),
        `Expected source protein ${input.accession} in peptide search`,
      );
    else
      assert.equal(
        result.accessions.length,
        0,
        "Random negative control unexpectedly matches a protein; inspect the live result",
      );
    assert.ok(
      result.accessions.length <= 500,
      "This live check requires full coverage within its 500-accession limit",
    );
    const details = await loadPeptideDetails(
      { peptide: input.peptide, il: false, accessions: result.accessions },
      options,
    );
    check.hits = details.hits.length;
    check.warnings = details.warnings;
    if (input.accession) {
      assert.ok(
        details.hits.some((hit) => hit.accession === input.accession),
        "Source accession must survive bacterial protein mapping",
      );
    }
    assert.deepEqual(
      details.warnings,
      [],
      "Protein mapping must have no unresolved coverage warnings",
    );
    check.searchPassed = true;
    console.log(`SEARCH PASS ${input.peptide}: ${details.hits.length} bacterial hits`);
  } catch (error) {
    check.error = error instanceof Error ? error.message : String(error);
    report.errors.push(check.error);
    console.log(`SEARCH UNVERIFIED ${input.peptide}: ${check.error}`);
  }
}

// Independently validate the reachable REST stages using known provenance, not fabricated search results.
for (const input of fixtures.inputs.filter((row) => row.accession)) {
  try {
    const result = await loadPeptideDetails(
      { peptide: input.peptide, il: false, accessions: [input.accession] },
      options,
    );
    const hit = result.hits.find((row) => row.accession === input.accession);
    assert.ok(hit, `Expected ${input.accession} to contain the sampled peptide`);
    assert.ok(
      hit.positions.split(";").includes(`${input.start}-${input.end}`),
      "Source coordinates must be preserved",
    );
    assert.equal(hit.organism, input.organism);
    assert.notEqual(hit.phylum, "Unknown");
    report.downstream.push({ ...hit, flanks: undefined, passed: true });
    console.log(`REST PASS ${input.accession}: ${hit.organism}, ${hit.positions}, ${hit.phylum}`);
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error));
    report.downstream.push({ accession: input.accession, passed: false });
    console.log(`REST FAIL ${input.accession}: ${error}`);
  }
}
try {
  const species = [
    ...new Set(report.downstream.filter((row) => row.passed).map((row) => row.species)),
  ];
  const primary = await classifySpeciesList({ species }, options);
  const unresolved = primary.results
    .filter((row) => row.category === "Unclassified")
    .map((row) => row.species);
  const secondary = await classifyFallbackList({ species: unresolved }, options);
  report.classifications = primary.results.map(
    (row) =>
      secondary.results.find(
        (entry) => entry.species === row.species && entry.category !== "Unclassified",
      ) ?? row,
  );
  report.classificationWarnings = [...primary.warnings, ...secondary.warnings];
  console.log("CLASSIFICATION", JSON.stringify(report.classifications));
  if (report.classificationWarnings.length) report.errors.push(...report.classificationWarnings);
} catch (error) {
  report.errors.push(error instanceof Error ? error.message : String(error));
}
report.fullSearchPassed =
  report.inputs.every((row) => row.searchPassed) &&
  report.downstream.every((row) => row.passed) &&
  report.errors.length === 0;
mkdirSync("test-results", { recursive: true });
writeFileSync("test-results/live-pipeline.json", JSON.stringify(report, null, 2) + "\n");
console.log(
  `Live report: test-results/live-pipeline.json; full pipeline ${report.fullSearchPassed ? "PASS" : "NOT VERIFIED"}`,
);
if (!report.fullSearchPassed) process.exitCode = 1;
