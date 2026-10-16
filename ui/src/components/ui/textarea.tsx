import * as React from "react";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-accent",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
