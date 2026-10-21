import { t } from "@/lib/i18n";
import type { SyncStatus } from "@/lib/types";

/** What the app has told the user about sync so far: the held-back peer files and the last error. */
export interface SyncSeen {
  pending: string[];
  error: string | null;
}

export const nothingSeen: SyncSeen = { pending: [], error: null };

/** The refusal of `set_sync_folder` for the library folder (`SYNC_IN_LIBRARY` in auto.rs). */
const SYNC_IN_LIBRARY = "The library folder and its backups folder cannot be the sync folder.";

/** A sync error from the app, translated where it is one of ours. */
export function syncErrorText(error: string): string {
  return error.includes(SYNC_IN_LIBRARY) ? t("The library folder and its backups folder cannot be the sync folder.") : error;
}

/**
 * The toasts a sync status calls for: one for each peer that newly waits for a choice, one for
 * an error that newly appears. A peer or error that goes away is told about again when it returns.
 */
export function syncNotices(seen: SyncSeen, status: SyncStatus): { notices: string[]; seen: SyncSeen } {
  if (!status.folder) return { notices: [], seen: nothingSeen };
  const notices = status.pending
    .filter((p) => !seen.pending.includes(p.file))
    .map((p) => t("{device} wants to delete {n} items. Open Settings to decide.", { device: p.device, n: p.deletions }));
  if (status.error && status.error !== seen.error) notices.push(t("Sync: {error}", { error: syncErrorText(status.error) }));
  return { notices, seen: { pending: status.pending.map((p) => p.file), error: status.error } };
}
