import { type NextRequest, type NextResponse } from "next/server";

export const EMBED_PATHS = ["/inbox", "/sso", "/login"] as const;

export const EMBED_FRAME_ANCESTORS =
  "'self' https://dashboard.recoveragent.ai http://localhost:5173";

export function isEmbedPath(pathname: string): boolean {
  return EMBED_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

/** Recover Agent nests `embed=1` inside the SSO `redirect` param. */
export function redirectParamRequestsEmbed(
  redirectParam: string | null | undefined,
): boolean {
  if (!redirectParam) return false;
  return /(?:^|[?&])embed(?:=|%3D)1(?:&|$)/i.test(redirectParam);
}

export function shouldAllowIframeEmbed(request: NextRequest): boolean {
  const { pathname, searchParams } = request.nextUrl;
  if (!isEmbedPath(pathname)) return false;
  if (searchParams.get("embed") === "1") return true;
  if (pathname === "/sso" || pathname.startsWith("/sso/")) {
    if (redirectParamRequestsEmbed(searchParams.get("redirect"))) return true;
    // Dashboard SSO URLs often leave `&embed=1` unencoded inside `redirect`,
    // so the parser splits it into a separate query key (`embed%3D1`).
    if (searchParams.has("embed%3D1")) return true;
    const redirect = searchParams.get("redirect") ?? "";
    if (redirect.startsWith("/inbox")) return true;
  }
  return false;
}

export function applyEmbedFrameHeaders(response: NextResponse): void {
  response.headers.delete("X-Frame-Options");
  response.headers.set(
    "Content-Security-Policy",
    `frame-ancestors ${EMBED_FRAME_ANCESTORS}`,
  );
}

export function applyDefaultFrameHeaders(response: NextResponse): void {
  response.headers.set("X-Frame-Options", "DENY");
}

export function finalizeFrameHeaders(
  request: NextRequest,
  response: NextResponse,
): NextResponse {
  if (shouldAllowIframeEmbed(request)) {
    applyEmbedFrameHeaders(response);
  } else {
    applyDefaultFrameHeaders(response);
  }
  return response;
}
