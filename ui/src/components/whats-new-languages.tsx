import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Languages } from "lucide-react";
import { type Language } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Command, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { loadLanguages } from "@/components/language-menu";

/** Picks the languages of the What's New section: several at once, never none. */
export function WhatsNewLanguages({ value, onChange }: { value: string[]; onChange: (codes: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [languages, setLanguages] = useState<Language[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      <CommandItem
        key={l.code}
        value={l.code}
        disabled={l.code === only}
        onSelect={() => onChange(active ? value.filter((c) => c !== l.code) : [...value, l.code])}
        className={cn(active && "text-accent")}
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
      </CommandItem>
    );
  };

  // Picking a language keeps the list open, to pick several.
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label={t("What's New languages")}
          className="flex h-8 items-center gap-1.5 rounded-md px-2 text-muted hover:bg-bar hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
        >
          <Languages size={18} strokeWidth={1.6} />
          <span className="text-[13px] font-medium">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex max-h-[min(70vh,var(--radix-popover-content-available-height))] w-80 flex-col overflow-hidden p-0"
      >
        <Command shouldFilter={false} label={t("What's New languages")}>
          <CommandInput autoFocus placeholder={t("Search languages")} value={query} onValueChange={setQuery} />
          <CommandList>
            {error && <p className="px-4 py-2 text-sm text-muted">{t("Language list unavailable: {error}", { error })}</p>}
            {!languages && !error && <p className="px-4 py-2 text-sm text-muted">{t("Loading…")}</p>}
            {(languages ?? []).filter(matches).map(row)}
          </CommandList>
        </Command>
        <div className="border-t border-line p-2">
          <Button variant="outline" className="w-full" onClick={() => setOpen(false)}>
            {t("Done")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
