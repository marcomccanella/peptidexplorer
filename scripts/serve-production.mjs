import { existsSync } from "node:fs";

const entry = new URL("../dist/server/index.mjs", import.meta.url);
if (!existsSync(entry)) {
  console.error("Build the app first with: npm run build");
  process.exit(1);
}

process.env.HOST ??= "127.0.0.1";
process.env.PORT ??= "8080";
await import(entry.href);
