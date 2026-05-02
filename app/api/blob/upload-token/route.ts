import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { isAuthed, isAdmin } from '@/lib/auth';

export const maxDuration = 30;

const LOGO_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const SOURCE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

const LOGO_MIME = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp', 'image/gif'];
const SOURCE_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/markdown',
  'text/csv',
];

/**
 * Server-issued upload tokens for client-direct uploads to a PRIVATE Vercel Blob store.
 * The browser uses upload() from @vercel/blob/client; that helper POSTs here for a token,
 * then uploads directly to Vercel without the bytes ever passing through our API.
 *
 * clientPayload distinguishes the kind of upload so we can apply the right guards.
 *   "logo"   — admin only, image types only, 2 MB cap
 *   "source" — any authed user, document types only, 10 MB cap
 */
export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        const kind = clientPayload === 'logo' ? 'logo' : 'source';
        if (kind === 'logo') {
          if (!(await isAdmin())) {
            throw new Error('Admin required to upload a logo');
          }
          return {
            allowedContentTypes: LOGO_MIME,
            maximumSizeInBytes: LOGO_MAX_BYTES,
            addRandomSuffix: true,
            tokenPayload: kind,
          };
        }
        if (!(await isAuthed())) {
          throw new Error('Sign-in required to upload a source');
        }
        return {
          allowedContentTypes: SOURCE_MIME,
          maximumSizeInBytes: SOURCE_MAX_BYTES,
          addRandomSuffix: true,
          tokenPayload: kind,
        };
      },
      onUploadCompleted: async () => {
        // No-op: the client receives the blob URL from upload() and POSTs it to the appropriate
        // registration endpoint (/api/sources/register for sources; admin's Save Branding for logos).
      },
    });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json(
      { error: `Upload-token issue: ${e?.message ?? String(e)}` },
      { status: 400 },
    );
  }
}
