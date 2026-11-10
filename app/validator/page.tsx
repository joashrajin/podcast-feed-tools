import { redirect } from "next/navigation";

export default async function ValidatorRedirect({
  searchParams,
}: {
  searchParams: Promise<{ url?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.url) ? params.url[0] : params.url;
  redirect(raw ? `/tools?url=${encodeURIComponent(raw)}` : "/tools");
}
