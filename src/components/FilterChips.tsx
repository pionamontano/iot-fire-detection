// Single-select filter chips (replaces a <select>): every option and its
// count is visible at once, and one tap switches. Scrolls sideways on phones.
export function FilterChips<V extends string>({ label, value, onChange, options }: {
  label: string;
  value: V;
  onChange: (v: V) => void;
  options: { value: V; label: string; count: number }[];
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-2 overflow-x-auto scrollbar-hide -mx-3 px-3 sm:mx-0 sm:px-0">
      {options.map(o => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.value)}
            className={`h-9 px-3.5 rounded-full border text-sm whitespace-nowrap shrink-0 inline-flex items-center gap-2 transition-colors ${
              selected
                ? 'bg-primary border-primary text-white font-bold'
                : 'bg-surface-card border-border text-text-body font-semibold hover:border-text-faint hover:text-text'
            }`}
          >
            {o.label}
            <span className={`text-xs font-bold tabular-nums ${selected ? 'text-white/80' : 'text-text-faint'}`}>{o.count}</span>
          </button>
        );
      })}
    </div>
  );
}
