import type { CacheUsage } from "@/lib/api";
import { t } from "@/lib/i18n";
import { sizeMb } from "@/lib/player";

export const formatSize = (bytes: number) => (bytes === 0 ? "0 MB" : sizeMb(bytes));

export function rows(usage: CacheUsage): { key: "catalog" | "covers" | "partial" | "other"; label: string; bytes: number }[] {
  return [
    { key: "catalog", label: t("Catalog"), bytes: usage.catalog },
    { key: "covers", label: t("Cover images"), bytes: usage.covers },
    { key: "partial", label: t("Unfinished downloads"), bytes: usage.partial },
    { key: "other", label: t("Other"), bytes: usage.other },
  ];
}
