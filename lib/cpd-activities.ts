/**
 * CPD activity categories as recognised by UK professional bodies (ICAEW, ACCA, CIOT, PFS, etc.).
 * Used to tag each Attempt for the learner's CPD log.
 *
 * AI-generated training delivered in this app is "E-learning" by default; learners can override
 * if they're using the system in a different capacity (e.g. running a course as Training for others).
 */
export const CPD_ACTIVITIES: string[] = [
  'Conferences, seminars & webinars',
  'E-learning',
  'Examination setting, marking & moderation',
  'Examinations & tests',
  'Formal discussions/meetings',
  'Internal training',
  'Mentoring/coaching/shadowing',
  'New product development',
  'On-the-job training',
  'Pro-bono or voluntary work',
  'Professional institute/PFS regional network or trade body work',
  'Reading & watching',
  'Self-managed learning',
  'Technical authorship',
  'Training courses & workshops',
  'Training for others',
  'Others',
];

/** Default activity category for AI-generated lessons completed in this app. */
export const DEFAULT_ACTIVITY = 'E-learning';
