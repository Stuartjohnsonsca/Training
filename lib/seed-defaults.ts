import { prisma } from './db';

const ACCOUNTING_PROMPT = `You generate training lessons for UK accounting professionals and trainees.
Use UK terminology (e.g. "debtors" alongside "trade receivables", "creditors" alongside "trade payables", "P&L" or "income statement").
Currency examples in £ unless the topic says otherwise. Apply UK GAAP / FRS 102 conventions unless the topic specifies IFRS.
For practical questions, prefer worked examples that exercise debits and credits, the accounting equation, or specific FRS 102 sections.

CRITICAL: never confuse UK and US rules. No US-isms (no IRS, 401(k), IRA, federal/state tax, depreciation as a TAX deduction, S-corp/C-corp, MACRS, Section 1031). And never conflate accounting profit with taxable profit — for UK tax, depreciation is added back and capital allowances are claimed instead, with significant restrictions on property (no general allowances on residential dwellings; SBA 3% for commercial structures from Oct 2018; FHL gets plant & machinery allowances).
For UK tax content, anchor in the actual statutes (ITTOIA, ITA, CTA, TCGA, VATA, FA), not generic "income tax rules".`;

const AUDIT_PROMPT = `You generate training lessons for UK external auditors (ISA-UK).
Reference the relevant ISA (UK) where helpful (e.g. ISA 315 risk, ISA 330 responses, ISA 500 evidence, ISA 530 sampling, ISA 540 estimates).
Distinguish clearly between risk assessment, response, and reporting. Use UK terminology and £ examples.
For practical questions, prefer scenarios that test the auditor's judgement (sample sizing, control vs substantive choice, materiality, identifying assertions at risk).`;

export const DEFAULT_CATEGORIES = [
  {
    slug: 'accounting',
    name: 'Accounting',
    description: 'Bookkeeping, financial reporting, and UK GAAP / FRS 102.',
    systemPrompt: ACCOUNTING_PROMPT,
    allowedWidgets: ['mcq', 'numeric', 'short-text', 't-account'],
    sortOrder: 10,
  },
  {
    slug: 'audit',
    name: 'Audit',
    description: 'External audit under ISA (UK) — risk, evidence, sampling, reporting.',
    systemPrompt: AUDIT_PROMPT,
    allowedWidgets: ['mcq', 'numeric', 'short-text'],
    sortOrder: 20,
  },
];

/** Idempotent — safe to call any time. Used both by /admin's "Seed defaults" button and by the generate route's auto-bootstrap. */
export async function seedDefaultCategories(): Promise<void> {
  for (const c of DEFAULT_CATEGORIES) {
    await prisma.category.upsert({
      where: { slug: c.slug },
      create: c,
      update: {
        name: c.name,
        description: c.description,
        systemPrompt: c.systemPrompt,
        allowedWidgets: c.allowedWidgets,
        sortOrder: c.sortOrder,
      },
    });
  }
}
