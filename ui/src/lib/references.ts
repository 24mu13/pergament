import type { CatalogEntry } from "@/lib/api";
import { t } from "@/lib/i18n";
import { sizeMb } from "@/lib/player";

const SHOWN = 10;

export const totalSize = (entries: CatalogEntry[]) => entries.reduce((n, e) => n + e.item.size, 0);

export function confirmText(entries: CatalogEntry[]): string {
  const lines = entries
    .slice(0, SHOWN)
    .map((e) => `• ${e.item.issue_title || e.item.title} (${sizeMb(e.item.size)})`);
  const rest = entries.length - SHOWN;
  if (rest > 0) lines.push(t("… and {count} more", { count: rest }));
  return [
    t("{count} publications, {size} in total:", { count: entries.length, size: sizeMb(totalSize(entries)) }),
    "",
    ...lines,
  ].join("\n");
}
