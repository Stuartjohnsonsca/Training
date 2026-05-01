/**
 * Minimal Together AI client. OpenAI-compatible chat completions API.
 *
 * Default model: meta-llama/Llama-3.3-70B-Instruct-Turbo
 * Override with TOGETHER_MODEL env var.
 */

export const DEFAULT_MODEL = 'meta-llama/Llama-3.3-70B-Instruct-Turbo';
/** Smaller, much faster model for cheap structured tasks (classification, tag extraction). */
export const FAST_MODEL = 'meta-llama/Llama-3.1-8B-Instruct-Turbo';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /** When true, asks the model to return a single JSON object. */
  json?: boolean;
  /** Override model — defaults to TOGETHER_MODEL env var or DEFAULT_MODEL. */
  model?: string;
}

export async function chat(opts: ChatOptions): Promise<string> {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) throw new Error('TOGETHER_API_KEY not set');

  const model = opts.model || process.env.TOGETHER_MODEL || DEFAULT_MODEL;

  const body: Record<string, any> = {
    model,
    messages: opts.messages,
    max_tokens: opts.maxTokens ?? 4000,
    temperature: opts.temperature ?? 0.7,
  };
  if (opts.json) {
    body.response_format = { type: 'json_object' };
  }

  const res = await fetch('https://api.together.xyz/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Together ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const content: string | undefined = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Together returned no content');
  return content;
}
