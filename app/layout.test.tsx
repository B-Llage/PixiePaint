import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/script", () => ({ default: () => null }));

import RootLayout from "./layout";

describe("RootLayout color scheme", () => {
  it("forces the dark variant regardless of the system color scheme", () => {
    const markup = renderToStaticMarkup(<RootLayout><div>child</div></RootLayout>);
    expect(markup).toMatch(/<html[^>]*class="[^"]*\bdark\b/);

    // Tailwind's `dark:` variant must key off that class, not prefers-color-scheme,
    // or light-scheme users see white cards inside the always-dark editor shell.
    const css = readFileSync(join(__dirname, "globals.css"), "utf8");
    expect(css).toMatch(/@custom-variant dark \(&:where\(\.dark, \.dark \*\)\);/);
    expect(css).not.toMatch(/@media \(prefers-color-scheme/);
  });
});
