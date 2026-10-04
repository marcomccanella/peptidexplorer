import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const lock = new URL("../package-lock.json", import.meta.url);
const marker = new URL("../node_modules/.beacon-dependencies", import.meta.url);
const vite = new URL("../node_modules/vite/package.json", import.meta.url);
const fingerprint = createHash("sha256").update(readFileSync(lock)).digest("hex");

if (!existsSync(vite) || !existsSync(marker) || readFileSync(marker, "utf8") !== fingerprint) {
  console.log("Installing required packages (first start or project update)...");
  const windows = process.platform === "win32";
  const result = spawnSync(windows ? "npm.cmd" : "npm", ["ci"], {
    cwd: root,
    stdio: "inherit",
    shell: windows,
  });
  if (result.error || result.status !== 0) {
    console.error("Installation failed. Check your internet connection and start again.");
    process.exit(1);
  }
  writeFileSync(marker, fingerprint);
}
