import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";

/** A single-thumb slider; `label` names the thumb for screen readers. */
export const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & { label?: string }
>(({ className, label, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn("relative flex h-5 touch-none select-none items-center data-[disabled]:opacity-40", className)}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-line">
      <SliderPrimitive.Range className="absolute h-full bg-accent" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb
      aria-label={label}
      className="block h-4 w-4 rounded-full border-2 border-accent bg-surface shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    />
  </SliderPrimitive.Root>
));
Slider.displayName = "Slider";
