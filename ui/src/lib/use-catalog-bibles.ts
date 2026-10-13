import { useEffect, useState } from "react";
import { api, type CatalogEntry } from "./api";

/** Catalog Bibles per language code, by the catalog version they were read at. */
const loaded = new Map<string, CatalogEntry[]>();

const BIBLE_CATEGORY = 1;

/** The Bibles the catalog offers in each of `codes`, read once per catalog version; empty while `enabled` is false. */
export function useCatalogBibles(codes: string[], enabled: boolean, catalogVersion: number): Record<string, CatalogEntry[]> {
  const [, bump] = useState(0);
  const key = (code: string) => `${catalogVersion}:${code}`;
  const wanted = [...new Set(codes)].join(",");
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    for (const code of wanted.split(",").filter(Boolean)) {
      if (loaded.has(key(code))) continue;
      api
        .category(code, BIBLE_CATEGORY)
        .then((entries) => {
          loaded.set(key(code), entries ?? []);
          if (live) bump((n) => n + 1);
        })
        .catch(() => loaded.set(key(code), []));
    }
    return () => {
      live = false;
    };
    // `key` only depends on the catalog version.
  }, [enabled, wanted, catalogVersion]);
  return Object.fromEntries(wanted.split(",").filter(Boolean).map((c) => [c, loaded.get(key(c)) ?? []]));
}
