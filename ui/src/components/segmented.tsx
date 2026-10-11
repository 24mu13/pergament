import { cn } from "@/lib/utils";

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex overflow-hidden rounded-md border border-line">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn(
            "px-4 py-2 text-sm",
            value === o.value ? "bg-bar font-medium" : "bg-surface text-muted hover:bg-bar hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
