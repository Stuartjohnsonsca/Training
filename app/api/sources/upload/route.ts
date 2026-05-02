import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { isAuthed, currentUserEmail } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { extractText } from '@/lib/extract-text';

export const maxDuration = 60;

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB cap per file

export async function POST(req: Request) {
  try {
    if (!(await isAuthed())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File too big (${(file.size / 1024 / 1024).toFixed(1)} MB). Limit is 10 MB.` },
        { status: 413 },
      );
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'File is empty' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const filename = file.name || 'upload';
    const mimeType = file.type || 'application/octet-stream';

    // 1. Extract text first (fail fast if format unsupported)
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

    // 2. Upload original to Vercel Blob
    let blobUrl: string;
    try {
      // Private Blob store — omit `access`. /api/files proxies fetches via BLOB_READ_WRITE_TOKEN for authed users.
      const blob = await put(`sources/${Date.now()}-${filename}`, file, {
        addRandomSuffix: true,
      } as any);
      blobUrl = blob.url;
    } catch (e: any) {
      console.error('[sources/upload] Blob put failed', e);
      return NextResponse.json(
        { error: `Could not store the file: ${e?.message ?? String(e)}` },
        { status: 500 },
      );
    }

    // 3. Persist DB row (lessonId is null until the lesson is created)
    const learner = (await currentUserEmail()) ?? 'unknown';
    const source = await prisma.lessonSource.create({
      data: {
        uploaderEmail: learner,
        filename,
        mimeType,
        fileSizeBytes: file.size,
        blobUrl,
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
    console.error('[sources/upload] unhandled error', e);
    return NextResponse.json(
      { error: `Upload failed: ${e?.message ?? String(e)}` },
      { status: 500 },
    );
  }
}
