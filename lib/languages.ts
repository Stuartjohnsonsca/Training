/**
 * Output language for lesson generation. The TOPIC's jurisdiction (UK / US / FR etc.) is independent
 * of the language the lesson is delivered in. So you can ask about French tax in English, or about
 * UK tax in French, etc.
 *
 * ElevenLabs' multilingual model (eleven_turbo_v2_5) handles all of these with a single voice.
 */
export const LANGUAGES: Array<{ code: string; label: string }> = [
  { code: 'English', label: 'English' },
  { code: 'French', label: 'Français' },
  { code: 'German', label: 'Deutsch' },
  { code: 'Spanish', label: 'Español' },
  { code: 'Italian', label: 'Italiano' },
  { code: 'Portuguese', label: 'Português' },
  { code: 'Dutch', label: 'Nederlands' },
  { code: 'Polish', label: 'Polski' },
  { code: 'Mandarin Chinese', label: '中文 (普通话)' },
  { code: 'Japanese', label: '日本語' },
  { code: 'Korean', label: '한국어' },
  { code: 'Arabic', label: 'العربية' },
  { code: 'Hindi', label: 'हिन्दी' },
  { code: 'Welsh', label: 'Cymraeg' },
];

export const DEFAULT_LANGUAGE = 'English';

export function isSupportedLanguage(s: unknown): boolean {
  return typeof s === 'string' && LANGUAGES.some((l) => l.code === s);
}
