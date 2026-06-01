import { RepoDetailView } from "@/components/RepoDetailView";

export default async function RepoDetailPage({
  params,
}: {
  params: Promise<{ owner: string; name: string }>;
}) {
  const { owner, name } = await params;
  return <RepoDetailView owner={owner} name={name} />;
}
