import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthed } from '@/lib/auth';
import { chat, FAST_MODEL } from '@/lib/together';

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
  try {
    return await handle(req);
  } catch (e: any) {
    console.error('[refine] unhandled error', e);
    return NextResponse.json(
      { error: `Refine failed: ${e?.message ?? String(e)}` },
      { status: 500 },
    );
  }
}

async function handle(req: Request): Promise<Response> {
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
- BEFORE replying READY, you MUST identify any "scope-defining splits" in the topic — distinctions where the technical content fundamentally differs and a single course can't sensibly cover both at depth without losing focus. If you spot one or more such splits, ALWAYS ask the user to confirm the scope (don't assume). Common splits include:
    Tax topics:
      - Entity type: individual / sole trader / partnership / limited company / LLP / trust (different tax regimes apply)
      - Tax type: Income Tax vs Corporation Tax vs Capital Gains Tax vs VAT vs Inheritance Tax
      - Property: residential vs commercial vs mixed-use vs Furnished Holiday Let (different rules and reliefs)
      - Jurisdiction: UK / Scotland-specific / international
    Accounting topics:
      - Reporting framework: FRS 102 (small / medium / large) vs FRS 105 (micro) vs IFRS / IAS
      - Entity type: not-for-profit / charity / public sector / pension scheme / financial services
    Audit topics:
      - Framework: ISA (UK) vs ISA International vs Practice Note 15 (charities)
      - Entity type: PIE / listed / private / group audit / component
    Anything else where two different professionals would write fundamentally different lessons.
- ALSO identify standard sub-areas to cover within scope (like classification, recognition, measurement, modification, disclosure for leases).
- Format your message as: 1-2 sentence intro identifying the splits, a bulleted list with each split + its options, then "Could you confirm which of these your scenario involves?".
- For NARROW topics that already specify scope completely (e.g. "annual depreciation calculation under reducing balance with a 25% rate for plant and machinery in a UK private limited company"), skip the menu and reply READY straight away.
- For VAGUE one-word inputs, ask one clarifying question.
- Never ask more than 4 follow-ups in total. Once the user has answered scope splits and sub-areas, reply READY.
${mustFinalise ? '- IMPORTANT: this is the 6th user message — you MUST finalise now (READY shape) using whatever has been said.' : ''}

Reply with ONE JSON object and nothing else. Two valid shapes:

  ASK shape:
    {"reply": "<your message — may include line breaks and a bulleted list using \\n- markers>"}

  READY shape:
    {"ready": true, "topic": "<precise topic, ~15-40 words, incorporating EVERY scope split AND sub-area the user confirmed. Be explicit and exhaustive about what's IN scope, e.g. 'Calculating taxable profit for a UK residential rental business held by an individual landlord (Income Tax / Self Assessment): allowable expenses, finance cost restriction (s.272A ITTOIA), wear and tear, capital allowances, loss treatment, payments on account.'>"}

The READY topic is what will be sent to the lesson generator — its specificity directly drives lesson depth and accuracy, so encode the user's scope and sub-area choices in it.`;

  const text = await chat({
    model: FAST_MODEL,
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
