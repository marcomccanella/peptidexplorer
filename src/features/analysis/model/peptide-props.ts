// Local peptide property computations (no external services).

export type PeptideProps = {
  peptide: string;
  length: number;
  mw: number;
  charge7: number;
  pi: number;
  gravy: number;
  aromaticity: number;
};

// Average residue masses (free aa minus H2O), Da
const RES_MW: Record<string, number> = {
  A: 71.08,
  R: 156.19,
  N: 114.1,
  D: 115.09,
  C: 103.14,
  E: 129.12,
  Q: 128.13,
  G: 57.05,
  H: 137.14,
  I: 113.16,
  L: 113.16,
  K: 128.17,
  M: 131.2,
  F: 147.18,
  P: 97.12,
  S: 87.08,
  T: 101.11,
  W: 186.21,
  Y: 163.18,
  V: 99.13,
};

// Kyte–Doolittle hydropathy
const GRAVY_KD: Record<string, number> = {
  A: 1.8,
  R: -4.5,
  N: -3.5,
  D: -3.5,
  C: 2.5,
  Q: -3.5,
  E: -3.5,
  G: -0.4,
  H: -3.2,
  I: 4.5,
  L: 3.8,
  K: -3.9,
  M: 1.9,
  F: 2.8,
  P: -1.6,
  S: -0.8,
  T: -0.7,
  W: -0.9,
  Y: -1.3,
  V: 4.2,
};

const PKA = { nterm: 9.6, cterm: 2.4, K: 10.5, R: 12.5, H: 6.0, D: 3.9, E: 4.1, C: 8.3, Y: 10.1 };

function chargeAt(seq: string, pH: number): number {
  let pos = 1 / (1 + 10 ** (pH - PKA.nterm));
  let neg = 1 / (1 + 10 ** (PKA.cterm - pH));
  for (const r of seq) {
    if (r === "K" || r === "R" || r === "H") pos += 1 / (1 + 10 ** (pH - PKA[r]));
    else if (r === "D" || r === "E" || r === "C" || r === "Y") neg += 1 / (1 + 10 ** (PKA[r] - pH));
  }
  return pos - neg;
}

export function peptideProps(peptide: string): PeptideProps {
  const seq = peptide.replace(/[^A-Z]/g, "").toUpperCase();
  const n = seq.length;
  const counts: Record<string, number> = {};
  for (const r of seq) counts[r] = (counts[r] ?? 0) + 1;
  let mw = 18.02; // + one H2O
  for (const [r, c] of Object.entries(counts)) mw += (RES_MW[r] ?? 110) * c;
  const gravy = n
    ? Object.entries(counts).reduce((s, [r, c]) => s + (GRAVY_KD[r] ?? 0) * c, 0) / n
    : 0;
  const aromaticity = n ? ((counts["F"] ?? 0) + (counts["W"] ?? 0) + (counts["Y"] ?? 0)) / n : 0;
  let lo = 0;
  let hi = 14;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (chargeAt(seq, mid) > 0) lo = mid;
    else hi = mid;
  }
  return {
    peptide: seq,
    length: n,
    mw,
    charge7: chargeAt(seq, 7),
    pi: (lo + hi) / 2,
    gravy,
    aromaticity,
  };
}

// Residue frequencies per flanking position from 30-character strings
// (15 residues before + 15 after each peptide match). Index 0..14 =
// positions −15..−1, index 15..29 = +1..+15.
export function contextLogo(flanks: string[]): Record<string, number>[] {
  const cols: Record<string, number>[] = Array.from({ length: 30 }, () => ({}));
  for (const f of flanks) {
    if (f.length < 30) continue;
    const pre = f.slice(0, 15);
    const post = f.slice(15);
    for (let i = 0; i < 15; i++) {
      const a = pre[i];
      const b = post[i];
      if (a && /[A-Z]/.test(a)) cols[i]![a] = (cols[i]![a] ?? 0) + 1;
      if (b && /[A-Z]/.test(b)) cols[15 + i]![b] = (cols[15 + i]![b] ?? 0) + 1;
    }
  }
  return cols;
}
