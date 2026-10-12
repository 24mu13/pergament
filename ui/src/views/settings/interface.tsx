import { useApp } from "@/app";
import { Segmented } from "@/components/segmented";
import type { Layout, Theme } from "@/lib/settings";
import { t, uiLanguages } from "@/lib/i18n";
import type { UiLangSetting } from "@/lib/i18n";

const uiLangs: { value: UiLangSetting; label: string }[] = [
  { value: "system", label: "System" },
  ...uiLanguages().map((l) => ({ value: l.code, label: l.name })),
];

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
        <Segmented
          label={t("Interface language")}
          value={uiLang}
          options={uiLangs.map((l) => ({ value: l.value, label: l.value === "system" ? t(l.label) : l.label }))}
          onChange={setUiLang}
        />
      </section>
      <section>
        <h2 className="mb-3 text-sm font-semibold">{t("Appearance")}</h2>
        <Segmented
          label={t("Appearance")}
          value={theme}
          options={themes.map((x) => ({ ...x, label: t(x.label) }))}
          onChange={setTheme}
        />
      </section>
      <section>
        <h2 className="mb-3 text-sm font-semibold">{t("Content width")}</h2>
        <Segmented
          label={t("Content width")}
          value={layout}
          options={layouts.map((x) => ({ ...x, label: t(x.label) }))}
          onChange={setLayout}
        />
        <p className="mt-2 max-w-xl text-sm text-muted">
          {t("A centered column is easier to read; full width uses the whole window for lists, covers and the reader.")}
        </p>
      </section>
    </div>
  );
}
