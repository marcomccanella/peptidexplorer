// Full browser verification against the built Node server and real scientific services.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";

const fixtures = JSON.parse(
  readFileSync(new URL("./fixtures/bacterial-peptides.json", import.meta.url), "utf8"),
);
const report = {
  checkedAt: new Date().toISOString(),
  origin: "http://127.0.0.1:8082",
  fixtureSeed: fixtures.seed,
  passed: false,
  externalBrowserRequests: [],
  browserErrors: [],
};
let serverLog = "";
const server = spawn(process.execPath, ["scripts/serve-production.mjs"], {
  env: { ...process.env, HOST: "127.0.0.1", PORT: "8082" },
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => {
  serverLog += chunk;
});
server.stderr.on("data", (chunk) => {
  serverLog += chunk;
});
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (server.exitCode !== null) throw new Error(`Production server stopped: ${serverLog}`);
    try {
      ready = (await fetch(report.origin, { signal: AbortSignal.timeout(1000) })).ok;
      if (ready) break;
    } catch {
      /* Wait until this test's local server is ready. */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(ready, "Production server did not start");
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  page.on("pageerror", (error) => report.browserErrors.push(error.message));
  page.on("request", (request) => {
    if (/uniprot|bacdive|bv-brc|ebi\.ac\.uk/.test(new URL(request.url()).hostname))
      report.externalBrowserRequests.push(request.url());
  });
  await page.goto(report.origin);
  await expect(page.locator("#peptides")).toBeEnabled();
  await expect(page.getByRole("checkbox", { name: /Treat I and L|I\s*[=/]\s*L/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Treat I and L|I\s*[=/]\s*L/i })).toHaveCount(0);
  await expect(page.getByLabel("Database", { exact: true })).toHaveValue("all");
  await page.locator("#peptides").fill(fixtures.inputs.map((row) => row.peptide).join("\n"));
  await page.getByRole("button", { name: "Run search", exact: true }).click();
  await expect(page.getByText("Protein search complete", { exact: true })).toHaveCount(3, {
    timeout: 240_000,
  });
  await expect(page.getByText("No bacterial matches", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run search", exact: true })).toBeEnabled({
    timeout: 180_000,
  });
  await expect(
    page.getByRole("img", {
      name: "Potential pathogenic or unclassified species mapped per peptide",
      exact: true,
    }),
  ).toBeVisible();
  for (const row of fixtures.inputs.filter((input) => input.accession)) {
    await expect(
      page.locator(`a[href='https://www.uniprot.org/uniprotkb/${row.accession}']`),
    ).toBeVisible();
  }
  mkdirSync("test-results", { recursive: true });
  const csvReady = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV", exact: true }).click();
  const csv = await csvReady;
  const csvPath = "test-results/live-browser-hits.csv";
  await csv.saveAs(csvPath);
  const contents = readFileSync(csvPath, "utf8");
  for (const row of fixtures.inputs.filter((input) => input.accession)) {
    assert.ok(contents.includes(row.peptide), `CSV missing ${row.peptide}`);
    assert.ok(contents.includes(row.accession), `CSV missing source ${row.accession}`);
    assert.ok(
      contents.includes(`${row.start}-${row.end}`),
      `CSV missing source coordinates for ${row.accession}`,
    );
  }
  const pngReady = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PNG", exact: true }).first().click();
  const png = await pngReady;
  await png.saveAs("test-results/live-browser-species.png");
  assert.equal(
    readFileSync("test-results/live-browser-species.png").subarray(0, 8).toString("hex"),
    "89504e470d0a1a0a",
  );
  report.matchingProteinPairs = contents.split("\n").length - 1;
  report.visibleWarnings = await page.getByRole("alert").allTextContents();
  report.status = await page.getByRole("status").allTextContents();
  assert.deepEqual(report.browserErrors, []);
  assert.deepEqual(report.externalBrowserRequests, []);
  assert.deepEqual(report.visibleWarnings, []);
  await page.screenshot({ path: "test-results/live-browser.png", fullPage: true });
  report.passed = true;
  console.log(
    `LIVE BROWSER PASS: ${report.matchingProteinPairs} peptide–protein pairs; positive source matches, negative control, species evidence, CSV and PNG verified.`,
  );
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  console.error(`LIVE BROWSER FAILED: ${report.error}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/live-browser.json", JSON.stringify(report, null, 2) + "\n");
}
