import { ResultsShell } from "@/components/ResultsShell";

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ searchId: string }>;
}) {
  const { searchId } = await params;
  return <ResultsShell searchId={searchId} />;
}
