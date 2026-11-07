import { type ReactNode } from "react";

interface ActionRequestModalProps {
  title: string;
  message?: string | null;
  renderBody?: () => ReactNode;
  handleClose: () => void;
  handleConfirm: () => void;
  confirmText?: string;
  cancelText?: string;
  hideCancelButton?: boolean;
  /** Shown under the action buttons as an alert. */
  error?: string | null;
}

export function ActionRequestModal({
  title,
  message,
  renderBody,
  handleClose,
  handleConfirm,
  confirmText = "Confirm",
  cancelText = "Cancel",
  hideCancelButton = false,
  error = null,
}: ActionRequestModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="action-dialog-title"
        className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      >
        <h2
          id="action-dialog-title"
          className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
        >
          {title}
        </h2>
        {renderBody ? (
          <div className="mt-4">{renderBody()}</div>
        ) : message ? (
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{message}</p>
        ) : null}
        <div className="mt-6 flex justify-end gap-3">
          {!hideCancelButton && (
            <button
              type="button"
              onClick={handleClose}
              className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 dark:focus-visible:ring-white dark:focus-visible:ring-offset-black"
            >
              {cancelText}
            </button>
          )}
          <button
            type="button"
            onClick={handleConfirm}
            className="rounded-full bg-black px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:bg-white dark:text-black dark:hover:bg-zinc-200 dark:focus-visible:ring-white dark:focus-visible:ring-offset-black"
          >
            {confirmText}
          </button>
        </div>
        {error ? (
          <p role="alert" className="mt-3 text-right text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
