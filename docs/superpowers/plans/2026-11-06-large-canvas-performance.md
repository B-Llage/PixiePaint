# Large-Canvas Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Pixie Paint's editor and every tool responsive at canvas sizes up to 2048×2048 by storing pixels in typed arrays, rendering the composite as one scaled bitmap, keeping per-input work bounded by the touched area, and recording undo as tile patches.

**Architecture:** A pure `PixelBuffer` module (`Uint32Array` RGBA, dirty rectangles) replaces `PixelValue[]` layers. `PixelPencil` routes every pixel edit through one `editLayer(layerId, rect, mutate)` entry point that captures history tiles, mutates in place, recomposes the dirty rectangle, and bumps a version counter. `PixelGrid` blits the composite `ImageData` with one `drawImage` and draws previews from masks in an overlay pass; hover state lives in refs and triggers redraws directly. History stores before/after tile patches instead of layer clones.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Vitest 3 with jsdom and React Testing Library, Node 22 (`.nvmrc`).

**Spec:** `docs/superpowers/specs/2026-11-06-large-canvas-performance-design.md`

## Global Constraints

- Run every check with Node 22: `nvm use` (reads `.nvmrc`) before `npm run check`. Node 18 breaks Vitest's config loading with `ERR_REQUIRE_ESM`.
- `npm run check` (lint, `tsc --noEmit`, full Vitest suite) must pass at the end of every task before its commit.
- Grid dimension range: `MIN_GRID_DIMENSION = 1`, `MAX_GRID_DIMENSION = 2048`, default `32`.
- History: `MAX_HISTORY = 15` entries, `HISTORY_BYTE_BUDGET = 256 * 1024 * 1024` bytes, `HISTORY_TILE_SIZE = 64` cells.
- Export: `MAX_EXPORT_DIMENSION = 16384` output pixels on either axis.
- Pixel grid lines draw only when `displayCellSize >= 4`.
- Pixel encoding: `EMPTY_PIXEL = 0`, `TRANSPARENT_PIXEL = 0x00000001` (alpha 0, so it is invisible when uploaded as ImageData), painted colors have alpha `0xff` and are packed in the platform's ImageData byte order (R, G, B, A bytes).
- No whole-layer scan in any per-frame or per-input path (pointer move, stroke step, fill, move step, undo, redo). Whole-layer work is allowed only in one-shot operations: resize, reset, layer delete, export, thumbnails after an action ends.
- Commit messages have no Co-Authored-By or Generated-with lines.
- Keep hex colors in `PixelValue` strings lowercase at the pixel-model boundary: `unpackColor` returns lowercase, `packColor` accepts any case.

## Review Focus

1. **Zoomed far out at 2048² on a phone (display cell size below 1 CSS pixel):** the composite blit must still draw the whole visible region without seams or a blank canvas; the draw path must not divide by a zero-sized cell. Pinned by the `PixelGrid` test "draws the composite with one drawImage at fractional cell sizes" in Task 7.
2. **Undo after the oldest entries were evicted by the byte budget:** `canUndo` must reflect the remaining entries, and undoing to the bottom must leave the layer in the oldest retained `before` state, not a blank layer. Pinned by "evicts the oldest entries past the byte budget and keeps the rest undoable" in Task 5.
3. **Bucket fill on a cell painted with the explicit transparent value next to empty cells:** the fill must treat transparent and empty as different regions, as today. Pinned by "fills transparent paint separately from empty cells" in Task 2.
4. **Resizing the grid while a stroke or move drag is in progress:** the in-progress action must be dropped (history cleared, buffers resized) without writing out-of-range indices into the new buffer. Pinned by "a grid resize during an open action clears the action without writing stale cells" in Task 11.
5. **Picking a color from the composite whose palette entry is uppercase hex or a custom HSL color:** the picked color must still highlight the matching palette swatch. Pinned by "picking a color highlights its palette swatch" in Task 6 (the picker test) with a palette color in uppercase.

---

### Task 1: PixelBuffer module

**Files:**
- Create: `app/components/PixelPencil/pixel-buffer.ts`
- Test: `app/components/PixelPencil/pixel-buffer.test.ts`
- Modify: `app/components/PixelPencil/PixelPencil.constants.ts` (add `MIN_GRID_DIMENSION`, `MAX_GRID_DIMENSION`, `DEFAULT_GRID_DIMENSION`, `HISTORY_TILE_SIZE`, `HISTORY_BYTE_BUDGET`, `MAX_EXPORT_DIMENSION`)

**Interfaces:**
- Produces (all exported from `pixel-buffer.ts`):
  - `type PixelBuffer = { width: number; height: number; data: Uint32Array }`
  - `type DirtyRect = { x: number; y: number; width: number; height: number }`
  - `const EMPTY_PIXEL = 0`, `const TRANSPARENT_PIXEL = 0x00000001`
  - `packColor(hex: string): number` and `unpackColor(value: number): PixelValue` (`0` → `null`, `TRANSPARENT_PIXEL` → `"transparent"`, else `#rrggbb` lowercase)
  - `toPackedValue(value: PixelValue): number` (`null` → 0, `"transparent"` → `TRANSPARENT_PIXEL`, hex → `packColor`)
  - `isPaintedPixel(value: number): boolean` (not empty and not transparent)
  - `createBuffer(width: number, height: number): PixelBuffer`
  - `cloneBuffer(buffer: PixelBuffer): PixelBuffer`
  - `isBufferEmpty(buffer: PixelBuffer): boolean`
  - `rectFromIndices(buffer: PixelBuffer, indices: ArrayLike<number>): DirtyRect | null`
  - `unionRect(a: DirtyRect | null, b: DirtyRect | null): DirtyRect | null`
  - `intersectRect(rect: DirtyRect, bounds: DirtyRect): DirtyRect | null`
  - `fillCells(buffer: PixelBuffer, indices: ArrayLike<number>, value: number): DirtyRect | null` (bounding rect of cells whose value changed)
  - `fillMask(buffer: PixelBuffer, mask: Uint8Array, bounds: DirtyRect, value: number): DirtyRect | null` (mask is canvas-sized, index-aligned; only cells inside `bounds` are read)
  - `extractRect(buffer: PixelBuffer, rect: DirtyRect): Uint32Array` (row-major, `rect.width * rect.height`)
  - `writeRect(buffer: PixelBuffer, rect: DirtyRect, data: Uint32Array): void`
  - `copyRect(src: PixelBuffer, dst: PixelBuffer, rect: DirtyRect): void` (same-size buffers)
  - `translateBuffer(src: PixelBuffer, dst: PixelBuffer, dx: number, dy: number): void` (clears `dst` then copies shifted rows with `TypedArray.set`, clipping)
  - `nonEmptyBounds(buffer: PixelBuffer): DirtyRect | null`
  - `resizeBuffer(src: PixelBuffer, width: number, height: number): PixelBuffer` (top-left anchored)
  - `composeInto(composite: PixelBuffer, layers: ReadonlyArray<{ visible: boolean; pixels: PixelBuffer }>, rect: DirtyRect | null): void` (topmost visible painted pixel wins; `null` rect means everything)

- [ ] **Step 1: Write the failing tests**

In `pixel-buffer.test.ts`, with `width = 8, height = 6`:

```ts
it("packs and unpacks colors through ImageData byte order", () => {
  const packed = packColor("#FF8000");
  const bytes = new Uint8Array(new Uint32Array([packed]).buffer);
  expect([...bytes]).toEqual([255, 128, 0, 255]);
  expect(unpackColor(packed)).toBe("#ff8000");
  expect(unpackColor(packColor("#abc"))).toBe("#aabbcc");
  expect(toPackedValue(null)).toBe(EMPTY_PIXEL);
  expect(toPackedValue("transparent")).toBe(TRANSPARENT_PIXEL);
  expect(unpackColor(TRANSPARENT_PIXEL)).toBe("transparent");
  expect(isPaintedPixel(TRANSPARENT_PIXEL)).toBe(false);
});
it("fillCells returns the bounding rect of changed cells and null when nothing changes", () => {
  const buffer = createBuffer(8, 6);
  expect(fillCells(buffer, [9, 10, 17], packColor("#ff0000"))).toEqual({ x: 1, y: 1, width: 2, height: 2 });
  expect(fillCells(buffer, [9], packColor("#ff0000"))).toBeNull();
});
it("fillMask only writes cells set in the mask inside bounds", ...)   // mask bit outside bounds must be ignored
it("extractRect and writeRect round trip a rectangle", ...)
it("translateBuffer clips and clears the destination", ...)           // dx = -2, dy = 1: cells shifted, vacated cells 0
it("resizeBuffer keeps the top-left crop and empties new cells", ...) // 8x6 -> 5x7 and 8x6 -> 10x3
it("nonEmptyBounds counts transparent paint as content", ...)        // a lone TRANSPARENT_PIXEL at (3,2) gives {x:3,y:2,width:1,height:1}
it("composeInto takes the topmost visible painted pixel inside the rect only", () => {
  // bottom layer red at index 0 and 1; top layer hidden blue at 0, visible transparent at 1
  // composeInto with rect {x:0,y:0,width:1,height:1} updates index 0 only; index 1 stays whatever it was
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/components/PixelPencil/pixel-buffer.test.ts`
Expected: FAIL with "Cannot find module './pixel-buffer'".

- [ ] **Step 3: Implement `pixel-buffer.ts` and the constants**

Packing: write R, G, B, A bytes into a module-level `Uint8ClampedArray(4)` that shares its buffer with a `Uint32Array(1)` and read the 32-bit value, so the encoding matches `ImageData` on any endianness. Cache `packColor` results in a `Map<string, number>` keyed by the lowercase hex and `unpackColor` results in a `Map<number, string>`. `composeInto` loops rows of `rect`, and for each cell walks layers from top to bottom, skipping invisible layers and values that are not painted.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/components/PixelPencil/pixel-buffer.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the gate and commit**

Run: `npm run check`
Expected: all green.

```bash
git add app/components/PixelPencil/pixel-buffer.ts app/components/PixelPencil/pixel-buffer.test.ts app/components/PixelPencil/PixelPencil.constants.ts
git commit -m "Add the typed-array PixelBuffer module"
```

---

### Task 2: Grid geometry on buffers: masks, footprint bounds, scanline fill

**Files:**
- Modify: `app/components/PixelPencil/grid-geometry.ts`
- Test: `app/components/PixelPencil/grid-geometry.test.ts`

**Interfaces:**
- Consumes: `PixelBuffer`, `DirtyRect`, `TRANSPARENT_PIXEL` from Task 1.
- Produces:
  - `type PreviewMask = { mask: Uint8Array; bounds: DirtyRect }` (mask is canvas-sized, index-aligned, `1` = cell set)
  - `createMask(grid: GridSize): Uint8Array`
  - `stampCells(mask: Uint8Array, grid: GridSize, indices: ArrayLike<number>, bounds: DirtyRect | null): DirtyRect | null` (sets the cells, returns the union of `bounds` and the cells' rect)
  - `clearMaskRect(mask: Uint8Array, grid: GridSize, rect: DirtyRect): void`
  - `brushBounds(grid: GridSize, centerIndex: number, brushSize: number): DirtyRect` (the clipped square around the center, used as the edit rect before computing the footprint)
  - `collectFillMask(buffer: PixelBuffer, startIndex: number): PreviewMask | null` (four-connected scanline fill over cells equal to the start cell's packed value; `null` when the start index is out of range)
- Keep: `computeBrushIndices`, `computeLineIndices`, `computeShapeCells`, `traceWorldSegment`, `coordsToIndex`, `indexToCoords`, `isInBounds`. Remove `collectFillRegion` (its only callers move to `collectFillMask` in Tasks 6 and 9).

- [ ] **Step 1: Write the failing tests**

Append to `grid-geometry.test.ts`:

```ts
it("collectFillMask matches a four-connected region and reports its bounds", () => {
  // 5x5 buffer, a diagonal wall of red from (0,4) to (4,0); start at (0,0) fills the upper-left triangle
  // expect mask set exactly on the 10 cells above the wall, bounds {x:0,y:0,width:4,height:4}
});
it("fills transparent paint separately from empty cells", () => {
  // cells 0..2 TRANSPARENT_PIXEL, 3..4 empty in a 5x1 buffer; start at 0 -> mask covers 0..2 only
});
it("collectFillMask returns null for an out-of-range start", ...)
it("stampCells grows the bounds and clearMaskRect clears them", ...)
it("brushBounds clips the brush square to the grid", () => {
  expect(brushBounds({ width: 8, height: 8 }, 0, 4)).toEqual({ x: 0, y: 0, width: 3, height: 3 });
});
```

Also port the existing `collectFillRegion` tests to `collectFillMask` (same regions expressed as the set of indices where `mask[i] === 1`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/components/PixelPencil/grid-geometry.test.ts`
Expected: FAIL on the new exports.

- [ ] **Step 3: Implement**

Scanline fill: an explicit stack of `{ y, xLeft, xRight, dy }` spans, reading `buffer.data` directly and marking `mask` as visited, so no per-cell object allocation. Track min/max x and y while marking to build `bounds`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/components/PixelPencil/grid-geometry.test.ts`
Expected: PASS. (`npm run typecheck` will fail until Task 6 removes the `collectFillRegion` import from `PixelPencil.tsx`; keep the old function exported until then and delete it in Task 6.)

- [ ] **Step 5: Commit**

```bash
git add app/components/PixelPencil/grid-geometry.ts app/components/PixelPencil/grid-geometry.test.ts
git commit -m "Add preview masks and a scanline fill to grid geometry"
```

---

### Task 3: Selection pixels as a rectangle buffer

**Files:**
- Modify: `app/components/PixelPencil/PixelPencilTypes.ts`
- Modify: `app/components/PixelPencil/pixel-operations.ts`
- Test: `app/components/PixelPencil/pixel-operations.test.ts`

**Interfaces:**
- Produces:
  - `interface Layer { id: string; name: string; visible: boolean; pixels: PixelBuffer }`
  - `interface SelectionState { rect: SelectionRect; offset: { dx: number; dy: number }; data: Uint32Array; isFloating: boolean }` (`data` is `rect.width * rect.height`, row-major, packed values). `SelectionPixel` is removed.
  - In `pixel-operations.ts`: keep `cloneSelection`, `areSelectionsEqual` (compares `data` byte-wise), `generateLayerName`; add `hasSelectionPixels(selection: SelectionState | null): boolean` (any non-empty value). Remove `translatePixels`, `composeLayers`, `arePixelsEqual`, `cloneLayer`, `cloneLayers`, `areLayersEqual`, `resizePixels` (replaced by Task 1 functions).

- [ ] **Step 1: Update the tests**

Rewrite `pixel-operations.test.ts` for the kept functions: `cloneSelection` deep-copies `data` (mutating the clone does not change the source), `areSelectionsEqual` detects a one-cell difference in `data`, `hasSelectionPixels` is false for all-empty data and true when one cell is `TRANSPARENT_PIXEL`. Delete tests of removed functions.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/components/PixelPencil/pixel-operations.test.ts`
Expected: FAIL (`hasSelectionPixels` missing; `data` shape).

- [ ] **Step 3: Implement the type and function changes**

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/components/PixelPencil/pixel-operations.test.ts`
Expected: PASS. Typecheck is expected to fail across the app until Task 6; do not run `npm run check` yet.

- [ ] **Step 5: Commit**

```bash
git add app/components/PixelPencil/PixelPencilTypes.ts app/components/PixelPencil/pixel-operations.ts app/components/PixelPencil/pixel-operations.test.ts
git commit -m "Store layer and selection pixels in typed buffers"
```

---

### Task 4: Composite hook and redraw signal

**Files:**
- Create: `app/components/PixelPencil/hooks/useComposite.ts`
- Create: `app/components/PixelPencil/hooks/useRedrawSignal.ts`
- Test: `app/components/PixelPencil/hooks/useComposite.test.tsx`, `app/components/PixelPencil/hooks/useRedrawSignal.test.tsx`

**Interfaces:**
- Consumes: `composeInto`, `createBuffer`, `Layer`.
- Produces:
  - `useComposite({ layersRef: RefObject<Layer[]>, width: number, height: number }): { compositeRef: RefObject<PixelBuffer>; compositeVersion: number; dirtyRef: RefObject<DirtyRect | null>; recompose(rect: DirtyRect | null): void }` — `recompose` runs `composeInto` for the rect, sets `dirtyRef.current` to the union of itself and the rect (a `null` rect makes it the full grid rect), and bumps `compositeVersion` (React state). The renderer clears `dirtyRef` after uploading. The composite buffer is recreated when `width`/`height` change and fully recomposed.
  - `useRedrawSignal(): { requestRedraw(): void; subscribe(listener: () => void): () => void }` — `requestRedraw` coalesces calls into one `requestAnimationFrame` and notifies listeners once; `subscribe` returns an unsubscribe function. Both are stable identities.

- [ ] **Step 1: Write the failing tests**

```ts
// useComposite.test.tsx
it("recomposes only the given rect", () => { /* paint bottom layer red everywhere via data.fill, recompose {x:0,y:0,width:1,height:1}; composite index 0 red, index 1 still 0 */ });
it("recomposes everything on null and when the size changes", ...)
it("bumps compositeVersion on each recompose", ...)
it("accumulates the dirty rect until it is cleared", () => { /* recompose two rects -> dirtyRef is their union; set dirtyRef.current = null; recompose null -> full grid rect */ });
// useRedrawSignal.test.tsx (stub requestAnimationFrame like useStrokePipeline.test.tsx does)
it("coalesces several requests into one frame and one notification", ...)
it("stops notifying after unsubscribe", ...)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/components/PixelPencil/hooks/useComposite.test.tsx app/components/PixelPencil/hooks/useRedrawSignal.test.tsx`
Expected: FAIL, modules missing.

- [ ] **Step 3: Implement both hooks**

- [ ] **Step 4: Run tests to verify they pass**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/components/PixelPencil/hooks/useComposite.ts app/components/PixelPencil/hooks/useComposite.test.tsx app/components/PixelPencil/hooks/useRedrawSignal.ts app/components/PixelPencil/hooks/useRedrawSignal.test.tsx
git commit -m "Add the composite buffer hook and a coalesced redraw signal"
```

---

### Task 5: History as tile patches

**Files:**
- Modify: `app/components/PixelPencil/hooks/useEditorHistory.ts`
- Test: `app/components/PixelPencil/hooks/useEditorHistory.test.tsx`

**Interfaces:**
- Consumes: `extractRect`, `writeRect`, `intersectRect`, `HISTORY_TILE_SIZE`, `HISTORY_BYTE_BUDGET`, `MAX_HISTORY`, `cloneSelection`, `areSelectionsEqual`.
- Produces:
  - `type LayerMeta = { id: string; name: string; visible: boolean }`
  - `type EditorMeta = { layers: LayerMeta[]; activeLayerId: string; selection: SelectionState | null }`
  - `type TilePatch = { rect: DirtyRect; before: Uint32Array; after: Uint32Array }`
  - `type PixelEntry = { kind: "pixels"; layerId: string; tiles: Map<number, TilePatch>; before: EditorMeta; after: EditorMeta }`
  - `type StructureEntry = { kind: "structure"; before: EditorMeta; after: EditorMeta; buffersBefore: Map<string, PixelBuffer>; buffersAfter: Map<string, PixelBuffer> }` (buffers only for layers whose pixels the operation replaced: delete, reset)
  - `type HistoryEntry = PixelEntry | StructureEntry`
  - `type HistoryStacks = { undo: HistoryEntry[]; redo: HistoryEntry[] }`
  - `useEditorHistory({ captureMeta: () => EditorMeta; applyMeta: (meta: EditorMeta, buffers: Map<string, PixelBuffer>) => void; getLayerBuffer: (layerId: string) => PixelBuffer | null; onPixelsRestored: (layerId: string, rect: DirtyRect) => void; maxHistory?: number; byteBudget?: number })`
  - Returns `EditorHistory`:
    - `canUndo`, `canRedo`
    - `beginAction(): void` (captures `before` meta; no-op while one is in progress)
    - `capturePixelsBefore(layerId: string, rect: DirtyRect): void` (for each tile intersecting `rect` not yet captured in this action, stores `before = extractRect(layer, tileRect)`; starts an action implicitly if none is open)
    - `markModified(): void`
    - `finalizeAction(): void` (captures `after` for each tile and the `after` meta; drops tiles whose bytes are equal; drops the entry when no tiles remain and the meta is equal; pushes, clears redo, enforces the entry cap and the byte budget by dropping from the bottom of the undo stack)
    - `recordStructureChange(apply: () => Map<string, PixelBuffer> | void): void` (captures `before` meta, runs `apply`, which returns the buffers it replaced keyed by layer id if any, captures `after`; clones the current buffers of those ids as `buffersAfter`; pushes the entry)
    - `isActionInProgress(): boolean`
    - `saveStacks(): HistoryStacks`, `restoreStacks(stacks: HistoryStacks): void`, `clear(): void`, `undo(): void`, `redo(): void`
  - Undo of a pixel entry writes each tile's `before` with `writeRect`, calls `onPixelsRestored(layerId, tileRect)` per tile, then `applyMeta(entry.before, new Map())`. Redo writes `after`. Undo of a structure entry calls `applyMeta(entry.before, entry.buffersBefore)`; redo uses `after` and `buffersAfter`.
  - Tile index for cell `(x, y)` is `Math.floor(y / HISTORY_TILE_SIZE) * tilesPerRow + Math.floor(x / HISTORY_TILE_SIZE)`; a tile's rect is clipped to the buffer. Export `tileRect(tileIndex, width, height): DirtyRect` for tests.

- [ ] **Step 1: Rewrite the tests**

Keep the test file's harness style (a mutable editor state driven through the hook). State holds `layers: Layer[]` with `PixelBuffer`s. Tests:

```ts
it("records a stroke as tile patches and undoes and redoes it", ...)            // paint index 5 then 70 on a 16x16 layer across two tiles with HISTORY_TILE_SIZE 8 (pass tileSize? no: use a 128x128 layer so cells fall in different 64-tiles)
it("drops an action that changed nothing", ...)
it("captures before bytes once per tile even when edits overlap", ...)         // second edit of the same tile must not overwrite before
it("records structure changes with replaced buffers and restores them on undo", ...)  // delete a layer
it("evicts the oldest entries past the byte budget and keeps the rest undoable", () => {
  // byteBudget = 3 tiles' worth of bytes (64*64*4*2 per tile for before+after); record 4 single-tile actions;
  // expect undo stack length 3; undo three times restores the state after action 1; canUndo false afterwards
});
it("caps entries at maxHistory", ...)
it("clears the redo stack when a new action is recorded", ...)
it("ignores undo while an action is in progress", ...)
it("saveStacks and restoreStacks round trip", ...)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/components/PixelPencil/hooks/useEditorHistory.test.tsx`
Expected: FAIL on the new API.

- [ ] **Step 3: Implement the hook**

Byte accounting: a pixel entry's size is the sum over tiles of `before.byteLength + after.byteLength`; a structure entry's is the sum of its buffers' `data.byteLength`. Keep a running total for the undo stack; after each push, shift from the bottom while `total > byteBudget && undo.length > 1`.

- [ ] **Step 4: Run tests to verify they pass**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/components/PixelPencil/hooks/useEditorHistory.ts app/components/PixelPencil/hooks/useEditorHistory.test.tsx
git commit -m "Record editor history as tile patches with a byte budget"
```

---

### Task 6: Wire PixelPencil to buffers: edits, composite, history, picker, bucket, reset, resize

This is the integration task that makes the app compile again. It touches the hooks that take `activeLayerPixelsRef`/`setActiveLayerPixels` and swaps their inputs for `editLayer`. The renderer still receives the old `pixels` prop in this task through a temporary adapter so the UI keeps working; Task 7 replaces it.

**Files:**
- Modify: `app/components/PixelPencil/PixelPencil.tsx`
- Modify: `app/components/PixelPencil/hooks/useStrokePipeline.ts`, `useSelection.ts`, `useMoveDrag.ts`, `useLayerOperations.ts`, `useLayerPreviews.ts`, `usePixelExport.ts`
- Modify tests: `PixelPencil.test.tsx`, `useStrokePipeline.test.tsx`, `useSelection.test.tsx`, `useMoveDrag.test.tsx`, `useLayerOperations.test.tsx`, `useLayerPreviews.test.tsx`, `usePixelExport.test.tsx`
- Delete the `collectFillRegion` export from `grid-geometry.ts`.

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces (in `PixelPencil.tsx`, passed to hooks):
  - `type LayerEdit = (buffer: PixelBuffer) => DirtyRect | null`
  - `editLayer(layerId: string, rect: DirtyRect, mutate: LayerEdit): DirtyRect | null` — calls `history.capturePixelsBefore(layerId, rect)`, runs `mutate`, and when it returns a rect: `recompose(rect)`, `history.markModified()`, bumps `layerVersion` state, and bumps `previewVersion` state only when `!history.isActionInProgress()`. Returns the changed rect.
  - `getActiveLayer(): Layer | null`
  - `previewVersion: number` state, also bumped in the `finalizeAction` wrapper and after every structure change.
- Hook option changes:
  - `useStrokePipeline`: replace `activeLayerPixelsRef`/`setActiveLayerPixels` with `activeLayerId: string` and `editLayer`. `applyBrush(index, value: PixelValue)` edits with `rect = brushBounds(...)` and `fillCells(buffer, computeBrushIndices(index), toPackedValue(value))`. `applyLinePath(path, value)` stamps footprints into a scratch mask then `fillMask`. `commitStrokeBuffer(value)` keeps `strokeAppliedCellsRef` and builds a mask from it at commit. `pathPreview` stays `Set<number>` React state in this task; Task 8 turns it into a mask after Task 7 changes the renderer.
  - `useSelectionState`: replace `activeLayerPixelsRef`/`setActiveLayerPixels` with `getActiveLayer`, `activeLayerId`, `editLayer`. `captureSelectionPixels(rect, source?: PixelBuffer): Uint32Array` = `extractRect`. `applySelectionToLayer(target, offset, mode)` writes clipped cells through `editLayer` with `rect` = the shifted selection rect intersected with the grid; `"clear"` writes `EMPTY_PIXEL` where `data` is non-empty, `"apply"` writes non-empty values.
  - `useMoveDrag`: replace `totalCells`, `setLayers`, `setActiveLayerPixelsState`, `beginActionWithSnapshot` with `editLayer`, `beginAction`, `getLayerBuffer(layerId)`. `MoveDrag` keeps `sourcePixels: PixelBuffer` (clone of the layer, taken once at pointer-down: one whole-layer copy per drag is allowed), `movePixels: PixelBuffer`, `scratch: PixelBuffer`, `sourceBounds: DirtyRect | null` (= `nonEmptyBounds(movePixels)`), `lastBounds: DirtyRect | null`. Each step: `translateBuffer(movePixels, scratch, dx, dy)`; `rect = unionRect(unionRect(sourceBounds, lastBounds), shiftedSourceBounds)`; `editLayer(layerId, rect, buffer => { copyRect(scratch, buffer, rect); return rect; })`; `lastBounds = shiftedSourceBounds`. Cancel writes `sourcePixels` back over `unionRect(sourceBounds, lastBounds)` and restores stacks.
  - `useLayerOperations`: replace `recordSnapshot`/`commitSnapshot` with `recordStructureChange`; `deleteLayer` returns the removed layer's buffer from `apply`; `createLayer` uses `createBuffer(gridWidth, gridHeight)` (options gain `gridWidth`, `gridHeight`, drop `totalCells`).
  - `useLayerPreviews(layers, gridWidth, gridHeight, previewVersion)`: unchanged output type; this task only changes the input shape and keeps the per-cell loop reading `unpackColor` (Task 12 replaces the rasterization).
  - `usePixelExport({ gridWidth, gridHeight, compositeRef, compositeVersion })`: this task keeps the per-cell `fillRect` loop reading the composite buffer (Task 12 replaces it).
- `PixelPencil` state removed: `activeLayerPixels`, `compositePixels`, `layerDimensions` logic now resizes `PixelBuffer`s with `resizeBuffer`, `captureSnapshot`/`applySnapshot` replaced by `captureMeta`/`applyMeta`/`getLayerBuffer`/`onPixelsRestored(layerId, rect) => recompose(rect)`.
- `applyMeta(meta, buffers)`: rebuilds `layers` in `meta.layers` order from the current layers by id (keeping each existing buffer), substituting `buffers.get(id)` where present and `createBuffer` for ids that no longer exist; sets `activeLayerId`; `restoreSelection(meta.selection)`; `recompose(null)`; bumps `layerVersion` and `previewVersion`.
- `floodFill(startIndex, value)`: `collectFillMask(layer, startIndex)` then `editLayer(id, bounds, b => fillMask(b, mask, bounds, packed))`.
- `pickColorAtIndex`: `unpackColor(compositeRef.current.data[index])`, `null` → `"transparent"`.
- `reset`: `recordStructureChange(() => { clone each layer's buffer into the returned map; data.fill(0) on each; recompose(null) })`.
- Temporary adapter for `PixelGrid` in this task: a `useMemo` on `compositeVersion` that builds `PixelValue[]` from the composite with `unpackColor`. Delete it in Task 7.

- [ ] **Step 1: Update the hook tests**

Each hook test gets a harness with a `PixelBuffer` layer and an `editLayer` that runs the mutate and records the rect. Replace pixel expectations with `unpackColor(buffer.data[index])`. Add:

```ts
// useMoveDrag.test.tsx
it("moves pixels by writing only the union of before and after bounds", () => { /* editLayer rect recorded equals union of the sprite's old and new bounds */ });
// useSelection.test.tsx
it("captures and applies selection data with clipping at the grid edge", ...)
// useLayerOperations.test.tsx
it("deleting a layer hands its buffer to history", ...)
```

- [ ] **Step 2: Update `PixelPencil.test.tsx`**

The `GridHarness` mock still receives `pixels: PixelValue[]` in this task, so the existing readers (`first-two-pixels`, `painted-cells`) keep working. Add:

```ts
it("picking a color highlights its palette swatch", async () => {
  // click the "#1f2937" swatch, paint the origin, select the picker, click the origin;
  // expect that swatch to carry the selected state and no other swatch to
});
```

(Uppercase input is pinned in Task 1's pack test; the composite always holds packed values, so the picker returns lowercase hex regardless of how the color was entered.)

- [ ] **Step 3: Run the suite to see the failures**

Run: `npx vitest run`
Expected: hook tests FAIL on new option shapes; `PixelPencil.test.tsx` fails to compile.

- [ ] **Step 4: Implement the wiring described in Interfaces**

- [ ] **Step 5: Run the gate**

Run: `npm run check`
Expected: all green. If `PixelPencil.test.tsx` cases fail, fix the wiring, not the test, unless the expectation encodes the removed snapshot behavior (then update the expectation and say so in the commit).

- [ ] **Step 6: Commit**

```bash
git add -A app/components/PixelPencil
git commit -m "Route editor pixel edits through PixelBuffer and tile history"
```

---

### Task 7: Renderer blit path and overlay masks

**Files:**
- Modify: `app/components/PixelPencil/PixelGrid.tsx`
- Create: `app/components/PixelPencil/grid-renderer.ts` (pure drawing helpers over a `CanvasRenderingContext2D`)
- Test: `app/components/PixelPencil/grid-renderer.test.ts`, `app/components/PixelPencil/PixelGrid.test.tsx`
- Modify: `app/components/PixelPencil/PixelPencil.tsx` (remove the Task 6 adapter and the preview memos; pass the new props)
- Modify: `app/components/PixelPencil/PixelPencil.test.tsx` (`GridHarness` reads from `composite`)

**Interfaces:**
- Produces in `grid-renderer.ts`:
  - `type OverlayFrame = { path: PreviewMask | null; brush: PreviewMask | null; bucket: PreviewMask | null; brushSizeShadow: PreviewMask | null; pathColor: PixelValue; hoverColor: PixelValue | null; dim: boolean }`
  - `type ViewTransform = { displayCellSize: number; originX: number; originY: number; scaleX: number; scaleY: number }` (origin = `renderOffset - scrollOrigin` in CSS px; scale = device pixels per CSS px)
  - `visibleCellRect(grid: GridSize, view: ViewTransform, viewportWidth: number, viewportHeight: number): DirtyRect | null`
  - `cellToDevice(view: ViewTransform, cellX: number, cellY: number): { x: number; y: number }` (rounded device pixels, same rounding for every edge so adjacent cells share edges)
  - `drawCheckerboard(ctx, grid, view, visible: DirtyRect, checkerSize: number)` — uses a cached `CanvasPattern` built with `ctx.createPattern` from a 2×2-checker offscreen canvas sized to `checkerSize * displayCellSize * scale`, falling back to per-checker `fillRect` when `createPattern` returns null (jsdom).
  - `drawComposite(ctx, surface: CompositeSurface, view, visible)` where `CompositeSurface = { canvas: HTMLCanvasElement; imageData: ImageData; dirty: DirtyRect | null }`; uploads `dirty` with `putImageData(imageData, 0, 0, dirty.x, dirty.y, dirty.width, dirty.height)`, clears `dirty`, then one `drawImage` of the visible source rect to its rounded device rect with `imageSmoothingEnabled = false`.
  - `createCompositeSurface(buffer: PixelBuffer): CompositeSurface` (the `ImageData`'s `data.buffer` is `buffer.data.buffer`, so no copy)
  - `drawOverlay(ctx, grid, view, visible, frame: OverlayFrame, checkerSize)` — builds one `ImageData` over the union of the masks' bounds intersected with `visible`, writes RGBA per cell (path cells: `pathColor`, or the checker color for `null`/`"transparent"`; brush and bucket cells: `hoverColor` likewise; `dim` sets alpha `178` for those; brush-size shadow cells: `rgba(24,24,27,0.55)` and, where a 4-neighbor is outside the shadow mask, the cell's outer edge is drawn afterwards with `fillRect` in `rgba(255,255,255,0.8)` one device pixel wide), uploads it to a reusable overlay canvas, and draws it scaled over the artwork.
  - `drawGridLines(ctx, grid, view, visible, viewportWidth, viewportHeight)` — only when `view.displayCellSize >= 4`.
  - `drawFloatingSelection(ctx, selection: SelectionState, view)` — `ImageData` from `selection.data` (transparent and empty → alpha 0), blitted at the offset rect; then each `TRANSPARENT_PIXEL` cell gets the checker tile via `fillRect` with `checkerboardStyle`'s colors.
- `PixelGridProps` changes: remove `pixels`, `bucketPreview`, `brushPreview`, `brushSizePreview`, `pathPreview`, `activeColor`, `drawValueRef`, `drawValueVersion`; add `composite: RefObject<PixelBuffer>`, `compositeVersion: number`, `compositeDirtyRef: RefObject<DirtyRect | null>` (from `useComposite`; the grid uploads that rect with `putImageData` and then sets it to `null`; a `null` rect with a changed `compositeVersion` or a new buffer identity uploads everything), `getOverlayFrame: () => OverlayFrame`, `redraw: { subscribe(listener: () => void): () => void }`.
- `PixelGrid` draws in a `draw()` function called from the effect (dependencies: geometry, settings, `compositeVersion`, `selectionOverlay`, `selectionPreviewRect`, `getOverlayFrame`) and from the `redraw` subscription.

- [ ] **Step 1: Write the failing renderer tests**

`grid-renderer.test.ts` with a hand-written context stub recording calls:

```ts
it("visibleCellRect clips to the grid and the viewport", ...)
it("cellToDevice gives adjacent cells a shared edge", () => { /* displayCellSize 2.5, scale 2: right edge of cell 0 === left edge of cell 1 */ });
it("drawComposite uploads only the dirty rect and draws once", () => { /* putImageData called with dirty args, drawImage called once with source rect = visible cells */ });
it("draws the composite with one drawImage at fractional cell sizes", () => { /* displayCellSize 0.4, 2048 grid, viewport 300x300: one drawImage, source rect covers 750 cells, no NaN */ });
it("drawOverlay writes the path color and checker color for erase previews", ...)
it("drawGridLines draws nothing below a 4px cell size", ...)
```

`PixelGrid.test.tsx`: update the harness to pass `composite`, `compositeVersion`, `compositeDirtyRef`, `getOverlayFrame`, `redraw`; keep pointer, pan, zoom, scrollbar, and cursor tests; replace per-cell `fillRect` expectations with: "a redraw request draws the overlay once per frame" and "the floating selection draws no per-pixel DOM nodes" (`container.querySelectorAll(".selection-floating-pixel").length === 0` while `selectionOverlay.isFloating`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/components/PixelPencil/grid-renderer.test.ts app/components/PixelPencil/PixelGrid.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `grid-renderer.ts`, rewrite the draw effect in `PixelGrid.tsx`, update `PixelPencil.tsx`**

In `PixelPencil.tsx`: hover moves to `hoverRef: RefObject<number | null>`; `setHoverIndexIfChanged(next)` writes the ref and calls `requestRedraw()`; `pathPreviewRef: RefObject<PreviewMask | null>` with `setPathPreview(next: PreviewMask | null)` doing the same (all hooks' `setPathPreview` option types change to `(next: PreviewMask | null) => void`); `getOverlayFrame` is a `useCallback` over `tool`, `brushSize`, `brushShape`, `previewToolEffects`, `dimStrokePreview`, `brushSizeDragging`, `activeColor`, `drawValueRef`, `layerVersion`, viewport geometry, that computes brush, bucket (cached by `(hoverIndex, layerVersion)` in a ref; skipped while `isDrawingRef.current`), and brush-size shadow masks from the refs. `handlePointerUp`'s `hoverIndex` fallback reads `hoverRef.current`. Delete the `hoverIndex` state, the three preview memos, and the Task 6 adapter.

`PixelPencil.test.tsx`'s `GridHarness` reads `props.composite.current` to emit `first-two-pixels` and `painted-cells` (via `unpackColor`), and emits `brush-preview` / `brush-size-preview` from `props.getOverlayFrame()` masks (indices where mask is 1) when the test calls a new "Read overlay" button. Add to `PixelPencil.test.tsx`:

```ts
it("moving the pointer does not re-render the layers panel", async () => {
  // vi.mock("./LayersPanel") with a counter; hover three different cells; expect the count unchanged after the first render
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run check`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add -A app/components/PixelPencil
git commit -m "Render the composite as one scaled bitmap with an overlay pass"
```

---

### Task 8: Stroke pipeline on masks

**Files:**
- Modify: `app/components/PixelPencil/hooks/useStrokePipeline.ts`
- Test: `app/components/PixelPencil/hooks/useStrokePipeline.test.tsx`

**Interfaces:**
- `useStrokePipeline` keeps one canvas-sized `Uint8Array` stroke mask in a ref (reallocated when the grid size changes) and `strokeBoundsRef: DirtyRect | null`. `appendStrokePoint` traces the segment, and for each cell not yet in `strokeAppliedCellsRef`, stamps `computeBrushIndices(cell)` into the mask with `stampCells`, growing the bounds; then `setPathPreview({ mask, bounds })` (the same object identity, since the renderer reads it on the next frame). `commitStrokeBuffer(value)` calls `editLayer(activeLayerId, bounds, b => fillMask(b, mask, bounds, toPackedValue(value)))`, then `clearMaskRect(mask, grid, bounds)`. `stopStroke` clears the mask rect if a stroke was abandoned. `buildLinePreview(path): PreviewMask` uses a second scratch mask for the line, shape, and shift-line previews, cleared on each build over its last bounds.

- [ ] **Step 1: Write the failing tests**

```ts
it("grows the preview mask only by new cells per step", () => { /* count mask cells after 2 moves; third move over already-traced cells changes nothing */ });
it("commits the stroke as one edit over the stroke bounds and clears the mask", () => { /* editLayer called once with rect === bounds; mask all zero afterwards */ });
it("keeps a 32-cell brush stroke's edit rect within the brush-padded path bounds", ...)
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL (preview identity / edit rect).

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run check`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add app/components/PixelPencil/hooks/useStrokePipeline.ts app/components/PixelPencil/hooks/useStrokePipeline.test.tsx app/components/PixelPencil/PixelPencil.tsx
git commit -m "Trace strokes into a preview mask and commit them as one edit"
```

---

### Task 9: Bucket hover preview throttle

**Files:**
- Modify: `app/components/PixelPencil/PixelPencil.tsx` (`getOverlayFrame`'s bucket branch)
- Test: `app/components/PixelPencil/PixelPencil.test.tsx`

**Interfaces:**
- The bucket mask cache is `{ hoverIndex: number; layerVersion: number; mask: PreviewMask | null }` in a ref; `getOverlayFrame` recomputes only when `hoverIndex` or `layerVersion` differ, never while `isDrawingRef.current` is true, and only when `tool === "bucket" && previewToolEffects`.

- [ ] **Step 1: Write the failing test**

```ts
it("computes the bucket preview once per hover cell and not while a button is down", () => {
  // spy on grid-geometry.collectFillMask via vi.mock partial; hover the same cell twice -> 1 call; press and move -> no new calls
});
```

- [ ] **Step 2: Run to verify it fails**, **Step 3: Implement**, **Step 4: `npm run check` green**

- [ ] **Step 5: Commit**

```bash
git commit -am "Cache the bucket hover preview per cell and skip it while drawing"
```

---

### Task 10: Grid size numeric inputs

**Files:**
- Modify: `app/components/PixelPencil/context/PixelPencilSettingsContext.tsx`
- Create: `app/components/PixelPencil/Settings/GridDimensionInput.tsx`
- Modify: `app/components/PixelPencil/Settings/SettingsModal.tsx`
- Test: `app/components/PixelPencil/context/PixelPencilSettingsContext.test.tsx`, create `app/components/PixelPencil/Settings/SettingsModal.test.tsx`

**Interfaces:**
- Context: `gridWidth: number`, `gridHeight: number`, `setGridWidth: (value: number) => void`, `setGridHeight: (value: number) => void` (setters clamp through `clampGridDimension`). Export `clampGridDimension(value: unknown): number | null` (integer in `[MIN_GRID_DIMENSION, MAX_GRID_DIMENSION]`, else `null`). Hydration uses it and falls back to `DEFAULT_GRID_DIMENSION`. Remove `GRID_DIMENSION_OPTIONS`.
- `GridDimensionInput({ label: "Grid Width" | "Grid Height"; value: number; onCommit: (value: number) => void })`: `<input type="number" inputMode="numeric" min=1 max=2048 step=1 aria-label={label}>`; local draft state; commits on blur and Enter; an invalid draft (empty, non-integer, out of range) reverts to `value` and shows the text `Enter a whole number from 1 to 2048`. Below the pair of inputs, when either value is above 1024, `SettingsModal` shows `Very large canvases need a desktop browser.`

- [ ] **Step 1: Write the failing tests**

```ts
// PixelPencilSettingsContext.test.tsx
it("hydrates any integer grid size from 1 to 2048 and falls back to 32 otherwise", ...)  // stored 2000 -> 2000; stored 4096 -> 32; stored "abc" -> 32
it("clamps setGridWidth to the allowed range", ...)
// SettingsModal.test.tsx
it("commits a typed grid width on Enter and on blur", ...)
it("reverts an invalid grid height and shows the range message", ...)
it("warns above 1024", ...)
```

- [ ] **Step 2: Run to verify they fail**, **Step 3: Implement**, **Step 4: `npm run check` green**

- [ ] **Step 5: Commit**

```bash
git add -A app/components/PixelPencil/context app/components/PixelPencil/Settings
git commit -m "Let the grid size be any integer up to 2048"
```

---

### Task 11: Resize and reset safety

**Files:**
- Modify: `app/components/PixelPencil/PixelPencil.tsx`
- Test: `app/components/PixelPencil/PixelPencil.test.tsx`

**Interfaces:**
- The render-time resize migration: when `gridWidth`/`gridHeight` differ from `layerDimensions`, every layer's buffer is `resizeBuffer`d, the composite is recreated (`useComposite` handles the size), history is cleared (`clear()` also ends any in-progress action), the stroke pipeline's masks are reallocated (expose `resetForGrid()` from `useStrokePipeline`, called here), the move drag is cancelled (`finishMoveDrag(drag.pointerId, true)` when active), `hoverRef` and `pathPreviewRef` are cleared, and `previewVersion` is bumped.

- [ ] **Step 1: Write the failing test**

```ts
it("a grid resize during an open action clears the action without writing stale cells", async () => {
  // start a center stroke on 32x32, change grid to 8x8 through the settings provider, finish the stroke
  // expect: no painted cells outside 8x8, canUndo false, no console errors
});
```

- [ ] **Step 2: Run to verify it fails**, **Step 3: Implement**, **Step 4: `npm run check` green**

- [ ] **Step 5: Commit**

```bash
git commit -am "Drop in-progress actions safely when the grid is resized"
```

---

### Task 12: Thumbnails and export from ImageData

**Files:**
- Modify: `app/components/PixelPencil/hooks/useLayerPreviews.ts`, `app/components/PixelPencil/hooks/usePixelExport.ts`, `app/components/PixelPencil/PixelPencilModals.tsx`
- Test: `useLayerPreviews.test.tsx`, `usePixelExport.test.tsx`

**Interfaces:**
- `useLayerPreviews(layers, gridWidth, gridHeight, previewVersion)`: per layer, `putImageData` of an `ImageData` over the layer's buffer into a reusable offscreen canvas of the grid size, then `drawImage` scaled into the thumbnail canvas over the checkerboard with `imageSmoothingEnabled = false` and `globalAlpha` 0.4 for hidden layers; one `toDataURL` per layer. No per-cell loop.
- `usePixelExport({ gridWidth, gridHeight, compositeRef, compositeVersion })` returns the existing fields plus `availableScales: ReadonlyArray<(typeof EXPORT_SCALES)[number]>` (scales where `gridWidth * scale <= MAX_EXPORT_DIMENSION && gridHeight * scale <= MAX_EXPORT_DIMENSION`, always including `1`); `exportScale` is reset to `1` when it is no longer available. Export: `putImageData` at scale 1 into a grid-sized canvas, then `drawImage` into the output canvas with smoothing off. `PixelPencilModals` takes `exportScales` and renders only those.

- [ ] **Step 1: Write the failing tests**

```ts
// useLayerPreviews.test.tsx
it("rasterizes each layer with one putImageData and one scaled drawImage", ...)
it("does not re-render thumbnails until previewVersion changes", ...)
// usePixelExport.test.tsx
it("exports through putImageData and a scaled drawImage", ...)
it("hides scales whose output exceeds 16384 pixels", () => { /* 2048x2048 -> [1, 3, 5]; 1700x100 -> [1, 3, 5]; 32x32 -> [1, 3, 5, 10] */ });
```

- [ ] **Step 2: Run to verify they fail**, **Step 3: Implement**, **Step 4: `npm run check` green**

- [ ] **Step 5: Commit**

```bash
git add -A app/components/PixelPencil
git commit -m "Render thumbnails and exports from ImageData"
```

---

### Task 13: Benchmark scenarios and script

**Files:**
- Create: `app/components/PixelPencil/perf-scenarios.ts` (pure, no React)
- Create: `app/components/PixelPencil/perf.bench.ts`
- Create: `app/components/PixelPencil/perf-scenarios.test.ts`
- Modify: `package.json` (`"bench": "vitest bench --run"`)
- Modify: `vitest.config.ts` (add `benchmark: { include: ["app/**/*.bench.ts"] }`)

**Interfaces:**
- `perf-scenarios.ts` exports `createScenario(size: number, layerCount = 3): Scenario` with layers of `PixelBuffer`s where every third cell is painted, and the functions `runStroke(scenario, steps = 200, brushSize = 16)`, `runBucketFillEmpty(scenario)`, `runTranslateStep(scenario, dx = 100, dy = 0)`, `runRecompose64(scenario)`, `runUndoRedo(scenario)`, each exercising only `pixel-buffer.ts` and `grid-geometry.ts` (and for undo, a minimal patch apply using `extractRect`/`writeRect`). `perf.bench.ts` registers a `bench` per function per size in `[256, 1024, 2048]`.

- [ ] **Step 1: Write the smoke test**

```ts
it("every scenario runs at 256 and reports a dirty rect bounded by its touched area", () => {
  // runStroke returns the edit rect; expect rect area < 256*256 / 4
});
```

- [ ] **Step 2: Run to verify it fails**, **Step 3: Implement**

- [ ] **Step 4: Run the bench and the gate**

Run: `npm run bench`
Expected: a table with the fifteen entries; record the 2048 stroke and fill numbers for the PR description.
Run: `npm run check`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add app/components/PixelPencil/perf-scenarios.ts app/components/PixelPencil/perf.bench.ts app/components/PixelPencil/perf-scenarios.test.ts package.json vitest.config.ts
git commit -m "Add a benchmark for the pixel hot paths at 256, 1024, and 2048"
```

---

### Task 14: Documentation and goal guardrails

**Files:**
- Modify: `ARCHITECTURE.md`, `AGENTS.md`, `README.md`, `app/changelog.json`

- [ ] **Step 1: Update `ARCHITECTURE.md`**

Rewrite "Editor state and data flow" for `PixelBuffer` layers, `editLayer`, `useComposite`, hover and preview refs with `useRedrawSignal`, and tile-patch history; rewrite the `PixelGrid` paragraph for the checkerboard, composite blit, and overlay passes and the 4-pixel grid-line rule; update thumbnails and export. Add a "Performance budget" section stating: the 2048×2048 goal (desktop target, phones best-effort), the five design principles from the spec, the dirty-rectangle contract (`editLayer` callers pass the bounding rect before mutating), and that `npm run bench` reports the hot paths.

- [ ] **Step 2: Update `AGENTS.md`**

Under "Before changing code", add: "The editor must stay responsive up to 2048×2048. Read the Performance budget section of ARCHITECTURE.md before touching the pixel model, renderer, history, or tools, and keep per-frame work bounded by the viewport and per-input work by the touched area." Under "Completion rule", add: "Run `npm run bench` before and after changes to those paths and report the numbers in the PR."

- [ ] **Step 3: Update `README.md` and `app/changelog.json`**

README feature line for grid sizes: "any size from 1 to 2048 pixels per side". Changelog entry for the next version describing large-canvas performance and the free grid size input (follow the existing entry shape; `app/changelog.test.ts` validates it).

- [ ] **Step 4: Run the gate**

Run: `npm run check`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add ARCHITECTURE.md AGENTS.md README.md app/changelog.json
git commit -m "Document the large-canvas performance budget"
```

---

### Task 15: Manual verification in the browser

- [ ] **Step 1:** With the dev server on Node 22, set the grid to 2000×2000 in Settings, then: draw a long pencil stroke with brush size 32, bucket-fill the empty canvas, select all and drag the selection, move the layer with the move tool, undo and redo each, add a layer and toggle visibility, export at scale 1. Each must feel immediate; the page must not freeze.
- [ ] **Step 2:** At 32×32 confirm the pixel grid, previews, dimmed previews, tool cursors, and the floating selection look as before.
- [ ] **Step 3:** Record the `npm run bench` output and the manual results in the PR description.
