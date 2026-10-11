import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function NetworkBadge({ className }: { className?: string }) {
  return (
    <span className={cn("ml-2 whitespace-nowrap rounded-full border border-line px-2 py-0.5 align-middle text-xs text-muted", className)}>
      {t("Needs network")}
    </span>
  );
}
