import { createFileRoute } from "@tanstack/react-router";
import { AnalysisScreen } from "@/features/analysis/components/analysis-screen";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Peptide Taxonomy & Bacterial Pathogenicity" },
      {
        name: "description",
        content:
          "Find which bacteria contain a peptide with UniProt Peptide Search and review species pathogenicity evidence from BacDive.",
      },
      { property: "og:title", content: "Peptide Taxonomy & Bacterial Pathogenicity" },
      {
        property: "og:description",
        content:
          "Peptide → bacterial proteins and species (UniProt) → pathogenicity evidence (BacDive). Heatmaps as PNG.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AnalysisScreen,
});
