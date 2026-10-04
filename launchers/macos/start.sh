#!/usr/bin/env bash
# Start Bacterial Beacon (macOS)
set -e
cd "$(dirname "$0")/../.."
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22.12+ is required. Install it from https://nodejs.org and re-run."
  exit 1
fi
if ! node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major>22||major===22&&minor>=12?0:1)"; then
  echo "Node.js 22.12 or newer is required. Update it at https://nodejs.org and re-run."
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required. Reinstall Node.js from https://nodejs.org and re-run."
  exit 1
fi
node scripts/ensure-dependencies.mjs
echo "Open http://localhost:8080 in your browser (Ctrl+C to stop)."
npm start
