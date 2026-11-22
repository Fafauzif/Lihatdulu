// Append one JSON line to the run ledger. Usage:
//   node tools/log-experiment.mjs '<json object>'
// The object is merged with a timestamp and written to experiments.jsonl.
import { appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ledger = join(here, "..", "experiments.jsonl");
const input = process.argv.slice(2).join(" ");
if (!input.trim()) {
  console.error("usage: node tools/log-experiment.mjs '<json object>'");
  process.exit(2);
}
const record = { ts: new Date().toISOString(), ...JSON.parse(input) };
await appendFile(ledger, `${JSON.stringify(record)}\n`, "utf8");
console.log(JSON.stringify(record));
