import { useApp } from "@/app";
import { t } from "@/lib/i18n";

export function DataTab() {
  const { createBackup, restoreBackup, display, updates } = useApp();
  return (
    <div className="space-y-10">
      <section>
        <h2 className="mb-3 text-sm font-semibold">{t("Updates")}</h2>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={updates.enabled}
            onChange={(e) => updates.setEnabled(e.target.checked)}
            className="mt-1 h-4 w-4 accent-[var(--accent)]"
          />
          <span>{t("Check for publication updates at startup")}</span>
        </label>
        <p className="mt-2 max-w-xl text-sm text-muted">
          {t(
            "Compares your downloaded publications with the catalog, which is refreshed at most once a day, and only if you have loaded the catalog before. Nothing is downloaded until you update.",
          )}
        </p>
      </section>
      <section>
        <h2 className="mb-3 text-sm font-semibold">{t("Second display")}</h2>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={display.enabled}
            onChange={(e) => void display.setEnabled(e.target.checked)}
            className="mt-1 h-4 w-4 accent-[var(--accent)]"
          />
          <span>{t("Use a second display")}</span>
        </label>
        <p className="mt-2 max-w-xl text-sm text-muted">
          {t(
            "Opens a black window, fullscreen on another monitor if there is one, that shows the year text. Recordings and pictures you open are shown there too, without controls. If the window opens on the wrong screen, move it there and press F to switch to fullscreen.",
          )}
        </p>
      </section>
      <section>
        <h2 className="mb-3 text-sm font-semibold">{t("Backup")}</h2>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void createBackup()}
            className="rounded-md bg-brand px-4 py-2 text-sm text-brand-fg hover:opacity-90 dark:bg-fg dark:text-surface"
          >
            {t("Create backup")}
          </button>
          <button onClick={() => void restoreBackup()} className="rounded-md border border-line bg-surface px-4 py-2 text-sm hover:bg-bar">
            {t("Restore backup…")}
          </button>
        </div>
        <p className="mt-2 text-sm text-muted">
          {t(
            "Highlights, notes, tags and bookmarks as a .jwlibrary file. Restoring replaces the current data; the previous data is kept as userData.db.before-restore in the library folder.",
          )}
        </p>
      </section>
    </div>
  );
}
