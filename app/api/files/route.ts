import { NextResponse } from 'next/server';
import { isAuthed } from '@/lib/auth';

export const maxDuration = 30;

/**
 * Auth-gated proxy for private Vercel Blob URLs.
 * The browser hits /api/files?url=<encoded blob URL>; we fetch with BLOB_READ_WRITE_TOKEN and stream back.
 * Stops anyone with a leaked Blob URL from reading firm-internal logos / uploaded reference docs.
 */
export async function GET(req: Request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url).searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'url query param required' }, { status: 400 });
  }

  // SSRF guard — only Vercel Blob URLs.
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    return NextResponse.json({ error: 'Invalid url' }, { status: 400 });
  }
  if (!host.endsWith('.blob.vercel-storage.com')) {
    return NextResponse.json({ error: 'Only Vercel Blob URLs allowed' }, { status: 400 });
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const upstream = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!upstream.ok) {
    return NextResponse.json(
      { error: `Blob fetch failed: ${upstream.status}` },
      { status: upstream.status },
    );
  }

  const contentType = upstream.headers.get('Content-Type') ?? 'application/octet-stream';
  const contentLength = upstream.headers.get('Content-Length');
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Cache-Control': 'private, max-age=300',
  };
  if (contentLength) headers['Content-Length'] = contentLength;

  return new Response(upstream.body, { status: 200, headers });
}
