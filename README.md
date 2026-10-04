# Bacterial Beacon

Find bacterial proteins that contain your peptide sequences, explore their taxonomy, and review available pathogenicity evidence. Download matched proteins as CSV and charts as PNG.

## Start on your computer

1. Install **Node.js 22.12 or newer** from [nodejs.org](https://nodejs.org). Node.js includes npm. Reopen your terminal after installing.
2. On GitHub, choose **Code → Download ZIP**, then extract the whole project.
3. Start the launcher for your computer. The first run downloads the required packages; keep its terminal open while using the app. The launchers also refresh packages after a project update.

| Computer | Start the app                                                                            |
| -------- | ---------------------------------------------------------------------------------------- |
| Windows  | Open `launchers/windows` and double-click `start.bat`.                                   |
| macOS    | Open Terminal in the extracted project folder and run `bash launchers/macos/start.sh`.   |
| Linux    | Open a terminal in the extracted project folder and run `bash launchers/linux/start.sh`. |

On macOS, open **Terminal** (Applications → Utilities). Type `cd `, including the space, drag the extracted project folder into Terminal, and press **Return**. Then run the macOS command in the table above.

Open **[http://localhost:8080](http://localhost:8080)**, enter one peptide per line, and click **Run search**. Peptides must contain 7–60 standard amino-acid letters; a run accepts up to 25 unique peptides. FASTA input is also supported. Press **Ctrl+C** in the terminal to stop the app.

If you prefer terminal commands, run these from the project folder:

```sh
npm ci
npm start
```

## Local app, online databases

The app runs on your computer and listens only on its local interface by default. Other computers cannot open it using your network address. Your local server sends search sequences and species queries to UniProt and the scientific data sources described in the [user guide](docs/user-guide.md). **An internet connection is required.**

UniProt is an external service: outages, rate limits and long queues can delay or prevent a search. The app retries temporary failures and reports errors so you can retry. No app can guarantee that UniProt is always available.

No API keys or database installation are needed for the current public endpoints.

## Help and project layout

- [Using the app, results and troubleshooting](docs/user-guide.md)
- [Developer setup, tests, production, Docker and intentional network access](docs/development.md)
- [Folder map and architecture](docs/architecture.md)
- [Validation results and service limitations](docs/testing.md)
- [Future work](docs/roadmap.md)

For everyday use, start from `launchers/`. Source code is in `src/`, tests are in `tests/`, and reference documentation is in `docs/`.

## License

[MIT](LICENSE)
