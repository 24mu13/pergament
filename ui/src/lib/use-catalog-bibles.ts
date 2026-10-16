import { useEffect, useState } from "react";
import { api, type CatalogEntry } from "./api";

/** The catalog category of Bibles (see CATEGORIES in src/catalog.rs). */
export const BIBLE_CATEGORY = 1;

/** The last Bibles read per language code, and the catalog version they came from. */
const loaded = new Map<string, { version: number; entries: CatalogEntry[] }>();
/** Requests under way, `version:code`, so a second hook does not ask again. */
const pending = new Set<string>();
/** The mounted hooks, all told when a list arrives, not only the one that asked for it. */
const listeners = new Set<() => void>();

/**
 * The Bibles the catalog offers in each of `codes`, read again whenever the catalog version changes. A language keeps its
 * last list until the new one arrives, so the menu does not flash empty after a download. Nothing is read while
 * `enabled` is false; a failed read is tried again the next time the inputs change.
 */
export function useCatalogBibles(codes: string[], enabled: boolean, catalogVersion: number): Record<string, CatalogEntry[]> {
  const [, bump] = useState(0);
  const wanted = [...new Set(codes)].filter(Boolean).join(",");
  useEffect(() => {
    const listener = () => bump((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  useEffect(() => {
    if (!enabled) return;
    for (const code of wanted.split(",").filter(Boolean)) {
      const key = `${catalogVersion}:${code}`;
      if (loaded.get(code)?.version === catalogVersion || pending.has(key)) continue;
      pending.add(key);
      api
        .category(code, BIBLE_CATEGORY)
        .then((entries) => {
          const now = loaded.get(code);
          // A slower answer for an older version must not replace a newer one.
          if (!now || now.version <= catalogVersion) loaded.set(code, { version: catalogVersion, entries: entries ?? [] });
          for (const listener of listeners) listener();
        })
        .catch(() => undefined)
        .finally(() => pending.delete(key));
    }
  }, [enabled, wanted, catalogVersion]);
  return Object.fromEntries(
    wanted
      .split(",")
      .filter(Boolean)
      .map((c) => [c, loaded.get(c)?.entries ?? []]),
  );
}

/** Forget what was read; for tests. */
export function resetCatalogBibles() {
  loaded.clear();
  pending.clear();
}
