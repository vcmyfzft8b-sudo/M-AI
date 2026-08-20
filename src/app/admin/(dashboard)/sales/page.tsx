import { redirect } from "next/navigation";

type SearchParams = Promise<{ range?: string }>;

/** The page moved when Sales became Finance; old links and bookmarks follow. */
export default async function SalesRedirect({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const params = await searchParams;

  redirect(
    params?.range
      ? `/admin/finance?range=${encodeURIComponent(params.range)}`
      : "/admin/finance",
  );
}
