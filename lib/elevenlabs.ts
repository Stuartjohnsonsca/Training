/**
 * Minimal ElevenLabs text-to-speech client.
 * Returns raw MP3 bytes for the given text, narrated by the configured voice.
 *
 * Voice resolution order:
 *   1. ELEVENLABS_VOICE_ID env var if set (explicit override).
 *   2. First "premade" voice from /v1/voices (works on the free plan).
 *   3. Hardcoded fallback (a known British default voice).
 */

const HARDCODED_FALLBACK_VOICE = 'JBFqnCBsd6RMkjVDRZzb';

let _resolvedVoiceId: string | null = null;

async function resolveVoiceId(apiKey: string): Promise<string> {
  if (process.env.ELEVENLABS_VOICE_ID) return process.env.ELEVENLABS_VOICE_ID;
  if (_resolvedVoiceId) return _resolvedVoiceId;

  try {
    const res = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': apiKey },
    });
    if (res.ok) {
      const data = await res.json();
      const voices: Array<{ voice_id: string; category?: string; name?: string }> = data?.voices ?? [];
      // Premade voices are the default voices available to all plans (including free).
      const premade = voices.find((v) => v.category === 'premade');
      const chosen = premade ?? voices[0];
      if (chosen?.voice_id) {
        _resolvedVoiceId = chosen.voice_id;
        return _resolvedVoiceId;
      }
    }
  } catch {
    /* fall through to hardcoded */
  }
  return HARDCODED_FALLBACK_VOICE;
}

export async function synthesize(text: string, voiceIdOverride?: string): Promise<ArrayBuffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not set');

  const voice = voiceIdOverride || (await resolveVoiceId(apiKey));
  const model = process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5';

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: model,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Narration ${res.status}: ${errText.slice(0, 200)}`);
  }

  return await res.arrayBuffer();
}
