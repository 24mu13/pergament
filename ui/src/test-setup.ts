import { afterEach } from "vitest";
import { toast } from "sonner";

// Browser APIs that jsdom lacks and the Radix and cmdk components use. Some tests run without a DOM, hence the guard.
if (typeof window !== "undefined") {
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= function () {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= function () {};
}

// Sonner keeps its toasts in a module-wide store, so one test's toasts would otherwise show up in the next.
afterEach(() => {
  toast.dismiss();
});
