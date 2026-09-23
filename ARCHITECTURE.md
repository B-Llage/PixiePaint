# Pixie Paint architecture

## Runtime and entry point

This is a client-side pixel art editor built with Next.js App Router, React, TypeScript, and Tailwind CSS. `app/page.tsx` mounts `PixelPencil` inside `PixelPencilSettingsProvider`. `app/layout.tsx` supplies metadata, global CSS, and analytics. The stylesheet uses system fonts, so production builds do not fetch font assets. There is no application backend or server persistence.

## Editor state and data flow

`PixelPencil.tsx` owns the current tool, palette, layers, selection, pointer gestures, undo/redo, viewport, and dialogs. Layers are ordered bottom to top. Each layer has a row-major pixel array of `gridWidth * gridHeight` cells; `null` is empty and `"transparent"` is a transparent paint value. The active layer receives edits. `pixel-operations.ts` contains pure movement and visible-layer composition: the topmost visible opaque pixel wins at each cell.

An action records a snapshot of layers, active layer, and selection before it changes them. Undo and redo restore those snapshots, with history capped by `MAX_HISTORY`. Selection can float while being moved before it is committed. Pointer events are converted from viewport coordinates to grid cells in `PixelPencil`, then dispatched to the active tool. The grid's canvas receives the composed pixels and transient previews.

`PalettePanel` shows preset colors and the selected color's hue, saturation, and lightness sliders. `SelectedColor` converts between hex and HSL, keeps the last custom HSL selection so hue survives grayscale and lightness extremes, and updates both the active color and the drawing value when a slider changes.

On mobile, a fixed-height Layers/Palette control row opens one panel at a time as a bottom sheet over the canvas viewport. The sheet occupies no layout height, so opening it does not change the measured viewport or the artwork's display cell size. Its contents scroll within the sheet, and the uncovered canvas remains interactive. At the desktop breakpoint, the controls move to the sidebar.

`PixelGrid.tsx` draws the checkerboard, pixels, grid, previews, and selection overlay on an HTML canvas. `PixelPencil` owns a signed viewport offset; the grid applies it to artwork rendering and pointer hit testing, with a centered base position when the artwork fits. `canvas-pan.ts` computes shared pan bounds that keep at least 216 pixels of artwork visible on each axis (or its full size or the viewport size if smaller). Magnifier clicks, touchpad pinch, identifiable mouse-wheel notches, and Cmd/Win + wheel zoom around the cursor's fractional artwork position, adjusting the viewport offset so the same point remains under the cursor. Chromium pinch arrives as Ctrl + wheel; Safari uses gesture events. Ambiguous pixel-mode scrolling keeps the two-finger pan behavior because wheel events do not reliably identify the input device. A zoom may extend the pan range beyond the usual visibility limit to preserve that anchor. Scrollbar thumbs reflect the extended range; two-finger scrolling and middle-button panning can move back toward the usual limit but cannot move farther past the zoom-created offset. `LayersPanel`, `Toolbox`, `ToolSettingsPanel`, and the modal components are controls around this editor state.

Stroke path previews render at full opacity by default so in-progress paint shows its final color. Brush and bucket hover previews also show the selected color at full opacity; eraser and transparent paint previews show the checkerboard. The persisted `dimStrokePreview` setting restores the former translucent path preview and hover shading. The brush-size shadow retains its own preview style.

The brush size input keeps focus during typing. `PixelPencil` ignores the first canvas pointer gesture after typing so that gesture only dismisses the field. A vertical drag on the size input clears focus as it adjusts the size, allowing canvas keyboard shortcuts immediately afterward.
During that drag, `PixelPencil` computes the active brush footprint at the center of the visible artwork. `PixelGrid` draws it as a translucent shadow above the artwork without changing pixels, then removes it on pointer release or cancel.

## Browser state and export

`PixelPencilSettingsContext.tsx` owns display and canvas settings. It hydrates validated values from the `pixel-pencil-settings` localStorage key after mount, then writes changes back. Artwork itself is in memory and is lost on reload unless exported.

`usePixelExport.ts` renders the composed pixels into a separate canvas at the chosen scale, skips empty and transparent cells, and downloads a PNG through a blob URL. Static tool icons and the logo live under `public/`.

## Verification

Run `npm run check` for lint, type checking, and Vitest. Tests sit beside the code they exercise. GitHub Actions runs the same gate for pull requests and `main`; the version bump waits for it to pass.
