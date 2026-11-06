import { describe, expect, it } from "vitest";

import packageJson from "../package.json";
import { renderReleaseNotes } from "../scripts/release-notes.mjs";
import changelog from "./changelog.json";

const parseVersion = (version: string) => version.split(".").map(Number);
const compareVersions = (a: string, b: string) => {
  const [aMajor, aMinor, aPatch] = parseVersion(a);
  const [bMajor, bMinor, bPatch] = parseVersion(b);
  return aMajor - bMajor || aMinor - bMinor || aPatch - bPatch;
};

describe("changelog", () => {
  it("has a newest entry that matches the package version", () => {
    expect(changelog[0].version).toBe(packageJson.version);
  });

  it("lists versions newest first with no duplicates", () => {
    for (let index = 1; index < changelog.length; index += 1) {
      expect(compareVersions(changelog[index - 1].version, changelog[index].version)).toBeGreaterThan(0);
    }
  });

  it("renders release notes for a version and rejects unknown ones", () => {
    const notes = renderReleaseNotes(changelog, "0.2.1");
    expect(notes).toBe("## Maintenance Update\n\n- Updated Next.js and React to the latest stable releases.\n");
    expect(() => renderReleaseNotes(changelog, "9.9.9")).toThrow(/No changelog entry for version 9.9.9/);
  });
});
