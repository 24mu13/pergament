import type { OutlineEntry } from "@/lib/api";
import { t } from "@/lib/i18n";

/** Outline range like "1-9" or "7". */
export function outlineRange(o: OutlineEntry): string {
  if (o.end_verse == null || (o.begin_chapter === o.end_chapter && o.begin_verse === o.end_verse)) {
    return `${o.begin_verse}`;
  }
  return o.begin_chapter === o.end_chapter
    ? `${o.begin_verse}-${o.end_verse}`
    : `${o.begin_chapter}:${o.begin_verse}–${o.end_chapter}:${o.end_verse}`;
}

/** The outline of a chapter as the study pane shows it; entries link to their place in the open chapter. */
export function OutlineSection({ title, outline, book }: { title: string | null; outline: OutlineEntry[]; book: number }) {
  if (outline.length === 0) return null;
  return (
    <section className="mb-5">
      <h3 className="mb-2 text-sm font-semibold">{title ?? t("Outline")}</h3>
      {outline.map((o, i) => (
        <div key={i} style={{ paddingLeft: `${Math.max(0, o.level - 2) * 1.3}rem` }}>
          {o.text}{" "}
          <a className="text-xs" href={`#v${book}-${o.begin_chapter}-${o.begin_verse}-1`}>
            ({outlineRange(o)})
          </a>
        </div>
      ))}
    </section>
  );
}
