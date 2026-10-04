import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const fixtures = JSON.parse(
  readFileSync(new URL("../fixtures/bacterial-peptides.json", import.meta.url), "utf8"),
) as {
  inputs: { peptide: string; accession?: string; organism?: string }[];
};

async function expectExactMatchingControls(page: import("@playwright/test").Page) {
  await expect(page.getByRole("checkbox", { name: /Treat I and L|I\s*[=/]\s*L/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Treat I and L|I\s*[=/]\s*L/i })).toHaveCount(0);
  const database = page.getByLabel("Database", { exact: true });
  await expect(database).toHaveValue("all");
  await database.selectOption("sp");
  await expect(database).toHaveValue("sp");
  await database.selectOption("all");
}

test("random bacterial peptide fixtures complete through the server, charts and downloads", async ({
  page,
}) => {
  const errors: string[] = [];
  const externalRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (/uniprot|bacdive|bv-brc|ebi\.ac\.uk/.test(new URL(request.url()).hostname))
      externalRequests.push(request.url());
  });
  await page.goto("/");
  await expect(page.locator("#peptides")).toBeEnabled();
  await expectExactMatchingControls(page);
  await page.locator("textarea").fill(fixtures.inputs.map((input) => input.peptide).join("\n"));
  await page.getByRole("button", { name: "Run search", exact: true }).click();
  await expect(page.getByRole("button", { name: "Run search", exact: true })).toBeEnabled({
    timeout: 90_000,
  });
  await expect(page.getByText("No bacterial matches", { exact: true })).toBeVisible();
  await expect(page.getByText("Protein search complete", { exact: true })).toHaveCount(3);
  for (const input of fixtures.inputs.filter((row) => row.accession)) {
    await expect(
      page.locator(`a[href='https://www.uniprot.org/uniprotkb/${input.accession}']`),
    ).toBeVisible();
  }
  await expect(
    page.getByRole("img", {
      name: "Potential pathogenic or unclassified species mapped per peptide",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "COG functional categories", exact: true }),
  ).toBeVisible();
  const csvDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV", exact: true }).click();
  const csv = await csvDownload;
  const contents = readFileSync((await csv.path())!, "utf8");
  for (const input of fixtures.inputs.filter((row) => row.accession)) {
    expect(contents).toContain(input.peptide);
    expect(contents).toContain(input.accession);
  }
  expect(contents).toContain("Unclassified");
  const pngDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PNG", exact: true }).first().click();
  const png = await pngDownload;
  expect(
    readFileSync((await png.path())!)
      .subarray(0, 8)
      .toString("hex"),
  ).toBe("89504e470d0a1a0a");
  expect(externalRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("invalid amino acids are explained before any search", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#peptides")).toBeEnabled();
  await page.locator("textarea").fill("PEPTIDE123");
  await expect(page.getByRole("button", { name: "Run search", exact: true })).toBeDisabled();
  await expect(page.locator("#input-feedback")).toContainText(/invalid|standard|letters/i);
  await expect(page.getByText("Submitting to UniProt", { exact: true })).toHaveCount(0);
});

test("an upstream failure stays separate from successful negative results", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#peptides")).toBeEnabled();
  await page.locator("textarea").fill("AAAAAAA");
  await page.getByRole("button", { name: "Run search", exact: true }).click();
  await expect(page.getByRole("cell", { name: /^Search failed/ })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("incomplete coverage");
  await expect(page.getByRole("cell", { name: "—", exact: true })).toHaveCount(4);
  await expect(
    page.getByText(/No bacterial matches were found in the completed searches/),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Retry search", exact: true }).click();
  await expect(page.getByText("No bacterial matches", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("missing protein records stay visible in coverage and never become a verified negative result", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#peptides")).toBeEnabled();
  await page.locator("#peptides").fill("VTYDPVSKELTIQPGCSS");
  await page.getByRole("button", { name: "Run search", exact: true }).click();
  await expect(
    page.getByText("Finished; review protein record warnings", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Run search", exact: true })).toBeEnabled();
  await expect(page.getByRole("alert")).toContainText("Q9ZZZ9");
  const csvReady = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV", exact: true }).click();
  const csv = await csvReady;
  const contents = readFileSync((await csv.path())!, "utf8");
  expect(contents).toContain("needs review: protein record warnings");
  expect(contents).toContain("Q9ZZZ9");
  await page.locator("#peptides").fill("CCCCCCC");
  await page.getByRole("button", { name: "Run search", exact: true }).click();
  await expect(
    page.getByText("Finished; review protein record warnings", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("No bacterial matches", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Some protein records could not be verified/)).toBeVisible();
});
