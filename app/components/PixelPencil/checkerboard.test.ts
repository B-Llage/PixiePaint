import { describe, expect, it } from "vitest";

import { checkerboardStyle } from "./checkerboard";

describe("checkerboardStyle", () => {
  it("offsets the second tile by half a cell", () => {
    expect(checkerboardStyle(8)).toEqual({
      backgroundImage:
        "linear-gradient(45deg, #d1d5db 25%, transparent 25%, transparent 75%, #d1d5db 75%, #d1d5db), linear-gradient(45deg, #d1d5db 25%, transparent 25%, transparent 75%, #d1d5db 75%, #d1d5db)",
      backgroundSize: "8px 8px",
      backgroundPosition: "0 0, 4px 4px",
    });
  });

  it("accepts a custom tile color", () => {
    const style = checkerboardStyle(6, "rgba(0,0,0,0.2)");
    expect(style.backgroundImage).toContain("rgba(0,0,0,0.2) 25%");
    expect(style.backgroundPosition).toBe("0 0, 3px 3px");
  });
});
