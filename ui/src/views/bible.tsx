import { Check, Download } from "lucide-react";
import { AppBar, useApp, useBibleTranslations } from "@/app";
import { CatalogPrompt } from "@/components/catalog";
import { percent } from "@/components/language-menu";
import { Progress } from "@/components/ui/progress";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** The Bible tab of a language without a downloaded Bible: its translations to download, as in the language menu. */
export function BibleView() {
  const { lang, languageName } = useApp();
  const translations = useBibleTranslations(true);
  const choices = translations?.choicesFor(lang) ?? [];
  return (
    <>
      <AppBar title={t("Bible")} subtitle={languageName(lang)} />
      <div className="page flex-1 overflow-y-auto">
        {choices.length === 0 ? (
          <>
            <p className="mb-4 max-w-xl text-sm leading-normal text-muted">
              {t("No Bible in this language in your library yet")}
            </p>
            <CatalogPrompt />
          </>
        ) : (
          <>
            <p className="mb-4 text-sm text-muted">{t("Pick a translation to download. More languages are in the language menu.")}</p>
            <div className="flex max-w-xl flex-col gap-2">
              {choices.map((c) => {
                const running = translations!.progress(c);
                return (
                <button
                  key={c.symbol}
                  disabled={!!running}
                  onClick={() => translations!.onPick(c)}
                  className={cn(
                    "flex items-center gap-3 rounded-md border border-line px-4 py-3 text-left hover:bg-bar focus-visible:outline-2 focus-visible:outline-accent",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{c.title}</span>
                    {running && <Progress value={percent(running)} label={c.title} className="mt-1.5" />}
                  </span>
                  {running ? (
                    <span className="text-xs tabular-nums text-muted">
                      {percent(running) != null ? `${Math.round(percent(running)!)}%` : t("Loading…")}
                    </span>
                  ) : c.dir ? (
                    <Check size={16} />
                  ) : (
                    <Download size={16} aria-label={t("Not downloaded")} className="text-muted" />
                  )}
                </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </>
  );
}
