export type Location =
  | "Cytoplasm"
  | "Extracellular"
  | "Integral to membrane"
  | "Anchored to membrane"
  | "Cell wall"
  | "Unknown";

export type Hit = {
  peptide: string;
  accession: string;
  reviewed: boolean;
  protein: string;
  organism: string;
  species: string;
  taxid: string;
  phylum: string;
  positions: string;
  signal: boolean;
  inSignal: boolean;
  flanks: string[];
  location: Location;
  cog: string;
};

export type Category = "Potential Pathogenic" | "Potential Commensal" | "Unclassified";
export type Classification = {
  species: string;
  category: Category;
  bsl: number | null;
  bacdiveIds: number[];
  note?: string | undefined;
  source?: "BacDive" | "NCBI Pathogens" | "BV-BRC" | "Pathogens Portal" | "none" | undefined;
  evidence?: string | undefined;
};

// UniProt accessions have six or ten characters; peptide results may also contain isoforms.
export const ACCESSION_RE =
  /^(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})(?:-[1-9][0-9]*)?$/;
export const JOB_ID_RE = /^[A-Za-z0-9_-]{10,100}$/;
export const PEPTIDE_RE = /^[ACDEFGHIKLMNPQRSTVWY]{7,60}$/;
