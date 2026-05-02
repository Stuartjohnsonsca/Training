/**
 * Output language for lesson generation. The TOPIC's jurisdiction (UK / US / FR etc.) is independent
 * of the language the lesson is delivered in.
 *
 * ElevenLabs' multilingual model (eleven_turbo_v2_5) handles all of these with a single voice.
 *
 * The list is split into "common" (shown at the top of the picker) and "other" (alphabetically below),
 * via an <optgroup> in the UI.
 */

export interface Language {
  code: string;
  label: string;
}

export const COMMON_LANGUAGES: Language[] = [
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

export const OTHER_LANGUAGES: Language[] = [
  { code: 'Bengali', label: 'বাংলা' },
  { code: 'Bulgarian', label: 'Български' },
  { code: 'Catalan', label: 'Català' },
  { code: 'Croatian', label: 'Hrvatski' },
  { code: 'Czech', label: 'Čeština' },
  { code: 'Danish', label: 'Dansk' },
  { code: 'Estonian', label: 'Eesti' },
  { code: 'Filipino', label: 'Filipino' },
  { code: 'Finnish', label: 'Suomi' },
  { code: 'Greek', label: 'Ελληνικά' },
  { code: 'Hebrew', label: 'עברית' },
  { code: 'Hungarian', label: 'Magyar' },
  { code: 'Icelandic', label: 'Íslenska' },
  { code: 'Indonesian', label: 'Bahasa Indonesia' },
  { code: 'Irish', label: 'Gaeilge' },
  { code: 'Latvian', label: 'Latviešu' },
  { code: 'Lithuanian', label: 'Lietuvių' },
  { code: 'Malay', label: 'Bahasa Melayu' },
  { code: 'Norwegian', label: 'Norsk' },
  { code: 'Romanian', label: 'Română' },
  { code: 'Russian', label: 'Русский' },
  { code: 'Scottish Gaelic', label: 'Gàidhlig' },
  { code: 'Serbian', label: 'Српски' },
  { code: 'Slovak', label: 'Slovenčina' },
  { code: 'Slovenian', label: 'Slovenščina' },
  { code: 'Swahili', label: 'Kiswahili' },
  { code: 'Swedish', label: 'Svenska' },
  { code: 'Tamil', label: 'தமிழ்' },
  { code: 'Thai', label: 'ไทย' },
  { code: 'Turkish', label: 'Türkçe' },
  { code: 'Ukrainian', label: 'Українська' },
  { code: 'Urdu', label: 'اردو' },
  { code: 'Vietnamese', label: 'Tiếng Việt' },
];

/** Backwards-compatible flat list — used by validators that just need to check membership. */
export const LANGUAGES: Language[] = [...COMMON_LANGUAGES, ...OTHER_LANGUAGES];

export const DEFAULT_LANGUAGE = 'English';

export function isSupportedLanguage(s: unknown): boolean {
  return typeof s === 'string' && LANGUAGES.some((l) => l.code === s);
}
