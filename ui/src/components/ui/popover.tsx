import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

/** A box next to its trigger, kept inside the window. */
export const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> & { container?: HTMLElement | null }
>(({ className, container, align = "center", sideOffset = 4, ...props }, ref) => (
  // `container` keeps it inside an element shown full screen, which hides everything outside it.
  <PopoverPrimitive.Portal container={container}>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      collisionPadding={8}
      className={cn("z-50 rounded-md border border-line bg-surface p-4 text-sm text-fg shadow-md focus-visible:outline-none", className)}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = "PopoverContent";
