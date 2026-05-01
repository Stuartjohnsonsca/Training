import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthed } from '@/lib/auth';
import { chat } from '@/lib/together';

export const maxDuration = 30;

const Body = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1),
      }),
    )
    .min(1)
    .max(20),
});

interface RefineResult {
  reply?: string;
  ready?: boolean;
  topic?: string;
}

export async function POST(req: Request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { messages } = parsed.data;

  // Hard cap turns: after 4 user messages, force a final topic so we don't loop.
  const userTurns = messages.filter((m) => m.role === 'user').length;
  const mustFinalise = userTurns >= 4;

  const system = `You help an Acumon staff member refine the training topic they want to learn before a lesson is generated for them.

Behaviour:
- The first user message tells you what they're interested in.
- If it's already specific enough to generate a useful lesson (a clear topic plus, where helpful, a method/standard/scope), reply with the JSON shape (READY) below.
- Otherwise ask ONE short clarifying question. Pick the question that would most change the lesson — typical examples: their level (new vs refresher), the specific method or standard (e.g. straight-line vs reducing balance, FRS 102 vs IFRS), or the use-case context.
- Never ask more than one thing at a time. Never ask more than 2 follow-ups in total.
${mustFinalise ? '- IMPORTANT: this is the 4th user message — you MUST finalise now (READY shape) using whatever has been said.' : ''}

Reply with ONE JSON object and nothing else. Two valid shapes:

  ASK shape — when you want to ask a clarifying question:
    {"reply": "<your one-sentence question>"}

  READY shape — when there is enough to generate a lesson:
    {"ready": true, "topic": "<the precise topic to generate, ~5-15 words, incorporating the clarifications>"}

Examples of READY topics: "Straight-line depreciation under FRS 102 for a new bookkeeper", "Sample-size selection for substantive testing of trade receivables under ISA 530".`;

  const text = await chat({
    messages: [
      { role: 'system', content: system },
      ...messages,
    ],
    maxTokens: 400,
    temperature: 0.4,
    json: true,
  });

  const result = parseRefineJson(text);
  if (mustFinalise && !result.ready) {
    // Safety net: extract a topic from the conversation if the model didn't comply.
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    return NextResponse.json({ ready: true, topic: lastUser });
  }
  return NextResponse.json(result);
}

function parseRefineJson(text: string): RefineResult {
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const obj = JSON.parse(text.slice(start, end + 1));
    if (obj.ready === true && typeof obj.topic === 'string' && obj.topic.trim()) {
      return { ready: true, topic: obj.topic.trim() };
    }
    if (typeof obj.reply === 'string' && obj.reply.trim()) {
      return { reply: obj.reply.trim() };
    }
  } catch {}
  return { reply: 'Could you tell me a bit more about what you want to learn?' };
}
