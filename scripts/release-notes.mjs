// Prints the GitHub Release notes for one version from app/changelog.json.
// Usage: node scripts/release-notes.mjs <version>
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * @param {ReadonlyArray<{ version: string; title: string; changes: readonly string[] }>} entries
 * @param {string} version
 */
export function renderReleaseNotes(entries, version) {
  const entry = entries.find((item) => item.version === version);
  if (!entry) {
    throw new Error(`No changelog entry for version ${version}. Add one to app/changelog.json.`);
  }
  return [`## ${entry.title}`, "", ...entry.changes.map((change) => `- ${change}`), ""].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = process.argv[2];
  if (!version) {
    console.error("Usage: node scripts/release-notes.mjs <version>");
    process.exit(1);
  }
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const entries = JSON.parse(readFileSync(join(root, "app", "changelog.json"), "utf8"));
  process.stdout.write(renderReleaseNotes(entries, version));
}
