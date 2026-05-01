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

  // Hard cap turns: after 6 user messages, force a final topic so we don't loop.
  const userTurns = messages.filter((m) => m.role === 'user').length;
  const mustFinalise = userTurns >= 6;

  const system = `You help an Acumon staff member refine the training topic they want to learn before a substantive lesson is generated for them.

Behaviour:
- The first user message tells you what they want.
- For BROAD topics (e.g. "leases", "depreciation", "audit risk", "revenue recognition"), do NOT just ask one clarifying question. Instead, propose the main sub-areas the lesson could cover, and ask which the user wants. Format the proposal as a short paragraph followed by a clean bulleted list of sub-areas. End by asking either "shall I cover all of these?" or "which of these should I focus on?". Examples of sub-areas to suggest:
    leases → classification (finance vs operating under FRS 102), initial recognition, subsequent measurement, lease modifications, contingent rentals, sublease accounting, presentation & disclosure
    depreciation → straight-line vs reducing balance vs units of production, useful life and residual value review, component depreciation, change of method, impairment interaction, disposal accounting
    audit risk → ISA 315 risk identification, fraud risk (ISA 240), risk of material misstatement, response (ISA 330), use of analytics, group audit risk
- For NARROW topics that already specify what is wanted (e.g. "annual depreciation calculation under reducing balance with a 25% rate"), skip the sub-area menu and reply READY straight away.
- For VAGUE one-word inputs that aren't a recognisable topic, ask one clarifying question instead.
- Never ask more than 3 follow-ups in total. Once the user has chosen sub-areas, reply READY.
${mustFinalise ? '- IMPORTANT: this is the 6th user message — you MUST finalise now (READY shape) using whatever has been said.' : ''}

Reply with ONE JSON object and nothing else. Two valid shapes:

  ASK shape:
    {"reply": "<your message — may include line breaks and a bulleted list using \\n- markers>"}

  READY shape:
    {"ready": true, "topic": "<precise topic, ~10-30 words, incorporating EVERY sub-area the user asked for. Be explicit, e.g. 'Lease accounting under FRS 102: classification (finance vs operating), initial recognition, subsequent measurement, lease modifications, contingent rentals, and disclosure.'>"}

The READY topic is what will be sent to the lesson generator — its specificity directly drives lesson depth, so encode the user's sub-area choices in it.`;

  const text = await chat({
    messages: [
      { role: 'system', content: system },
      ...messages,
    ],
    maxTokens: 2000,
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
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    console.error('[refine] no JSON object in response:', text.slice(0, 500));
    return { reply: 'Sorry — I had trouble understanding that. Could you rephrase your topic?' };
  }
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    if (obj.ready === true && typeof obj.topic === 'string' && obj.topic.trim()) {
      return { ready: true, topic: obj.topic.trim() };
    }
    if (typeof obj.reply === 'string' && obj.reply.trim()) {
      return { reply: obj.reply.trim() };
    }
    console.error('[refine] JSON object had unexpected shape:', JSON.stringify(obj).slice(0, 500));
  } catch (e) {
    console.error('[refine] JSON parse failed (probably truncated). Output ended:', text.slice(-200));
  }
  return { reply: 'Sorry — I had trouble understanding that. Could you rephrase your topic?' };
}
