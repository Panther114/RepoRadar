"use client";

import { Providers } from "@/app/providers";
import { ResultsView } from "@/components/ResultsView";

export function ResultsShell({ searchId }: { searchId: string }) {
  return (
    <Providers>
      <ResultsView searchId={searchId} />
    </Providers>
  );
}
