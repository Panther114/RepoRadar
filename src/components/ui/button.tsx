import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const button = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "border border-[#238636] bg-[#238636] text-white hover:bg-[#2ea043]",
        outline: "border border-border bg-card hover:bg-[#21262d]",
        ghost: "text-muted-foreground hover:bg-[#21262d] hover:text-foreground",
        accent: "border border-[#1f6feb] bg-[#1f6feb] text-white hover:bg-primary",
      },
      size: {
        default: "h-9 px-3 py-2",
        sm: "h-7 px-2.5 text-xs",
        lg: "h-10 px-4 text-sm",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(button({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = "Button";
