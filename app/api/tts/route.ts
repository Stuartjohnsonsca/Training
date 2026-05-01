import { NextResponse } from 'next/server';
import { isAuthed } from '@/lib/auth';
import { synthesize } from '@/lib/elevenlabs';

export const maxDuration = 60;

export async function POST(req: Request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { text, voiceId } = await req.json();
  if (typeof text !== 'string' || text.length === 0) {
    return NextResponse.json({ error: 'text required' }, { status: 400 });
  }
  if (text.length > 4000) {
    return NextResponse.json({ error: 'text too long (4000 char limit)' }, { status: 400 });
  }

  try {
    const mp3 = await synthesize(text, voiceId);
    return new Response(mp3, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'TTS failed' }, { status: 500 });
  }
}
