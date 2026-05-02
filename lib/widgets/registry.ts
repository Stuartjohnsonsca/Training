/**
 * Widget registry — single source of truth for which interactive widgets exist
 * and how each one is described, configured, and graded.
 *
 * Adding a new widget:
 *   1. Add an entry here.
 *   2. Add a React component to components/widgets/ that accepts {config, value, onChange}.
 *   3. Add the React component to the dispatch map in components/widgets/index.tsx.
 *   4. Add a deterministic grader below in `gradeWidget()` (or fall through to LLM grading).
 *   5. Add the slug to a category's allowedWidgets via /admin.
 */

export type WidgetType =
  | 'mcq'
  | 'multi-mcq'
  | 'numeric'
  | 'short-text'
  | 't-account';

export interface WidgetDef {
  slug: WidgetType;
  label: string;
  /** Description shown to the LLM so it knows when this widget is appropriate. */
  llmDescription: string;
  /** Shape the LLM should produce for `config` and `expectedAnswer`. */
  llmConfigShape: string;
}

export const WIDGETS: WidgetDef[] = [
  {
    slug: 'mcq',
    label: 'Multiple choice',
    llmDescription: 'A single-answer multiple choice question. Use when there is one clearly correct option.',
    llmConfigShape: 'config: {options: string[]}, expectedAnswer: number  // index of correct option',
  },
  {
    slug: 'multi-mcq',
    label: 'Multi-select multiple choice',
    llmDescription: 'A multiple-answer question — "select all that apply". Use when several listed options are correct (e.g. "which of these are allowable expenses for a residential rental business?"). Partial credit for getting some right.',
    llmConfigShape: 'config: {options: string[]}, expectedAnswer: number[]  // indices of ALL correct options',
  },
  {
    slug: 'numeric',
    label: 'Numeric input',
    llmDescription: 'Free numeric input — currency, percentage, or count. Use for calculation questions. The learner must enter the EXACT answer — only £0.01 of rounding tolerance is allowed.',
    llmConfigShape: 'config: {unit?: "£"|"%"|""|"days"}, expectedAnswer: number  // expectedAnswer MUST be the exact mathematically-correct value to 2 decimal places. Do NOT round to "about 18,000" — give 18,800.00. Do NOT include a tolerance field.',
  },
  {
    slug: 'short-text',
    label: 'Short written answer',
    llmDescription: 'A 1-3 sentence written answer. The LLM grades these against expectedAnswer.',
    llmConfigShape: 'config: {placeholder?: string}, expectedAnswer: string  // model answer for LLM grading',
  },
  {
    slug: 't-account',
    label: 'T-account',
    llmDescription: 'Two T-accounts (or more) where the learner records the debit and credit entries for a transaction. Use for double-entry bookkeeping questions.',
    llmConfigShape: 'config: {accounts: string[]}, expectedAnswer: {[accountName]: {debits: [{narrative, amount}], credits: [{narrative, amount}]}}',
  },
];

export function widgetsForLLM(allowed: string[]): string {
  const list = WIDGETS.filter((w) => allowed.includes(w.slug));
  if (list.length === 0) return '(no widgets — use mcq fallback)';
  return list
    .map((w) => `- "${w.slug}" (${w.label}): ${w.llmDescription}\n  ${w.llmConfigShape}`)
    .join('\n');
}

/* -------------------- Deterministic grading -------------------- */

export interface GradeResult {
  correct: boolean;
  score: number; // 0..1
  feedback: string;
  needsLLMGrading?: boolean;
}

interface TAccountAnswer {
  [account: string]: {
    debits: { narrative: string; amount: number }[];
    credits: { narrative: string; amount: number }[];
  };
}

export function gradeWidget(
  widget: WidgetType,
  config: any,
  expected: any,
  given: any,
): GradeResult {
  switch (widget) {
    case 'mcq': {
      const correct = Number(given) === Number(expected);
      return {
        correct,
        score: correct ? 1 : 0,
        feedback: correct ? 'Correct.' : `Not quite — the correct answer was option ${Number(expected) + 1}.`,
      };
    }
    case 'multi-mcq': {
      const expectedSet = new Set((Array.isArray(expected) ? expected : []).map(Number));
      const givenSet = new Set((Array.isArray(given) ? given : []).map(Number));
      if (givenSet.size === 0) {
        return { correct: false, score: 0, feedback: 'Please select at least one option.' };
      }
      // Score = (true positives - false positives) / count of correct, floored at 0.
      let tp = 0;
      let fp = 0;
      for (const g of givenSet) {
        if (expectedSet.has(g)) tp++;
        else fp++;
      }
      const total = expectedSet.size || 1;
      const raw = (tp - fp) / total;
      const score = Math.max(0, Math.min(1, raw));
      const correct = score >= 0.99;
      const expectedLabel = [...expectedSet].sort((a, b) => a - b).map((i) => i + 1).join(', ');
      return {
        correct,
        score,
        feedback: correct
          ? 'Correct — all the right options selected.'
          : `Score ${(score * 100).toFixed(0)}%. Correct options were ${expectedLabel}.`,
      };
    }
    case 'numeric': {
      // Only £0.01 tolerance for rounding/floating-point safety. The LLM is no longer allowed
      // to widen this — calculation questions must be solvable to an exact answer.
      const tol = 0.01;
      const givenN = Number(given);
      const expectedN = Number(expected);
      if (Number.isNaN(givenN)) return { correct: false, score: 0, feedback: 'Please enter a number.' };
      const diff = Math.abs(givenN - expectedN);
      const correct = diff <= tol;
      const fmt = (n: number) => {
        const formatted = n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        if (config?.unit === '£') return '£' + formatted;
        if (config?.unit === '%') return formatted + '%';
        if (config?.unit) return formatted + ' ' + config.unit;
        return formatted;
      };
      return {
        correct,
        score: correct ? 1 : 0,
        feedback: correct ? 'Correct.' : `Not quite — the exact answer was ${fmt(expectedN)}. You answered ${fmt(givenN)}.`,
      };
    }
    case 'short-text': {
      // Defer to LLM grading.
      return { correct: false, score: 0, feedback: '', needsLLMGrading: true };
    }
    case 't-account': {
      return gradeTAccount(expected as TAccountAnswer, given as TAccountAnswer);
    }
  }
}

function gradeTAccount(expected: TAccountAnswer, given: TAccountAnswer): GradeResult {
  if (!given || typeof given !== 'object') {
    return { correct: false, score: 0, feedback: 'No T-account entries provided.' };
  }
  const accounts = Object.keys(expected);
  let totalChecks = 0;
  let passedChecks = 0;
  const issues: string[] = [];
  const fmtGBP = (n: number) => '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  for (const acct of accounts) {
    const exp = expected[acct];
    const got = given[acct] ?? { debits: [], credits: [] };

    const expDebitTotal = sum(exp.debits);
    const expCreditTotal = sum(exp.credits);
    const gotDebitTotal = sum(got.debits ?? []);
    const gotCreditTotal = sum(got.credits ?? []);

    totalChecks += 2;
    if (approx(expDebitTotal, gotDebitTotal)) passedChecks++;
    else issues.push(`${acct}: debits should total ${fmtGBP(expDebitTotal)} (got ${fmtGBP(gotDebitTotal)})`);
    if (approx(expCreditTotal, gotCreditTotal)) passedChecks++;
    else issues.push(`${acct}: credits should total ${fmtGBP(expCreditTotal)} (got ${fmtGBP(gotCreditTotal)})`);
  }

  const score = totalChecks === 0 ? 0 : passedChecks / totalChecks;
  const correct = score === 1;
  return {
    correct,
    score,
    feedback: correct ? 'Correct — debits and credits balance and match.' : issues.join('; '),
  };
}

function sum(rows: { amount: number }[]): number {
  return rows.reduce((a, r) => a + Number(r.amount || 0), 0);
}

function approx(a: number, b: number): boolean {
  return Math.abs(a - b) <= 0.01;
}
