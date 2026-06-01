import { cn } from "@/lib/utils";

export function scoreColor(value: number | null | undefined): string {
  const v = value ?? 0;
  if (v >= 0.75) return "text-accent border-[#2ea043]/50 bg-[#238636]/10";
  if (v >= 0.5) return "text-primary border-[#1f6feb]/50 bg-[#1f6feb]/10";
  if (v >= 0.3) return "text-[#d29922] border-[#d29922]/50 bg-[#d29922]/10";
  return "text-[#f85149] border-[#f85149]/50 bg-[#f85149]/10";
}

export function pct(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${Math.round(value * 100)}`;
}

export function ScoreBadge({
  label,
  value,
  title,
  size = "md",
}: {
  label: string;
  value: number | null;
  title?: string;
  size?: "md" | "lg";
}) {
  return (
    <div
      title={title}
      className={cn(
        "flex items-baseline justify-between gap-1.5 rounded-md border tabular-nums",
        size === "lg" ? "min-w-[72px] px-2 py-1.5" : "min-w-[58px] px-1.5 py-1",
        scoreColor(value),
      )}
    >
      <span
        className={cn(
          "font-semibold leading-none",
          size === "lg" ? "text-lg" : "text-sm",
        )}
      >
        {pct(value)}
      </span>
      <span
        className={cn(
          "opacity-75",
          size === "lg" ? "text-[10px]" : "text-[9px]",
        )}
      >
        {label}
      </span>
    </div>
  );
}
