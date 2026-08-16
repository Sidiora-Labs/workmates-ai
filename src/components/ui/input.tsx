import * as React from "react";
import { cn } from "@/lib/cn";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-[7px] border border-input bg-background px-3 text-[14px] text-foreground shadow-[inset_0_1px_1px_var(--shadow-color)] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground focus-visible:border-ring focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--ring)_28%,transparent)] disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
