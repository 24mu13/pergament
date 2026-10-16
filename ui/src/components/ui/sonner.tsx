import { Toaster as Sonner } from "sonner";
import { t } from "@/lib/i18n";

/** The toasts of the app, bottom center, in the app's colors rather than sonner's own. */
export function Toaster() {
  return (
    <Sonner
      position="bottom-center"
      closeButton
      containerAriaLabel={t("Notifications")}
      toastOptions={{
        unstyled: true,
        closeButtonAriaLabel: t("Dismiss"),
        classNames: {
          toast:
            "pointer-events-auto flex w-full max-w-xl items-center gap-3 rounded-md border border-line bg-surface px-4 py-2.5 text-sm text-fg shadow-sm",
          content: "flex-1",
          actionButton: "font-semibold text-accent hover:underline",
          // Sonner puts the close button first; it belongs at the end, as before.
          closeButton: "order-last text-muted hover:text-fg [&_svg]:size-3.5",
        },
      }}
    />
  );
}
