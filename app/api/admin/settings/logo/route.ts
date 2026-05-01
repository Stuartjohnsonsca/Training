import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { isAdmin } from '@/lib/auth';

export const maxDuration = 30;

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB cap — logos should be small
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp', 'image/gif'];

export async function POST(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'File too big (2 MB cap for logos)' }, { status: 413 });
    }
    const mime = file.type || 'application/octet-stream';
    if (!ALLOWED_MIME.includes(mime)) {
      return NextResponse.json({ error: `Unsupported image type: ${mime}` }, { status: 422 });
    }
    const blob = await put(`logos/${Date.now()}-${file.name}`, file, {
      access: 'public',
      addRandomSuffix: true,
      contentType: mime,
    });
    return NextResponse.json({ url: blob.url });
  } catch (e: any) {
    console.error('[settings/logo] upload failed', e);
    return NextResponse.json({ error: `Upload failed: ${e?.message ?? String(e)}` }, { status: 500 });
  }
}
