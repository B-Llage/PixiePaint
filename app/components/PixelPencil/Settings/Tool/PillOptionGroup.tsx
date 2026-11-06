interface PillOption<T extends string> {
  id: T;
  label: string;
}

interface PillOptionGroupProps<T extends string> {
  label: string;
  options: readonly PillOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** A labelled row of pill buttons where exactly one option is selected. */
export function PillOptionGroup<T extends string>({ label, options, value, onChange }: PillOptionGroupProps<T>) {
  return (
    <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
      <span className="text-xs font-medium text-zinc-300">
        {label}
      </span>
      <div className="flex gap-1.5">
        {options.map((option) => {
          const isSelected = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              className={`h-8 rounded-full border border-zinc-300 px-3 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-zinc-700 dark:focus-visible:ring-white dark:focus-visible:ring-offset-black ${
                isSelected
                  ? "bg-black text-white dark:bg-white dark:text-black"
                  : "bg-white text-zinc-700 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              }`}
              onClick={() => onChange(option.id)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
