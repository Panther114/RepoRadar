import * as React from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border bg-[#21262d] px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
