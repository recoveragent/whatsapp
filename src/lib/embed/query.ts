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
