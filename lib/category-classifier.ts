import { chat } from './together';

export interface CategoryOption {
  slug: string;
  name: string;
  description: string | null;
}

/**
 * Pick the best matching category for a free-text training topic.
 * Returns the slug of the chosen category, or null if no category is a sensible fit.
 */
export async function classifyCategory(
  topic: string,
  categories: CategoryOption[],
): Promise<string | null> {
  if (categories.length === 0) return null;
  if (categories.length === 1) return categories[0].slug;

  const list = categories
    .map((c) => `- ${c.slug}: ${c.name}${c.description ? ' — ' + c.description : ''}`)
    .join('\n');

  const text = await chat({
    messages: [
      {
        role: 'system',
        content: `Pick the single best matching training category for the topic the user gives.
Reply with ONE JSON object and nothing else:
  {"category": "<slug>"}     when one of the categories clearly fits
  {"category": null}         when none of the categories fits the topic at all

Available categories:
${list}

Be generous — if the topic plausibly belongs to a category (even loosely), pick it. Only return null if the topic is clearly off-topic for every category listed.`,
      },
      { role: 'user', content: `Topic: ${topic}` },
    ],
    maxTokens: 100,
    temperature: 0,
    json: true,
  });

  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const obj = JSON.parse(text.slice(start, end + 1));
    const slug = obj?.category;
    if (typeof slug !== 'string') return null;
    if (categories.some((c) => c.slug === slug)) return slug;
    return null;
  } catch {
    return null;
  }
}
