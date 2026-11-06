"use client";

import changelog from "../../../changelog.json";

interface ChangelogModalProps {
  onClose: () => void;
}

export function ChangelogModal({ onClose }: ChangelogModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
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
          {changelog.map((entry) => (
            <div key={entry.version} className="space-y-2">
              <div className="flex items-center justify-between text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                <span>v{entry.version}</span>
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
            onClick={onClose}
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 dark:focus-visible:ring-white dark:focus-visible:ring-offset-black"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
