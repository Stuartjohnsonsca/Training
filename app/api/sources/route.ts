import { NextResponse } from 'next/server';
import { isAuthed } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Visible to all authed users.
  const sources = await prisma.lessonSource.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      lessonId: true,
      uploaderEmail: true,
      filename: true,
      mimeType: true,
      fileSizeBytes: true,
      blobUrl: true,
      approxTokens: true,
      createdAt: true,
      lesson: { select: { id: true, title: true, topic: true } },
    },
    take: 200,
  });
  return NextResponse.json({ sources });
}
