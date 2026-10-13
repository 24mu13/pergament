import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, Languages } from "lucide-react";
import { api, type Language } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { t } from "@/lib/i18n";
import type { BibleChoice } from "@/lib/bible";
import { Progress } from "@/components/ui/progress";

// The list is the same for the whole session; load it once.
let cache: Promise<Language[]> | null = null;
export function loadLanguages(): Promise<Language[]> {
  cache ??= api.languages().catch((e) => {
    cache = null;
    throw e;
  });
  return cache;
}

/** The Bibles of each language, so a language with several lists them to pick from. */
export interface Translations {
  choicesFor: (code: string) => BibleChoice[];
  /** Symbol of the Bible that is open in the selected language. */
  current: string | null;
  onPick: (choice: BibleChoice) => void;
  /** The running download of a translation, if any. */
  progress: (choice: BibleChoice) => { done: number; total: number | null } | undefined;
}

/** Percent done of a download; null while its size is unknown. */
export const percent = (p: { done: number; total: number | null }) => (p.total ? Math.min(100, (p.done / p.total) * 100) : null);

/** Language button for the top-right corner of the app bar. */
export function LanguageMenu({
  value,
  onChange,
  libraryCodes,
  translations,
}: {
  value: string;
  onChange: (code: string) => void;
  libraryCodes: string[];
  translations?: Translations;
}) {
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

  // Close once a download that kept the menu open has finished.
  const downloading = (languages ?? []).some((l) => translations?.choicesFor(l.code).some((c) => translations.progress(c)));
  const wasDownloading = useRef(false);
  useEffect(() => {
    if (wasDownloading.current && !downloading) setOpen(false);
    wasDownloading.current = downloading;
  }, [downloading]);

  const byCode = useMemo(() => new Map(languages?.map((l) => [l.code, l]) ?? []), [languages]);
  const current = byCode.get(value);
  const q = query.trim().toLowerCase();
  const matches = (l: Language) =>
    !q || l.code.toLowerCase() === q || l.name.toLowerCase().includes(q) || l.vernacular.toLowerCase().includes(q);

  const inLibrary = libraryCodes.map((c) => byCode.get(c) ?? { code: c, name: c, vernacular: c, rtl: false, signLanguage: false });
  const all = (languages ?? []).filter((l) => !libraryCodes.includes(l.code));

  const row = (l: Language) => {
    const choices = translations?.choicesFor(l.code) ?? [];
    return choices.length > 1 ? translationRows(l, choices) : languageRow(l);
  };

  const translationRows = (l: Language, choices: BibleChoice[]) => (
    <div key={l.code} role="group" aria-label={l.vernacular}>
      <div className="px-4 pt-2 text-xs text-muted" dir={l.rtl ? "rtl" : undefined}>
        {l.vernacular} <span>· {l.name}</span>
      </div>
      {choices.map((c) => {
        const active = l.code === value && c.symbol === translations!.current;
        const running = translations!.progress(c);
        return (
          <button
            key={c.symbol}
            disabled={!!running}
            onClick={() => {
              translations!.onPick(c);
              // A download keeps the menu open to show its progress; the effect above closes it when done.
              if (c.dir) setOpen(false);
              setQuery("");
            }}
            className={cn("flex w-full items-center gap-3 py-2 pl-7 pr-4 text-left hover:bg-bar", active && "text-accent")}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{c.title}</span>
              {running && <Progress value={percent(running)} label={c.title} className="mt-1.5 h-1" />}
            </span>
            {running ? (
              <span className="text-xs tabular-nums text-muted">{percent(running) != null ? `${Math.round(percent(running)!)}%` : t("Loading…")}</span>
            ) : (
              !c.dir && <Download size={15} aria-label={t("Not downloaded")} className="text-muted" />
            )}
            {active && <Check size={16} />}
          </button>
        );
      })}
    </div>
  );

  const languageRow = (l: Language) => (
    <button
      key={l.code}
      onClick={() => {
        onChange(l.code);
        setOpen(false);
        setQuery("");
      }}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-bar",
        l.code === value && "text-accent",
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
      {l.code === value && <Check size={16} />}
    </button>
  );

  return (
    <div ref={ref} className="relative">
      <button
        title={t("Language: {name}", { name: current?.vernacular ?? value })}
        aria-label={t("Language")}
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 items-center gap-1.5 rounded-md px-2 text-muted hover:bg-bar hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Languages size={18} strokeWidth={1.6} />
        <span className="text-[13px] font-medium">{value}</span>
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
            {inLibrary.filter(matches).length > 0 && (
              <>
                <div className="px-4 pb-1 pt-2 text-[13px] font-semibold text-muted">
                  {t("In your library")}
                </div>
                {inLibrary.filter(matches).map(row)}
              </>
            )}
            <div className="px-4 pb-1 pt-3 text-[13px] font-semibold text-muted">
              {t("All languages")}
            </div>
            {error && <p className="px-4 py-2 text-sm text-muted">{t("Language list unavailable: {error}", { error })}</p>}
            {!languages && !error && <p className="px-4 py-2 text-sm text-muted">{t("Loading…")}</p>}
            {all.filter(matches).map(row)}
          </div>
        </div>
      )}
    </div>
  );
}
