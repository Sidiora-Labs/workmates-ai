import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[7px] text-[13px] font-medium outline-none transition-[background-color,color,transform,opacity,box-shadow] duration-150 ease-out select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-brand-ink text-brand-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_1.5px_var(--shadow-color)] hover:brightness-95",
        brand: "bg-brand-ink text-brand-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_1.5px_var(--shadow-color)] hover:brightness-95",
        secondary: "bg-secondary text-secondary-foreground hover:bg-accent",
        outline: "border border-input bg-background text-foreground shadow-[0_1px_1.5px_var(--shadow-color)] hover:bg-accent/60",
        ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
        destructive: "bg-destructive/10 text-destructive hover:bg-destructive/15",
      },
      size: {
        default: "h-8 px-3",
        sm: "h-7 rounded-[6px] px-2.5 text-[12.5px]",
        lg: "h-10 rounded-[10px] px-4 text-[14px]",
        icon: "size-8 rounded-[7px]",
        "icon-sm": "size-7 rounded-[6px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  type,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      type={asChild ? type : (type ?? "button")}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
