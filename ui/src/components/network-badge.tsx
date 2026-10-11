import { t } from "@/lib/i18n";

export function NetworkBadge() {
  return <span className="ml-2 rounded-full border border-line px-2 py-0.5 align-middle text-xs text-muted">{t("Needs network")}</span>;
}
