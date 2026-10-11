import type { Conflict, MergeReport } from "@/lib/api";
import { t } from "@/lib/i18n";

const MAX_CONFLICTS = 10;

/** The toast after a merge: how many items changed, and which device the backup came from. */
export function mergeToast(r: MergeReport): string {
  const n = r.added + r.updated;
  if (n === 0) return t("Nothing new in the backup");
  const text = n === 1 ? t("Merged 1 change") : t("Merged {count} changes", { count: n });
  return text + (r.device ? t(" from {device}", { device: r.device }) : "");
}

/** The conflicts as lines of text, at most ten of them. The guid is an internal key and never shown. */
export function conflictText(c: Conflict[]): string {
  const head = c.length === 1 ? t("1 conflict, your version was kept:") : t("{count} conflicts, your version was kept:", { count: c.length });
  const lines = c.slice(0, MAX_CONFLICTS).map((x) => (x.summary ? `${x.table}: ${x.summary}` : x.table));
  const rest = c.length - MAX_CONFLICTS;
  if (rest > 0) lines.push(t("… and {count} more", { count: rest }));
  return [head, ...lines].join("\n");
}
