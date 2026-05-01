import Anthropic from '@anthropic-ai/sdk';

let _client: Anthropic | null = null;
export function claude(): Anthropic {
  if (!_client) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY not set');
    _client = new Anthropic({ apiKey: key });
  }
  return _client;
}

export const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
