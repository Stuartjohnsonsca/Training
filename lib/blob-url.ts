/**
 * Wrap a Vercel Blob URL in our auth-gated proxy /api/files.
 * External URLs (e.g. an admin who pasted a CDN URL into the logo field) are returned unchanged.
 * Null/empty inputs return null.
 */
export function proxyBlobUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    if (host.endsWith('.blob.vercel-storage.com')) {
      return `/api/files?url=${encodeURIComponent(url)}`;
    }
  } catch {
    // Not a parseable URL — return as-is and let the <img> handle the error.
  }
  return url;
}
