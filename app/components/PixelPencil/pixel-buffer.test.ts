import { describe, expect, it } from "vitest";

import {
  cloneBuffer,
  composeInto,
  copyRect,
  copyShiftedRect,
  createBuffer,
  EMPTY_PIXEL,
  extractRect,
  fillCells,
  fillMask,
  intersectRect,
  isBufferEmpty,
  isPaintedPixel,
  nonEmptyBounds,
  packColor,
  rectFromIndices,
  resizeBuffer,
  toPackedValue,
  TRANSPARENT_PIXEL,
  translateBuffer,
  unionRect,
  unpackColor,
  writeRect,
} from "./pixel-buffer";

const W = 8;
const H = 6;
const at = (x: number, y: number) => y * W + x;
const RED = packColor("#ff0000");
const BLUE = packColor("#0000ff");

describe("pixel-buffer", () => {
  it("packs and unpacks colors through ImageData byte order", () => {
    const packed = packColor("#FF8000");
    const bytes = new Uint8Array(new Uint32Array([packed]).buffer);
    expect([...bytes]).toEqual([255, 128, 0, 255]);
    expect(unpackColor(packed)).toBe("#ff8000");
    expect(unpackColor(packColor("#abc"))).toBe("#aabbcc");
    expect(toPackedValue(null)).toBe(EMPTY_PIXEL);
    expect(toPackedValue("transparent")).toBe(TRANSPARENT_PIXEL);
    expect(toPackedValue("#00ff00")).toBe(packColor("#00ff00"));
    expect(unpackColor(EMPTY_PIXEL)).toBeNull();
    expect(unpackColor(TRANSPARENT_PIXEL)).toBe("transparent");
    expect(isPaintedPixel(TRANSPARENT_PIXEL)).toBe(false);
    expect(isPaintedPixel(EMPTY_PIXEL)).toBe(false);
    expect(isPaintedPixel(RED)).toBe(true);
  });

  it("creates, clones and inspects buffers", () => {
    const buffer = createBuffer(W, H);
    expect(buffer.data).toHaveLength(W * H);
    expect(isBufferEmpty(buffer)).toBe(true);
    buffer.data[3] = TRANSPARENT_PIXEL;
    expect(isBufferEmpty(buffer)).toBe(false);
    const clone = cloneBuffer(buffer);
    clone.data[3] = 0;
    expect(buffer.data[3]).toBe(TRANSPARENT_PIXEL);
    expect(clone).toMatchObject({ width: W, height: H });
  });

  it("computes, unions and intersects rects", () => {
    const buffer = createBuffer(W, H);
    expect(rectFromIndices(buffer, [])).toBeNull();
    expect(rectFromIndices(buffer, [at(1, 1), at(3, 4)])).toEqual({ x: 1, y: 1, width: 3, height: 4 });
    const a = { x: 0, y: 0, width: 2, height: 2 };
    const b = { x: 3, y: 1, width: 2, height: 4 };
    expect(unionRect(a, b)).toEqual({ x: 0, y: 0, width: 5, height: 5 });
    expect(unionRect(null, b)).toEqual(b);
    expect(unionRect(a, null)).toEqual(a);
    expect(unionRect(null, null)).toBeNull();
    expect(intersectRect({ x: 0, y: 0, width: 4, height: 4 }, { x: 2, y: 2, width: 4, height: 4 })).toEqual({
      x: 2,
      y: 2,
      width: 2,
      height: 2,
    });
    expect(intersectRect(a, b)).toBeNull();
  });

  it("fillCells returns the bounding rect of changed cells and null when nothing changes", () => {
    const buffer = createBuffer(W, H);
    expect(fillCells(buffer, [9, 10, 17], RED)).toEqual({ x: 1, y: 1, width: 2, height: 2 });
    expect(fillCells(buffer, [9], RED)).toBeNull();
    expect(fillCells(buffer, [9, 12], RED)).toEqual({ x: 4, y: 1, width: 1, height: 1 });
  });

  it("fillMask only writes cells set in the mask inside bounds", () => {
    const buffer = createBuffer(W, H);
    const mask = new Uint8Array(W * H);
    mask[at(2, 2)] = 1;
    mask[at(3, 3)] = 1;
    mask[at(7, 5)] = 1; // outside bounds
    const bounds = { x: 1, y: 1, width: 4, height: 4 };
    expect(fillMask(buffer, mask, bounds, RED)).toEqual({ x: 2, y: 2, width: 2, height: 2 });
    expect(buffer.data[at(2, 2)]).toBe(RED);
    expect(buffer.data[at(3, 3)]).toBe(RED);
    expect(buffer.data[at(7, 5)]).toBe(EMPTY_PIXEL);
    expect(fillMask(buffer, mask, bounds, RED)).toBeNull();
    // bounds extending past the buffer are clipped
    expect(fillMask(buffer, mask, { x: 6, y: 4, width: 10, height: 10 }, BLUE)).toEqual({
      x: 7,
      y: 5,
      width: 1,
      height: 1,
    });
  });

  it("extractRect and writeRect round trip a rectangle", () => {
    const buffer = createBuffer(W, H);
    for (let i = 0; i < buffer.data.length; i++) buffer.data[i] = i + 100;
    const rect = { x: 2, y: 1, width: 3, height: 2 };
    const data = extractRect(buffer, rect);
    expect([...data]).toEqual([
      at(2, 1) + 100, at(3, 1) + 100, at(4, 1) + 100,
      at(2, 2) + 100, at(3, 2) + 100, at(4, 2) + 100,
    ]);
    const other = createBuffer(W, H);
    writeRect(other, rect, data);
    expect(other.data[at(2, 1)]).toBe(at(2, 1) + 100);
    expect(other.data[at(4, 2)]).toBe(at(4, 2) + 100);
    expect(other.data[at(1, 1)]).toBe(0);
    expect(other.data[at(5, 2)]).toBe(0);
    const copy = createBuffer(W, H);
    copyRect(buffer, copy, rect);
    expect(extractRect(copy, rect)).toEqual(data);
    expect(copy.data[at(0, 0)]).toBe(0);
  });

  it("translateBuffer clips and clears the destination", () => {
    const src = createBuffer(W, H);
    src.data[at(0, 0)] = RED; // shifts off-canvas
    src.data[at(2, 0)] = BLUE; // -> (0,1)
    src.data[at(7, 4)] = RED; // -> (5,5)
    src.data[at(7, 5)] = RED; // -> off bottom
    const dst = createBuffer(W, H);
    dst.data.fill(BLUE);
    translateBuffer(src, dst, -2, 1);
    expect(dst.data[at(0, 1)]).toBe(BLUE);
    expect(dst.data[at(5, 5)]).toBe(RED);
    expect([...dst.data].filter((v) => v !== 0)).toHaveLength(2);
  });

  it("resizeBuffer keeps the top-left crop and empties new cells", () => {
    const src = createBuffer(W, H);
    src.data[at(0, 0)] = RED;
    src.data[at(4, 4)] = BLUE;
    src.data[at(7, 5)] = RED;
    const a = resizeBuffer(src, 5, 7);
    expect(a).toMatchObject({ width: 5, height: 7 });
    expect(a.data[0]).toBe(RED);
    expect(a.data[4 * 5 + 4]).toBe(BLUE);
    expect([...a.data].filter((v) => v !== 0)).toHaveLength(2);
    const b = resizeBuffer(src, 10, 3);
    expect(b).toMatchObject({ width: 10, height: 3 });
    expect(b.data[0]).toBe(RED);
    expect([...b.data].filter((v) => v !== 0)).toHaveLength(1);
  });

  it("nonEmptyBounds counts transparent paint as content", () => {
    const buffer = createBuffer(W, H);
    expect(nonEmptyBounds(buffer)).toBeNull();
    buffer.data[at(3, 2)] = TRANSPARENT_PIXEL;
    expect(nonEmptyBounds(buffer)).toEqual({ x: 3, y: 2, width: 1, height: 1 });
    buffer.data[at(6, 4)] = RED;
    expect(nonEmptyBounds(buffer)).toEqual({ x: 3, y: 2, width: 4, height: 3 });
  });

  it("composeInto takes the topmost visible painted pixel inside the rect only", () => {
    const bottom = createBuffer(W, H);
    bottom.data[0] = RED;
    bottom.data[1] = RED;
    const top = createBuffer(W, H);
    top.data[0] = BLUE;
    top.data[1] = TRANSPARENT_PIXEL;
    const layers = [
      { visible: true, pixels: bottom },
      { visible: false, pixels: top },
    ];
    const composite = createBuffer(W, H);
    composite.data.fill(0xdeadbeef);
    composeInto(composite, layers, { x: 0, y: 0, width: 1, height: 1 });
    expect(composite.data[0]).toBe(RED);
    expect(composite.data[1]).toBe(0xdeadbeef);

    layers[1].visible = true;
    composeInto(composite, layers, null);
    expect(composite.data[0]).toBe(BLUE);
    expect(composite.data[1]).toBe(RED); // transparent top does not cover
    expect(composite.data[2]).toBe(EMPTY_PIXEL);
  });
});

describe("copyShiftedRect", () => {
  /** A buffer whose every cell holds a distinct non-empty value. */
  const numbered = () => {
    const buffer = createBuffer(W, H);
    for (let i = 0; i < buffer.data.length; i++) buffer.data[i] = i + 1;
    return buffer;
  };
  const SENTINEL = 0xdeadbeef;

  /** Runs copyShiftedRect into a sentinel-filled buffer and checks every cell against translateBuffer. */
  const expectMatchesTranslate = (rect: { x: number; y: number; width: number; height: number }, dx: number, dy: number) => {
    const src = numbered();
    const dst = createBuffer(W, H);
    dst.data.fill(SENTINEL);
    copyShiftedRect(src, dst, rect, dx, dy);
    const reference = createBuffer(W, H);
    translateBuffer(src, reference, dx, dy);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const inside = x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
        expect(dst.data[at(x, y)], `cell (${x}, ${y})`).toBe(inside ? reference.data[at(x, y)] : SENTINEL);
      }
    }
  };

  it("writes the source cell shifted by a positive delta and leaves cells outside the rect alone", () => {
    expectMatchesTranslate({ x: 2, y: 1, width: 4, height: 3 }, 2, 1);
    const dst = createBuffer(W, H);
    copyShiftedRect(numbered(), dst, { x: 3, y: 2, width: 1, height: 1 }, 2, 1);
    expect(dst.data[at(3, 2)]).toBe(at(1, 1) + 1);
  });

  it("handles negative and mixed shifts", () => {
    expectMatchesTranslate({ x: 1, y: 1, width: 5, height: 4 }, -2, -1);
    expectMatchesTranslate({ x: 0, y: 0, width: W, height: H }, 3, -2);
    expectMatchesTranslate({ x: 0, y: 0, width: W, height: H }, -3, 2);
  });

  it("fills cells whose source is off the grid with EMPTY_PIXEL at all four edges", () => {
    expectMatchesTranslate({ x: 0, y: 0, width: 3, height: H }, 2, 0); // left edge
    expectMatchesTranslate({ x: W - 3, y: 0, width: 3, height: H }, -2, 0); // right edge
    expectMatchesTranslate({ x: 0, y: 0, width: W, height: 2 }, 0, 1); // top edge
    expectMatchesTranslate({ x: 0, y: H - 2, width: W, height: 2 }, 0, -1); // bottom edge
  });

  it("empties the whole rect when the shift is larger than the grid", () => {
    expectMatchesTranslate({ x: 0, y: 0, width: W, height: H }, W + 5, 0);
    expectMatchesTranslate({ x: 0, y: 0, width: W, height: H }, 0, -(H + 1));
    const dst = numbered();
    copyShiftedRect(numbered(), dst, { x: 0, y: 0, width: W, height: H }, -100, 100);
    expect(isBufferEmpty(dst)).toBe(true);
  });

  it("copies straight across with no shift", () => {
    expectMatchesTranslate({ x: 2, y: 2, width: 3, height: 2 }, 0, 0);
  });
});
