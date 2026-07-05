"use client";

import { useEffect, useRef, useState } from "react";

function isProxiedMediaUrl(url: string): boolean {
  return url.startsWith("/api/whatsapp/media/");
}

/**
 * Resolve a message media_url for display or download.
 * Public Supabase URLs pass through; WhatsApp proxy paths are fetched
 * with the user's session and turned into a blob URL.
 */
export function useProxiedMediaUrl(url: string | null | undefined) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const [error, setError] = useState(false);
  const blobRef = useRef<string | null>(null);

  useEffect(() => {
    if (!url) {
      setSrc(null);
      setLoading(false);
      setError(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(false);

    const load = async () => {
      if (!isProxiedMediaUrl(url)) {
        if (!cancelled) {
          setSrc(url);
          setLoading(false);
        }
        return;
      }

      try {
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) throw new Error(`Media fetch failed: ${res.status}`);
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(blobUrl);
          return;
        }
        if (blobRef.current) URL.revokeObjectURL(blobRef.current);
        blobRef.current = blobUrl;
        setSrc(blobUrl);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    return () => {
      if (blobRef.current) {
        URL.revokeObjectURL(blobRef.current);
        blobRef.current = null;
      }
    };
  }, []);

  return { src, loading, error, isProxied: Boolean(url && isProxiedMediaUrl(url)) };
}

/** Open a proxied or public media URL in a new tab. */
export async function openMediaUrl(url: string, filename?: string) {
  if (!isProxiedMediaUrl(url)) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Media fetch failed: ${res.status}`);
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  if (filename) anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}
