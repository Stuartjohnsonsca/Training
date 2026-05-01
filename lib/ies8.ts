import { chat } from './together';

/**
 * IES 8 (IFAC International Education Standard 8 — Revised) competence areas.
 * Used to classify a completed training course for the learner's CPD log.
 *
 * The 14 categories cover both the technical competence learning outcomes (1-8) and the
 * professional skills + values, ethics, and attitudes outcomes (9-14).
 */
export const IES8_CATEGORIES: Array<{ number: number; label: string }> = [
  { number: 1, label: 'Audit' },
  { number: 2, label: 'Financial accounting and reporting' },
  { number: 3, label: 'Governance and risk management' },
  { number: 4, label: 'Business environment' },
  { number: 5, label: 'Taxation' },
  { number: 6, label: 'Information technology' },
  { number: 7, label: 'Business laws and regulations' },
  { number: 8, label: 'Finance and financial management' },
  { number: 9, label: 'Intellectual skills' },
  { number: 10, label: 'Interpersonal and communication skills' },
  { number: 11, label: 'Personal skills' },
  { number: 12, label: 'Organisational skills' },
  { number: 13, label: 'Ethical principles' },
  { number: 14, label: 'Commitment to public interest' },
];

export interface CpdClassification {
  ies8Number: number;
  ies8Label: string;
  isEthics: boolean;
  cpdSummary: string;
}

/**
 * Classify a completed training course for CPD logging.
 *  - Picks the best-fit IES 8 category
 *  - Flags whether the course is Ethics-related (category 13 OR the topic substantially involves ethics)
 *  - Generates a 1-2 sentence summary describing what the course covered
 */
export async function classifyForCpd(opts: {
  topic: string;
  title: string;
  objectives: string[];
}): Promise<CpdClassification> {
  const list = IES8_CATEGORIES.map((c) => `  ${c.number}. ${c.label}`).join('\n');
  const objectives = opts.objectives.length
    ? opts.objectives.map((o, i) => `  ${i + 1}. ${o}`).join('\n')
    : '(none provided)';

  const text = await chat({
    messages: [
      {
        role: 'system',
        content: `Classify a completed CPD course for an Acumon professional. Reply with ONE JSON object:

{
  "ies8Number": number,    // 1-14 — the best-fit IES 8 competence area below
  "ies8Label":  string,    // the matching label EXACTLY as written below
  "isEthics":   boolean,   // true if Ethical principles (13) is the chosen category, OR the topic substantively involves professional ethics, independence, integrity, conflicts of interest, money-laundering / financial-crime ethics, or similar
  "cpdSummary": string     // 1-2 plain-English sentences describing what was covered, suitable for a CPD log
}

IES 8 categories:
${list}

Rules:
- ies8Label must EXACTLY match one of the labels above (case and wording).
- ies8Number must match its corresponding label.
- Always provide a cpdSummary even if classification is uncertain.`,
      },
      {
        role: 'user',
        content: `Course title: ${opts.title}\nUser-requested topic: ${opts.topic}\nLearning objectives:\n${objectives}`,
      },
    ],
    maxTokens: 600,
    temperature: 0.2,
    json: true,
  });

  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const obj = JSON.parse(text.slice(start, end + 1));
    const number = Number(obj.ies8Number);
    const valid = IES8_CATEGORIES.find((c) => c.number === number);
    if (valid) {
      return {
        ies8Number: number,
        ies8Label: valid.label,
        isEthics: Boolean(obj.isEthics) || number === 13,
        cpdSummary: typeof obj.cpdSummary === 'string' ? obj.cpdSummary.trim() : `Completed: ${opts.title}.`,
      };
    }
  } catch {
    /* fall through */
  }
  // Defensive default — unclassified.
  return {
    ies8Number: 2,
    ies8Label: 'Financial accounting and reporting',
    isEthics: false,
    cpdSummary: `Completed: ${opts.title}.`,
  };
}
