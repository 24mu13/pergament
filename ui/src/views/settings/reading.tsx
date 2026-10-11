import { useApp } from "@/app";
import { Segmented } from "@/components/segmented";
import type { ReadingFont } from "@/lib/settings";
import { t } from "@/lib/i18n";

const fonts: { value: ReadingFont; label: string }[] = [
  { value: "standard", label: "Standard" },
  { value: "legible", label: "Easy to read" },
];

export function ReadingTab() {
  const { fontScale, setFontScale, readingFont, setReadingFont } = useApp();
  return (
    <div className="space-y-10">
      <section>
        <h2 className="mb-3 text-sm font-semibold">{t("Reading font")}</h2>
        <Segmented
          label={t("Reading font")}
          value={readingFont}
          options={fonts.map((x) => ({ ...x, label: t(x.label) }))}
          onChange={setReadingFont}
        />
        <p className="mt-2 max-w-xl text-sm text-muted">
          {t("Atkinson Hyperlegible Next was designed so that letters are easy to tell apart. It replaces the font everywhere, the Bible text included.")}
        </p>
      </section>
      <section>
        <h2 className="mb-3 text-sm font-semibold">{t("Text size")}</h2>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min={0.8}
            max={1.6}
            step={0.05}
            value={fontScale}
            onChange={(e) => setFontScale(Number(e.target.value))}
            className="w-72 accent-[var(--accent)]"
          />
          <span className="w-12 text-sm text-muted">{Math.round(fontScale * 100)} %</span>
        </div>
        <p className="reader mt-4 max-w-xl text-fg">{t("In the beginning God created the heavens and the earth.")}</p>
      </section>
    </div>
  );
}
