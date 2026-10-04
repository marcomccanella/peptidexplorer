export const MAX_PEPTIDES = 25;
export const MIN_PEPTIDE_LENGTH = 7;
export const MAX_PEPTIDE_LENGTH = 60;
export const AMINO_ACIDS = "ACDEFGHIKLMNPQRSTVWY";

export type ParsedPeptides = {
  peptides: string[];
  errors: string[];
  duplicatesRemoved: number;
};

/** Parse plain lines or wrapped FASTA without silently changing invalid sequences. */
export function parsePeptides(text: string): ParsedPeptides {
  const records: { label: string; sequence: string }[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/);
  const fasta = lines.some((line) => line.trim().startsWith(">"));
  let record: { label: string; sequence: string } | undefined;

  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    if (line.startsWith(">")) {
      if (record) records.push(record);
      record = { label: line.slice(1).trim() || `FASTA record on line ${index + 1}`, sequence: "" };
    } else if (fasta) {
      if (!record) errors.push(`Line ${index + 1}: put a FASTA header (>) before the sequence.`);
      else record.sequence += line.replace(/\s/g, "");
    } else {
      records.push({ label: `Line ${index + 1}`, sequence: line.replace(/\s/g, "") });
    }
  });
  if (record) records.push(record);

  const peptides: string[] = [];
  const seen = new Set<string>();
  let duplicatesRemoved = 0;
  for (const { label, sequence } of records) {
    const peptide = sequence.toUpperCase();
    const invalid = [...new Set([...peptide].filter((residue) => !AMINO_ACIDS.includes(residue)))];
    if (invalid.length) {
      errors.push(
        `${label}: unsupported characters ${invalid.join(", ")}. Use the 20 standard amino-acid letters; remove modifications, numbers, and punctuation.`,
      );
    } else if (peptide.length < MIN_PEPTIDE_LENGTH || peptide.length > MAX_PEPTIDE_LENGTH) {
      errors.push(
        `${label}: ${peptide.length} residues; each peptide must contain ${MIN_PEPTIDE_LENGTH}–${MAX_PEPTIDE_LENGTH}.`,
      );
    } else if (seen.has(peptide)) {
      duplicatesRemoved++;
    } else {
      seen.add(peptide);
      peptides.push(peptide);
    }
  }
  if (!records.length && !errors.length) errors.push("Enter at least one peptide sequence.");
  if (peptides.length > MAX_PEPTIDES)
    errors.push(
      `There are ${peptides.length} unique peptides. Submit no more than ${MAX_PEPTIDES} per search.`,
    );
  return { peptides, errors, duplicatesRemoved };
}
