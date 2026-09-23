# Pixie Paint v0.3.0

This release makes it easier to move artwork, work with color and brush size, and navigate the canvas on desktop and mobile.

## What's new

- **Move tool:** Drag artwork or a selection. Enable Auto Pick Layer to move the layer under the pointer. Completed moves support undo and redo.
- **Layer names:** Double-click a layer name to rename it.
- **Canvas navigation:** Pan with two-finger scrolling or a middle-button drag. Pinch, use a mouse wheel, or click with the magnifier to zoom around the pointer.
- **Color and brush controls:** Adjust hue, saturation, and lightness directly. Type a brush size from 1 to 256 pixels or drag the size input, with a canvas preview of the brush footprint.
- **Mobile controls:** Open Layers or Palette in a scrollable sheet over the canvas. The canvas keeps its size, and its uncovered area remains drawable.

## Improvements and fixes

- Live paint previews show the color that will be applied. The new Dim Stroke Preview setting restores the darker preview style.
- Canvas rendering aligns pixel edges to device pixels to avoid hairline seams at fractional positions.
- Automated checks now cover editor behavior and run before the version workflow publishes a tag.
- The production build no longer depends on downloading unused Google fonts.
