import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Languages } from "lucide-react";
import { type Language } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { loadLanguages } from "@/components/language-menu";

/** Picks the languages of the What's New section: several at once, never none. */
export function WhatsNewLanguages({ value, onChange }: { value: string[]; onChange: (codes: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [languages, setLanguages] = useState<Language[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadLanguages()
      .then(setLanguages)
      .catch((e) => setError(String(e)));
  }, []);

  // Codes the loaded list does not have (a language retired on jw.org, say) are pruned once,
  // so the selection cannot get stuck on languages the section cannot show; the ref keeps the
  // prune from firing again on repeated renders.
  const pruned = useRef(false);
  useEffect(() => {
    if (pruned.current || !languages) return;
    pruned.current = true;
    const live = value.filter((c) => languages.some((l) => l.code === c));
    if (live.length !== value.length) onChange(live);
  }, [languages, value, onChange]);

  // Outside clicks and Escape close the dropdown; picking a language keeps it open.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const byCode = useMemo(() => new Map(languages?.map((l) => [l.code, l]) ?? []), [languages]);
  const q = query.trim().toLowerCase();
  const matches = (l: Language) =>
    !q || l.code.toLowerCase() === q || l.name.toLowerCase().includes(q) || l.vernacular.toLowerCase().includes(q);

  // The last selected language cannot be turned off, so the list never empties.
  const only = value.length === 1 ? value[0] : null;
  const label =
    value.length === 1 ? byCode.get(value[0])?.vernacular ?? value[0] : t("{count} languages", { count: String(value.length) });

  const row = (l: Language) => {
    const active = value.includes(l.code);
    return (
      <button
        key={l.code}
        disabled={l.code === only}
        onClick={() => {
          if (l.code === only) return;
          onChange(active ? value.filter((c) => c !== l.code) : [...value, l.code]);
        }}
        className={cn(
          "flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-bar",
          active && "text-accent",
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium" dir={l.rtl ? "rtl" : undefined}>
            {l.vernacular}
          </span>
          <span className="block truncate text-xs text-muted">
            {l.name}
          </span>
        </span>
        {active && <Check size={16} />}
      </button>
    );
  };

  return (
    <div ref={ref} className="relative">
      <button
        aria-label={t("What's New languages")}
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 items-center gap-1.5 rounded-md px-2 text-muted hover:bg-bar hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Languages size={18} strokeWidth={1.6} />
        <span className="text-[13px] font-medium">{label}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-40 flex max-h-[70vh] w-80 flex-col overflow-hidden rounded-md border border-line bg-surface shadow-sm">
          <div className="border-b border-line p-3">
            <Input
              autoFocus
              placeholder={t("Search languages")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full"
            />
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {error && <p className="px-4 py-2 text-sm text-muted">{t("Language list unavailable: {error}", { error })}</p>}
            {!languages && !error && <p className="px-4 py-2 text-sm text-muted">{t("Loading…")}</p>}
            {(languages ?? []).filter(matches).map(row)}
          </div>
          <div className="border-t border-line p-2">
            <Button variant="outline" className="w-full" onClick={() => setOpen(false)}>
              {t("Done")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
