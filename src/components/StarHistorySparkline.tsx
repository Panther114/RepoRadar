"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { Sparkline } from "@/components/charts/Charts";
import { getStarHistory } from "@/lib/api/client";
import { formatNumber } from "@/lib/format";

/**
 * Compact, real star-history line for a result card. Lazy by design: it only
 * fetches once scrolled into view (IntersectionObserver), which naturally
 * throttles the GitHub stargazer sampling to the handful of cards on screen.
 * react-query caches per repo for the session; the server caches for 6h.
 */
export function StarHistorySparkline({
  owner,
  name,
  stars,
  compact = false,
}: {
  owner: string;
  name: string;
  stars?: number | null;
  compact?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "250px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView]);

  const hasEnoughStars = (stars ?? 0) >= 8;
  const { data, isLoading } = useQuery({
    queryKey: ["star-history", owner, name],
    queryFn: () => getStarHistory(owner, name, stars ?? 0),
    enabled: inView && hasEnoughStars,
    staleTime: 6 * 3_600_000,
    gcTime: 6 * 3_600_000,
    retry: false,
  });

  const values = (data?.history ?? []).map((p) => p.stars);
  const hasCurve = values.length >= 2;

  // Reserve a fixed height so the card never shifts as data streams in (CLS).
  const h = compact ? 22 : 34;
  const sparkH = compact ? 18 : 26;

  return (
    <div
      ref={ref}
      className="flex items-center gap-2 px-3"
      style={{ height: h }}
      title="Star history — sampled from the GitHub stargazer timeline"
    >
      <Star className="h-3 w-3 shrink-0 text-[#d29922]" />
      {!compact && (
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
          stars over time
        </span>
      )}
      <div className="flex flex-1 items-center justify-center">
        {hasCurve ? (
          <Sparkline values={values} width={150} height={sparkH} color="#d29922" />
        ) : (
          <div
            className={`h-px w-full max-w-[150px] rounded bg-border ${
              inView && hasEnoughStars && isLoading ? "shimmer" : ""
            }`}
          />
        )}
      </div>
      <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
        {formatNumber(stars ?? 0)}★
      </span>
    </div>
  );
}
