import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { BucketTool, ColorPickerTool, EraserTool, LineTool, MagnifierTool, MoveTool, PencilTool, RectSelectionTool, ShapeTool } from "./PixelPencilTools";

const tools = [PencilTool, EraserTool, BucketTool, ColorPickerTool, LineTool, ShapeTool, RectSelectionTool, MoveTool, MagnifierTool];

function pngDimensions(publicPath: string) {
  const png = readFileSync(join(process.cwd(), "public", publicPath.slice(1)));
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

describe("tool cursor assets", () => {
  it.each(tools)("provides a cursor twice the size of the %s toolbar icon", (tool) => {
    const icon = pngDimensions(tool.icon);
    const cursor = pngDimensions(tool.cursorIcon);
    expect(icon).toEqual({ width: 16, height: 16 });
    expect(cursor).toEqual({ width: 32, height: 32 });
  });
});
