# Verification

The checks below were run on 4 October 2026 on Windows with Node.js 22.23.3 and headless Chrome. The runtime was installed separately from the project; no portable runtime is included in the repository.

## Recorded results

| Check                                                                        | Result                                                                           |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Clean dependency installation and launcher dependency check                  | Passed; a second check reused the installed packages                             |
| TypeScript                                                                   | Passed                                                                           |
| ESLint                                                                       | Passed                                                                           |
| Production Node build                                                        | Passed                                                                           |
| Parser and scientific request regression tests                               | 26 passed                                                                        |
| Browser regression tests with controlled scientific responses                | 4 passed                                                                         |
| Real UniProt search, REST mapping and BacDive classification                 | Passed for three bacterial peptides and a synthetic control                      |
| Real browser through the built server, species evidence, charts, CSV and PNG | Passed; 41 peptide–protein pairs, no browser errors or evidence-service warnings |

The browser regression tests call the real app server. Only the scientific upstream responses are controlled by a test-process preload; that preload is never loaded by the app launchers or production server. These tests also verify invalid input and failure followed by retry. Scientific requests originate from the server, and both browser runs verified that the browser itself made no scientific API requests.

The live checks used randomly selected 18–25-residue windows from live, reviewed bacterial UniProt protein records, with seed `20261004`. The additional 35-residue control was generated from the 20 standard amino acids. It returned no matches in the recorded live run.

| Source organism   | Source protein | Peptide                               | Source positions | Bacterial protein matches |
| ----------------- | -------------- | ------------------------------------- | ---------------- | ------------------------- |
| E. coli K12       | P00803         | `VTYDPVSKELTIQPGCSS`                  | 156–173          | 13                        |
| B. subtilis 168   | O07595         | `DLPHLLEREVPECTAAGNNGDI`              | 134–155          | 2                         |
| S. aureus         | P00644         | `DTPETKHPKKGVEKYGPEAS`                | 122–141          | 26                        |
| Synthetic control | —              | `FPYNHHEIGKPKHFIDFQQINCIKPNKKYMAAYMW` | —                | 0                         |

Source accessions and original coordinates appeared in the downloaded CSV. The exported chart passed its PNG signature check. These match counts describe that database run, not stable expected counts for every future database release.

Machine-readable records: [scientific stages](validation/live-pipeline-2026-10-04.json), [full live browser](validation/live-browser-2026-10-04.json). Reproducible input provenance is in [bacterial-peptides.json](../tests/fixtures/bacterial-peptides.json).

## Run the checks again

From the project root:

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run test:live
node tests/live-browser.mjs
```

The last two checks contact real services and can fail when those services are busy, unreachable or have changed their data. The live browser script starts and stops its own production server on loopback port 8082 and writes CSV, PNG, screenshot and JSON artifacts into ignored `test-results/`. If using installed Chrome instead of Playwright's Chromium, set `PLAYWRIGHT_CHANNEL=chrome` in your shell.

## Availability and interpretation

UniProt initially returned HTTP 503 during this work, then recovered. A successful test cannot guarantee future upstream availability. The app uses request deadlines, bounded retries, queue delays and visible failure states. Failed or limited searches are identified in the results and excluded from misleading complete-result summaries.

Live positive controls caught two integration details now covered by regression tests: UniProt may return an HTTP job URL even for an HTTPS submission, and its peptide API taxon filters match exact organism IDs. Searching exact taxon ID 2 returned no matches for known bacterial peptides. The app therefore polls on HTTPS, searches without that exact-taxon restriction, retrieves the requested UniProt REST records, and filters bacterial lineages on the server. Missing or inconsistent protein records produce visible warnings and a coverage note in CSV exports.

Species evidence is qualified: BacDive examines up to 50 strain records and reports its sample coverage; BV-BRC examines up to 200 genome records. Biosafety level 1, surveillance membership and lack of disease evidence do not establish commensalism. The interface reports potential pathogenic evidence or an unclassified result.
