import * as React from "react";
import { cn } from "@/lib/cn";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-16 w-full rounded-[7px] border border-input bg-background px-3 py-2 text-[14px] text-foreground shadow-[inset_0_1px_1px_var(--shadow-color)] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground focus-visible:border-ring focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--ring)_28%,transparent)] disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
