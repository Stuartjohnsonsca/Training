import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthed, currentUserEmail } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { extractText } from '@/lib/extract-text';

export const maxDuration = 60;

/**
 * Called by the client after a successful client-direct upload to Vercel Blob.
 * The file already lives in the private Blob store; we fetch it server-side using the token,
 * extract its text, and persist a LessonSource row.
 */
const Body = z.object({
  url: z.string().url(),
  filename: z.string().min(1).max(300),
  mimeType: z.string().max(200),
  fileSizeBytes: z.number().int().nonnegative().max(20 * 1024 * 1024),
});

export async function POST(req: Request) {
  try {
    if (!(await isAuthed())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { url, filename, mimeType, fileSizeBytes } = parsed.data;

    // SSRF guard — only Vercel Blob URLs.
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
    }
    if (!host.endsWith('.blob.vercel-storage.com')) {
      return NextResponse.json({ error: 'URL must be in our Blob store' }, { status: 400 });
    }

    const token = process.env.BLOB_READ_WRITE_TOKEN;
    const fetchRes = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!fetchRes.ok) {
      return NextResponse.json(
        { error: `Could not read uploaded file from Blob: ${fetchRes.status}` },
        { status: 502 },
      );
    }
    const bytes = await fetchRes.arrayBuffer();

    let extracted;
    try {
      extracted = await extractText(filename, mimeType, bytes);
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? 'Could not extract text' }, { status: 422 });
    }
    if (!extracted.text || extracted.text.trim().length < 20) {
      return NextResponse.json(
        { error: `No usable text extracted from "${filename}". Is the document scanned or empty?` },
        { status: 422 },
      );
    }

    const learner = (await currentUserEmail()) ?? 'unknown';
    const source = await prisma.lessonSource.create({
      data: {
        uploaderEmail: learner,
        filename,
        mimeType,
        fileSizeBytes,
        blobUrl: url,
        extractedText: extracted.text,
        approxTokens: extracted.approxTokens,
      },
    });

    return NextResponse.json({
      source: {
        id: source.id,
        filename: source.filename,
        mimeType: source.mimeType,
        fileSizeBytes: source.fileSizeBytes,
        blobUrl: source.blobUrl,
        approxTokens: source.approxTokens,
        truncated: extracted.truncated,
      },
    });
  } catch (e: any) {
    console.error('[sources/register] unhandled error', e);
    return NextResponse.json(
      { error: `Register failed: ${e?.message ?? String(e)}` },
      { status: 500 },
    );
  }
}
