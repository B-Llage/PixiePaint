# Large-canvas performance design

Date: 2026-11-06
Status: approved design, awaiting implementation plan

## Goal

The editor and every tool must feel responsive at canvas sizes up to 2000×2000 cells. The grid size setting becomes a free numeric input from 1 to 2048 per axis. Desktop browsers are the target; phones must keep working but 2000×2000 is best-effort there. Future agents must find this goal, the rules that keep it true, and a way to measure it, in the repository itself.

Today the app becomes slow around 256×256. The size options stop at 256.

## Where the time goes today

Measured on main (commit a798b31) in Chromium on this machine. Canvas numbers are for a 736×547 CSS-pixel viewport at device pixel ratio 2.

| Hot path | Cost | Cause |
| --- | --- | --- |
| One frame of `PixelGrid` | 5 ms at 25k visible cells, 13 ms at 100k, 88 ms at 400k, 219 ms at 1.6M | One `fillRect` plus four `Set` lookups per visible cell, every frame |
| The same frame via `putImageData` plus one scaled `drawImage` | 2 ms at 4M cells | What the renderer should do instead |
| Every pointer move | Re-renders `PixelPencil` and every panel | `hoverIndex` is React state; `brushPreview` and `bucketPreview` are memos keyed on it |
| Every freehand stroke step | Grows with stroke length × brush area | `useStrokePipeline.appendStrokePoint` rebuilds the whole preview `Set` from every applied cell |
| Every stroke commit | Whole-layer copy, whole-layer compare, whole-canvas recompose, then one `fillRect` per cell per layer and a `toDataURL` for thumbnails | `setActiveLayerPixels`, `composeLayers`, `useLayerPreviews` |
| Every undo entry | Clones every layer; `areLayersEqual` scans every cell | `captureSnapshot` and `useEditorHistory` dedupe |
| Bucket hover and fill | Object allocation per visited cell, run on every hover move | `collectFillRegion` |
| Floating selection | One DOM `div` per selected pixel | `PixelGrid` selection overlay |
| Move drag step | Allocates and copies a whole layer per step | `translatePixels` |

Node benchmarks of the string-array model at 2000×2000 with three layers: compose 20 ms, clone-all-layers 45 ms, compare 28 ms, single-layer copy 4 ms. Those are per action, not per frame, so they are tolerable, but a 4M-element string array is about 32 MB, and fifteen undo snapshots of three such layers are about 1.4 GB. Memory, not CPU, rules out the string array model at the target size.

## Design principles

These are the rules the implementation follows and that ARCHITECTURE.md will state for future work:

1. **Per-frame work is bounded by the viewport**, never by the number of canvas cells. One frame draws the visible region of a prebuilt bitmap and an overlay whose cost is proportional to the preview and selection areas.
2. **Per-input work is bounded by the touched area.** A stroke step, fill, move step, or undo touches the cells it changes and the dirty rectangle around them, never the whole layer.
3. **No whole-layer scans in a hot path.** Equality checks, clones, and compares of full layers are allowed only in one-shot operations such as resize and reset, and even there they run once.
4. **Pixel storage is typed arrays**, so a layer costs 4 bytes per cell and copies are `TypedArray.set` calls.
5. **Hover and preview state do not flow through React.** They live in refs and redraw the canvas directly.

## Pixel model

### `pixel-buffer.ts` (new, pure)

A `PixelBuffer` is `{ width, height, data: Uint32Array }` with row-major cells. Encoding:

- `0` is an empty cell.
- `TRANSPARENT_PIXEL` is a reserved alpha-zero value (`0x00000001`) that marks the explicit transparent paint value. It composes and exports as nothing, renders as the checkerboard, but is distinct from empty for equality, selection capture, and the floating selection's checker tile.
- Any other value is a color packed as `0xAABBGGRR` in little-endian memory order, so the array can back an `ImageData` directly. Alpha is always `0xff` for painted colors.

Pure functions, each taking explicit buffers and returning dirty rectangles where they change cells:

- `packColor(hex): number` and `unpackColor(value): PixelValue`, with a small cache keyed by string. Palette colors are six-digit hex; the pack function also accepts three-digit hex.
- `createBuffer(width, height)`, `cloneBuffer`, `copyRect(src, dst, rect, dx, dy)`.
- `fillCells(buffer, indices, value): DirtyRect | null` for brush dabs, line paths, and shapes. Returns the bounding rectangle of the cells that actually changed, or `null` if nothing changed.
- `fillRegion(buffer, mask, bounds, value): DirtyRect | null` for the bucket fill.
- `translateBuffer(src, dst, dx, dy)` for the move tool, writing into a reusable destination.
- `resizeBuffer(src, nextWidth, nextHeight)` for the grid size change, top-left anchored.
- `extractRect(buffer, rect): Uint32Array` and `writeRect(buffer, rect, data)` for history patches and selections.
- `isBufferEmpty(buffer)`.

`DirtyRect` is `{ x, y, width, height }` in cells. A helper `unionRect(a, b)` merges them.

### `Layer`

`Layer` becomes `{ id, name, visible, pixels: PixelBuffer }`. The public color type `PixelValue` (`string | "transparent" | null`) stays the type for palette colors, tool values, selection pixels, and export, and converts to packed values at the boundary of the pixel model. Component tests that read pixels use `unpackColor` through a small `readPixel(layer, x, y)` helper, so their expectations stay in hex.

### Layer state and change notifications

`PixelPencil` keeps the `layers` array in `useStateWithRef`, but a pixel edit no longer replaces the array or the layer object. Instead the buffer is mutated in place and a `layerVersion` counter in state is bumped with the dirty rectangle recorded on a `pendingDirtyRef`. Structural changes (add, delete, reorder, rename, visibility, resize) still replace the array so panels and memos re-render.

The composite is a `PixelBuffer` owned by a new `useComposite` hook. It exposes `recompose(rect)` which recomputes the topmost visible non-empty value for cells inside `rect` only, and `recomposeAll()` for structural changes. The composite's `Uint32Array` is the backing store of an `ImageData`, so the renderer can upload it without a copy. The composite is kept in a ref and a `compositeVersion` state value signals the renderer.

Equality checks disappear from the edit path: a `fillCells` call that changes nothing returns `null` and the caller records no modification.

## Rendering

`PixelGrid` keeps its canvas, viewport math, pointer hit testing, pan, zoom, and scrollbars. The draw effect changes to three passes:

1. **Checkerboard.** Draw the checkerboard for the visible artwork rectangle with a cached `CanvasPattern` sized to the checker setting and the display cell size, so it costs one `fillRect`.
2. **Composite blit.** Upload the composite `ImageData` to a persistent offscreen canvas of the artwork's size only inside the dirty rectangle since the last frame (`putImageData` with a dirty rect), then `drawImage` the visible source region onto the viewport canvas scaled to the display cell size with image smoothing off. Cell edges stay crisp because the destination rectangle is snapped to device pixels the same way the current `xEdges`/`yEdges` rounding does.
3. **Overlay.** Brush preview, path preview, bucket preview, brush-size shadow, the selection outline, the floating selection pixels, and the pixel grid lines draw on top. Preview cells are bounded by brush area or path length, not by the viewport. The bucket preview and large path previews use a `Uint8Array` mask over the dirty bounds, drawn as one `ImageData` tinted with the preview color and blitted like the composite. Grid lines draw only when `showPixelGrid` is on and the display cell size is at least 4 CSS pixels, since below that they cover the artwork; this is a new rule and ARCHITECTURE.md records it.

The floating selection's pixels stop being DOM nodes. They render as a small `PixelBuffer` of the selection's size blitted at the selection's offset, with checker tiles for transparent values. The outline `div`s stay as they are.

### Hover without React re-renders

`hoverIndex` moves from `useState` to a ref owned by `PixelGrid`'s parent, plus a `requestRedraw()` function that schedules one `requestAnimationFrame` draw. Pointer enter, move, and leave update the ref and request a redraw. The pieces that still need hover in React are the shift-click line preview, the bucket hover preview, and the brush preview; those become functions the renderer calls during the overlay pass, reading the ref. `PixelPencil` no longer re-renders on pointer movement.

The draw effect's React dependencies shrink to viewport geometry, settings, `compositeVersion`, selection, and `drawValueVersion`. Every other trigger is an explicit `requestRedraw()`.

## History

`useEditorHistory` keeps its API (`beginAction`, `finalizeAction`, `commitSnapshot`, `markModified`, `saveStacks`, `restoreStacks`, `clear`, `undo`, `redo`, the `canUndo`/`canRedo` flags) but its entries become `HistoryEntry` values instead of full `LayerSnapshot`s:

- `PixelPatch`: `{ layerId, rect, before: Uint32Array, after: Uint32Array }`, recorded by pixel actions. `before` is captured when the action's first dirty rectangle is known, by extracting the rectangle from the layer; as the action grows its rectangle, the patch grows by extracting the newly covered area from the pre-action state. To make that possible, an action in progress keeps a pre-action copy of only the rows it has touched, built lazily. `after` is extracted at `finalizeAction`.
- `StructureEntry`: `{ layers: LayerMeta[], activeLayerId, selection, removedLayer?: Layer }` for add, delete, reorder, rename, visibility, and reset. `LayerMeta` holds id, name, and visibility, not pixels. Delete and reset keep the removed or cleared buffers so undo can restore them.
- `ResizeEntry`: `{ previousSize, croppedLayers: Map<layerId, Uint32Array> }`. Grid resize currently clears history; it continues to, so this entry is not needed in the first implementation and is listed here only to show how it would fit.

Dedupe no longer compares whole layers: an action whose patch has an empty rectangle, or whose `before` equals `after` byte for byte over that rectangle, is dropped. Selection state is still cloned into entries, since it is small.

Memory is bounded two ways: `MAX_HISTORY` stays 15 entries, and a byte budget (`HISTORY_BYTE_BUDGET`, 256 MB) drops the oldest entries when the sum of patch bytes exceeds it. A single patch larger than the budget is kept alone.

The move drag records a `PixelPatch` over the union of the layer's non-empty bounds before and after the drag. `useMoveDrag` keeps its cancel and unchanged-drag paths by restoring the saved stacks and writing the source buffer back.

## Tools

- **Pencil and eraser.** `useStrokePipeline` keeps the applied-cell set, but the preview becomes a `Uint8Array` mask over the artwork plus a running bounds rectangle; `appendStrokePoint` stamps only the new cells' footprints into the mask and requests a redraw. Commit stamps the same cells into the layer with `fillCells` and reports one dirty rectangle.
- **Line and shape.** Unchanged algorithms in `grid-geometry.ts`; previews go through the same mask.
- **Bucket.** `collectFillRegion` becomes a scanline fill over a `Uint32Array` with a `Uint8Array` visited mask, returning the mask and its bounds instead of a `Set`. The fill applies the mask with `fillRegion`. The hover preview computes the mask at most once per animation frame for the current hover cell, caches it by `(hoverIndex, layerVersion)`, and skips computing while any pointer button is down.
- **Picker.** Reads one cell; unchanged.
- **Move.** `translateBuffer` into a reusable scratch buffer per step, then `writeRect` of the union bounds into the layer. Selection capture uses `extractRect`.
- **Rectangular select.** `captureSelectionPixels` and `applySelectionToLayer` move to `extractRect`/`writeRect`. `SelectionState.pixels` becomes `{ rect, data: Uint32Array }` instead of an array of `{ relX, relY, color }` objects. Everything that reads selection pixels (overlay, move, history) uses the new shape.
- **Magnifier, pan, zoom.** Unchanged; they only trigger redraws.

## Grid size setting

`GridDimensionOption` becomes `number`. `PixelPencilSettingsContext` validates persisted and incoming values with `clampGridDimension(value)`: integers from `MIN_GRID_DIMENSION` (1) to `MAX_GRID_DIMENSION` (2048), falling back to 32 for invalid stored values. `SettingsModal` replaces the width and height pill groups with numeric inputs that commit on blur or Enter, show the allowed range, and reject non-integers. The automatic canvas pixel size reset on size change keeps its rule. `GRID_DIMENSION_OPTIONS` is removed.

Resizing above 1024 on either axis shows a one-line note under the inputs that very large canvases need a desktop browser.

## Thumbnails and export

`useLayerPreviews` renders each thumbnail by uploading the layer's `ImageData` to an offscreen canvas and `drawImage`-scaling it into the 64-pixel thumbnail with smoothing off, over the checkerboard, then `toDataURL`. It runs once per animation frame after `layerVersion` or structure changes as now, but it is additionally deferred until no action is in progress, so a stroke produces one thumbnail render when it ends.

`usePixelExport` renders from the composite `ImageData`: `putImageData` at scale 1, then `drawImage` into a canvas of the output size. Export scales whose output exceeds `MAX_EXPORT_DIMENSION` (16384 pixels on either axis) are hidden in the save dialog, and the preview image is drawn from the same path.

## Goal awareness and guardrails

- **ARCHITECTURE.md** gains a "Performance budget" section stating the 2048 target, the five design principles above, the dirty-rectangle contract of the pixel model, and the composite and overlay rendering passes. The state and data flow sections are updated for `PixelBuffer`, `useComposite`, hover refs, and history patches.
- **AGENTS.md** gains a rule: the editor must stay responsive up to 2048×2048; read the performance budget section before touching the pixel model, renderer, history, or tools; and run `npm run bench` before and after changes to those paths and report the numbers in the PR.
- **`scripts/bench.mjs`** (`npm run bench`) runs the pure modules under Node at 256, 1024, and 2048 on both axes with three layers and prints the time for: a 200-step freehand stroke with a 16-cell brush including preview updates, a bucket fill of an empty canvas, a 100-cell translate step, recompose of a 64×64 dirty rectangle, and one undo and redo of the stroke. It is informational and not part of `npm run check`.

## Testing

Unit tests, beside each module:

- `pixel-buffer.test.ts`: pack and unpack round trips, the transparent sentinel, dirty rectangles from `fillCells` and `fillRegion`, no-op edits returning `null`, translate clipping, resize anchoring, extract and write round trips.
- `grid-geometry.test.ts`: scanline fill matches the previous four-connected region on fixtures, including the transparent sentinel and grid edges.
- `useComposite.test.tsx`: partial recompose only touches the rectangle, visibility and order changes recompose everything, topmost visible wins.
- `useEditorHistory.test.tsx`: patch undo and redo restore bytes, empty patches are dropped, byte budget evicts oldest, structure entries restore a deleted layer's pixels.
- `useStrokePipeline.test.tsx`: preview mask grows only by new cells, commit reports one dirty rectangle.
- `useLayerPreviews.test.tsx` and `usePixelExport.test.tsx`: output pixels match the expected composite through a canvas mock.
- `PixelPencilSettingsContext.test.tsx` and a `SettingsModal.test.tsx`: numeric input validation, clamping, persistence, fallback for stored invalid values.
- `PixelGrid.test.tsx` and `PixelPencil.test.tsx`: existing behaviors continue (pointer events, selection, move, undo and redo, export) with pixel expectations read through `readPixel`; a new test asserts that pointer movement does not re-render `LayersPanel` (render counter), and that the floating selection draws no per-pixel DOM nodes.

The bench script is checked by a smoke test that imports it and runs the 256 case to make sure it still runs.

## Delivery

One pull request on `perf/large-canvas-responsiveness` from `main`, built as mergeable commits in this order:

1. Pixel buffer module and tests.
2. Layer and composite state on buffers, renderer blit path, hover refs.
3. History patches.
4. Tools: stroke mask, scanline fill, move, selection.
5. Grid size numeric input.
6. Thumbnails and export.
7. Bench script, ARCHITECTURE.md, AGENTS.md, README feature note.

`npm run check` must pass after every step, using Node 22 from `.nvmrc`.

## Out of scope

- Web Worker or OffscreenCanvas rendering.
- Persisting artwork across reloads.
- Changing the mobile layout or its minimum cell size.
- Partial thumbnail updates; one `drawImage` per layer per action is cheap enough.
