import { useCallback, useEffect, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { useApp } from "@/app";
import { NetworkBadge } from "@/components/network-badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { api, type CacheUsage } from "@/lib/api";
import { formatSize, rows } from "@/lib/cache";
import { t } from "@/lib/i18n";

function CacheSection() {
  const { toast, downloads } = useApp();
  const [usage, setUsage] = useState<CacheUsage | null>(null);
  const [failed, setFailed] = useState(false);
  const refresh = useCallback(
    () =>
      api.cacheUsage().then(
        (u) => {
          setUsage(u);
          setFailed(false);
        },
        () => {
          setUsage(null);
          setFailed(true);
        },
      ),
    [],
  );
  // Clearing removes the partial files of running downloads, so wait for them.
  const downloading = Object.keys(downloads).length > 0;
  useEffect(() => void refresh(), [refresh]);
  const clear = async () => {
    const ok = await ask(
      t(
        "Removes the catalog, cover images and unfinished downloads. Downloaded publications and your notes stay. The catalog (about 58 MB) is downloaded again when you next need it.",
      ),
      { title: t("Clear cache?"), kind: "warning", okLabel: t("Clear cache") },
    );
    if (!ok) return;
    try {
      await api.clearCache();
      toast(t("Cache cleared"));
    } catch (e) {
      toast(t("Could not clear the cache: {error}", { error: String(e) }));
    }
    await refresh();
  };
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">{t("Cache")}</h2>
      {usage && (
        <dl className="mb-3 max-w-xs space-y-1 text-sm">
          {rows(usage).map((r) => (
            <div key={r.key} className="flex justify-between gap-4">
              <dt className="text-muted">{r.label}</dt>
              <dd>{formatSize(r.bytes)}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-4 border-t border-line pt-1 font-medium">
            <dt>{t("Total")}</dt>
            <dd>{formatSize(usage.total)}</dd>
          </div>
        </dl>
      )}
      <Button variant="outline" onClick={() => void clear()} disabled={!usage || usage.total === 0 || downloading}>
        {t("Clear cache")}
      </Button>
      {failed && <p className="mt-2 text-sm text-muted">{t("Cannot measure the cache")}</p>}
      {downloading && <p className="mt-2 text-sm text-muted">{t("Wait for the running downloads to finish.")}</p>}
      <p className="mt-2 max-w-xl text-sm text-muted">
        {t("Cached files are downloaded again when you need them.")}
        <NetworkBadge />
      </p>
    </section>
  );
}

export function DataTab() {
  const { createBackup, restoreBackup, mergeBackups, setMergeBackups, display, updates } = useApp();
  return (
    <div className="space-y-10">
      <section>
        <h2 className="mb-3 text-sm font-semibold">{t("Updates")}</h2>
        <label className="flex cursor-pointer items-start gap-3">
          <Switch checked={updates.enabled} onCheckedChange={updates.setEnabled} className="mt-0.5" />
          <span>{t("Check for publication updates at startup")}</span>
        </label>
        <p className="mt-2 max-w-xl text-sm text-muted">
          {t(
            "Compares your downloaded publications with the catalog, which is refreshed at most once a day, and only if you have loaded the catalog before. Nothing is downloaded until you update.",
          )}
          <NetworkBadge />
        </p>
      </section>
      <section>
        <h2 className="mb-3 text-sm font-semibold">{t("Second display")}</h2>
        <label className="flex cursor-pointer items-start gap-3">
          <Switch checked={display.enabled} onCheckedChange={(on) => void display.setEnabled(on)} className="mt-0.5" />
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
          <Button onClick={() => void createBackup()}>{t("Create backup")}</Button>
          <Button variant="outline" onClick={() => void restoreBackup()}>
            {mergeBackups ? t("Merge backup…") : t("Restore backup…")}
          </Button>
        </div>
        <label className="mt-3 flex cursor-pointer items-start gap-3">
          <Switch checked={mergeBackups} onCheckedChange={setMergeBackups} className="mt-0.5" />
          <span>{t("Merge backups instead of replacing")}</span>
        </label>
        <p className="mt-2 max-w-xl text-sm text-muted">
          {t(
            "Highlights, notes, tags and bookmarks as a .jwlibrary file. Restoring replaces the current data; with merging turned on, backups are merged into it instead and the newer version of everything in both is kept. Either way the previous data is kept as userData.db.before-restore in the library folder.",
          )}
        </p>
      </section>
      <CacheSection />
    </div>
  );
}
