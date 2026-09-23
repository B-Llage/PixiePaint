"use client";

interface ChangelogModalProps {
  handleCloseChangelogDialog: () => void;
}

const CHANGELOG_ENTRIES = [
  {
    version: "v0.3.0",
    title: "Canvas and Workflow Improvements",
    changes: [
      "Move artwork or selections with the new Move tool, with optional automatic layer picking.",
      "Rename layers by double-clicking their names.",
      "Pan with two-finger scrolling or a middle-button drag, and zoom around the cursor with pinch, wheel, or magnifier controls.",
      "Create custom colors with hue, saturation, and lightness sliders.",
      "Type or drag to set brush sizes from 1 to 256 pixels, with an on-canvas size preview.",
      "Open Layers and Palette in mobile sheets without changing the canvas size.",
      "See paint previews at their final color, or enable Dim Stroke Preview in Settings.",
    ],
  },
  {
    version: "v0.2.1",
    title: "Maintenance Update",
    changes: [
      "Updated Next.js and React to the latest stable releases.",
    ],
  },
  {
    version: "v0.2.0",
    title: "PixelPencil Improvements",
    changes: [
      "Fixed Tool Settings scrolling so only the panel scrolls within the layout.",
      "Locked the app layout to the viewport to avoid full-page scrolling.",
      "Matched selection preview animation to the final applied selection outline.",
      "Allowed selections to move outside the canvas with proper cropping on apply.",
      "Selection moves now restore to the original position on undo.",
      "Checkerboard background uses grid-based squares with a configurable size.",
      "Added a checker size option (1-8) in global settings.",
      "Replaced tool button hover titles with HTML tooltips.",
      "Added tooltip styling with a border and centered pointer.",
      "Changelog modal added.",
    ],
  },
  {
    version: "v0.1.0",
    title: "Initial Release",
    changes: [
      "Launched Pixie Paint with core drawing tools and layer support.",
    ],
  },
];

export function ChangelogModal({
  handleCloseChangelogDialog,
}: ChangelogModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={handleCloseChangelogDialog}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="changelog-dialog-title"
        className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(event) => event.stopPropagation()}
      >
        <h2
          id="changelog-dialog-title"
          className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
        >
          Changelog
        </h2>
        <div className="mt-4 max-h-[60vh] space-y-6 overflow-y-auto text-sm text-zinc-700 dark:text-zinc-200">
          {CHANGELOG_ENTRIES.map((entry) => (
            <div key={entry.version} className="space-y-2">
              <div className="flex items-center justify-between text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                <span>{entry.version}</span>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  {entry.title}
                </div>
                <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
                  {entry.changes.map((change) => (
                    <li key={change}>{change}</li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={handleCloseChangelogDialog}
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 dark:focus-visible:ring-white dark:focus-visible:ring-offset-black"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
