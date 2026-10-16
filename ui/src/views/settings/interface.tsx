import { useApp } from "@/app";
import { ChevronDown } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Layout, Theme } from "@/lib/settings";
import { t, uiLanguages } from "@/lib/i18n";
import type { UiLangSetting } from "@/lib/i18n";

const uiLangs: { value: UiLangSetting; label: string }[] = [
  { value: "system", label: "System" },
  ...uiLanguages().map((l) => ({ value: l.code, label: l.name })),
];

// Language names are shown in their own language; only "System" is translated.
const label = (l: { value: UiLangSetting; label: string }) => (l.value === "system" ? t(l.label) : l.label);

const themes: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const layouts: { value: Layout; label: string }[] = [
  { value: "centered", label: "Centered" },
  { value: "wide", label: "Full width" },
];

export function InterfaceTab() {
  const { uiLang, setUiLang, theme, setTheme, layout, setLayout } = useApp();
  return (
    <div className="space-y-10">
      <section>
        <h2 className="mb-3 text-sm font-semibold">{t("Interface language")}</h2>
        {/* A list rather than buttons, so it keeps its size as languages are added. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" aria-label={t("Interface language")} className="min-w-56 justify-between font-normal">
              {label(uiLangs.find((l) => l.value === uiLang) ?? uiLangs[0])}
              <ChevronDown size={16} className="text-muted" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup value={uiLang} onValueChange={(v) => setUiLang(v as UiLangSetting)}>
              {uiLangs.map((l) => (
                <DropdownMenuRadioItem key={l.value} value={l.value}>
                  {label(l)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </section>
      <section>
        <h2 className="mb-3 text-sm font-semibold">{t("Appearance")}</h2>
        {/* A click on the chosen one would turn it off; one always stays chosen. */}
        <ToggleGroup type="single" aria-label={t("Appearance")} value={theme} onValueChange={(v) => v && setTheme(v as typeof theme)}>
          {themes.map((x) => (
            <ToggleGroupItem key={x.value} value={x.value}>
              {t(x.label)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </section>
      <section>
        <h2 className="mb-3 text-sm font-semibold">{t("Content width")}</h2>
        {/* A click on the chosen one would turn it off; one always stays chosen. */}
        <ToggleGroup type="single" aria-label={t("Content width")} value={layout} onValueChange={(v) => v && setLayout(v as typeof layout)}>
          {layouts.map((x) => (
            <ToggleGroupItem key={x.value} value={x.value}>
              {t(x.label)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="mt-2 max-w-xl text-sm text-muted">
          {t("A centered column is easier to read; full width uses the whole window for lists, covers and the reader.")}
        </p>
      </section>
    </div>
  );
}
