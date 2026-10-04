# Using Bacterial Beacon

## Enter peptides

Paste one sequence per line, or paste FASTA records whose sequence lines may wrap. Use the 20 standard amino-acid letters, with 7–60 residues per peptide. Input is converted to uppercase; repeated peptides are searched once. A run accepts at most 25 unique peptides. Invalid sequences are shown before a search starts.

Click **Run search**. The app searches UniProt, loads bacterial protein records, then looks up species classification evidence. Status messages show the current stage. A random sequence may correctly return no matching bacterial proteins.

## Search settings

The **Database** selector defaults to **All UniProtKB** with an exact sequence match. Choose **Swiss-Prot only** when you want manually reviewed entries. This can exclude real matches in unreviewed entries.

Taxonomy and pathogenicity charts count distinct species per peptide. Location and COG charts count unique matched proteins. These units are labeled on the charts.

## Read the results

The search first finds matching protein accessions, then loads their details from UniProt REST and keeps bacterial records. The app reports species, phyla, protein locations, signal-peptide annotations and COG categories when those annotations exist. Missing annotations remain unknown.

Peptide properties are calculated locally: length, molecular weight, charge at pH 7, estimated pI, hydropathy and aromaticity.

Classification uses BacDive biosafety/pathogenicity records first. A biosafety level of 2 or higher, or a listed positive pathogenicity annotation, provides evidence for **Potential Pathogenic**. Biosafety level 1 by itself does not establish that an organism is commensal. Missing evidence remains **Unclassified**. An explicit BV-BRC disease annotation can provide fallback pathogenicity evidence. Membership in the bundled NCBI Pathogen Detection organism groups provides surveillance context but does not establish pathogenicity. These are evidence labels, not a determination that every strain of a species causes disease.

BacDive species queries examine at most 50 strain records. When more strains are available, the app marks the classification as a sample. Evidence may differ between strains.

A database failure is different from an empty result. Read warnings for unavailable sources, missing protein details or result limits before interpreting charts. Use **Retry** for a failed peptide once connectivity or the service has recovered.

Use the CSV button to download matched proteins and the PNG buttons to save charts.

## Where the app runs

With the supplied launchers, the browser and app server run on your own computer at `http://localhost:8080`. `localhost` refers to the computer opening the browser. It is a local address; a search still needs internet access.

The browser calls the local app server. That server contacts external services over HTTPS, including `peptidesearch.uniprot.org`, `rest.uniprot.org`, `api.bacdive.dsmz.de` and `www.bv-brc.org`. Peptide sequences and species names needed for those lookups leave your computer. Peptide-property calculations and chart rendering happen locally.

A Node.js server is required. Opening a downloaded HTML file or hosting only static files on GitHub Pages cannot run this pipeline. See [developer setup](development.md) for a production server or deliberate network access.

## Troubleshooting

| Problem                               | What to do                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Node.js or npm is missing             | Install Node.js 22.12 or newer and reopen the terminal.                                                                         |
| First installation fails              | Check your internet connection, then run the launcher again. You can also run `npm ci` from the project folder.                 |
| The page does not open                | Keep the launcher terminal open and wait for the local address. Open `http://localhost:8080` in a browser on the same computer. |
| Port 8080 is in use                   | Stop the other app, or run `npm start -- --port 8081` from the project folder and open `http://localhost:8081`.                 |
| UniProt is busy or a search times out | Wait and retry the failed peptide. Automatic retries are limited, and UniProt can have outages or long queues.                  |
| Classification is incomplete          | Review source warnings. A failed evidence source must not be interpreted as proof that a species is harmless.                   |
| A random peptide has no hits          | A valid sequence may have no bacterial match. Try the example peptides to check the pipeline.                                   |
| Corporate network blocks searches     | Ask your network administrator whether the HTTPS database domains listed above are reachable.                                   |
| You downloaded an updated project     | Stop the app and run the launcher again. It refreshes changed packages. For manual setup, run `npm ci`, then `npm start`.       |

The public BacDive v2 endpoints used by this app do not require a login. There is no credential setup step.
