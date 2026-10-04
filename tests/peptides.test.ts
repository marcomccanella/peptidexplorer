import assert from "node:assert/strict";
import test from "node:test";
import { parsePeptides } from "../src/features/analysis/model/peptides.ts";

test("plain peptide lines normalize case/whitespace and remove duplicates", () => {
  assert.deepEqual(parsePeptides("acdefgh\nAC DE FGH\nVVEEAPAPGITPEL\n"), {
    peptides: ["ACDEFGH", "VVEEAPAPGITPEL"],
    errors: [],
    duplicatesRemoved: 1,
  });
});

test("wrapped FASTA records become separate peptides", () => {
  const result = parsePeptides(">protein 1\nACDEF\nGHIK\n>protein 2\nVVEEAPAPGITPEL\n");
  assert.deepEqual(result.peptides, ["ACDEFGHIK", "VVEEAPAPGITPEL"]);
  assert.deepEqual(result.errors, []);
});

test("invalid characters and unsupported residues are rejected without stripping", () => {
  const result = parsePeptides("ACD-EFGH\nACDEFGX\nACDEFGH2\nACDEFGH");
  assert.deepEqual(result.peptides, ["ACDEFGH"]);
  assert.equal(result.errors.length, 3);
});

test("length bounds are checked including empty FASTA records", () => {
  const result = parsePeptides(
    `>empty\n>short\nACDEFG\n>long\n${"A".repeat(61)}\n>minimum\nACDEFGH\n>maximum\n${"A".repeat(60)}`,
  );
  assert.equal(result.errors.length, 3);
  assert.deepEqual(result.peptides, ["ACDEFGH", "A".repeat(60)]);
});

test("mixed FASTA input does not discard a sequence before its header", () => {
  assert.match(parsePeptides("ACDEFGH\n>record\nVVEEAPAPGITPEL").errors[0]!, /before/);
});

test("over-limit batches and blank input show errors instead of silently truncating", () => {
  const peptides = Array.from({ length: 26 }, (_, i) => "A".repeat(7 + i));
  const result = parsePeptides(peptides.join("\n"));
  assert.equal(result.peptides.length, 26);
  assert.match(result.errors[0]!, /no more than 25/);
  assert.match(parsePeptides("  \n").errors[0]!, /at least one/);
});
