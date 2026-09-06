import type { ReadonlyURLSearchParams } from "next/navigation";

export function isEmbedMode(
  searchParams: Pick<URLSearchParams, "get"> | ReadonlyURLSearchParams,
): boolean {
  return searchParams.get("embed") === "1";
}

/** Append or preserve `embed=1` on a same-origin path + query string. */
export function withEmbedQuery(path: string, embed: boolean): string {
  if (!embed) return path;

  const [pathname, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  params.set("embed", "1");
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : `${pathname}?embed=1`;
}

/** Build `/inbox` URL for Recover Agent iframe embed mode. */
export function buildEmbedInboxUrl(options: {
  phone?: string | null;
  conversationId?: string | null;
}): string {
  const params = new URLSearchParams();
  params.set("embed", "1");
  if (options.phone) params.set("phone", options.phone);
  if (options.conversationId) params.set("c", options.conversationId);
  return `/inbox?${params.toString()}`;
}
