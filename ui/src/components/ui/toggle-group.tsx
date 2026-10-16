import * as React from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cn } from "@/lib/utils";

/** Buttons side by side of which one is on, in one bordered strip. */
export const ToggleGroup = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Root
    ref={ref}
    className={cn("inline-flex overflow-hidden rounded-md border border-line", className)}
    {...props}
  />
));
ToggleGroup.displayName = "ToggleGroup";

export const ToggleGroupItem = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>
>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Item
    ref={ref}
    className={cn(
      "bg-surface px-4 py-2 text-sm text-muted hover:bg-bar hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent data-[state=on]:bg-bar data-[state=on]:font-medium data-[state=on]:text-fg",
      className,
    )}
    {...props}
  />
));
ToggleGroupItem.displayName = "ToggleGroupItem";
