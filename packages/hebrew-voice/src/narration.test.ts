import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import type { Storyboard } from '@kampora/shared';
import { buildSpeechCues, wordsFromAlignment, type CharacterAlignment } from './alignment';
import { resolveAmbiguities } from './ambiguity';
import { probeBufferDurationSec } from './ffprobe';
import { planNarration, scriptHash } from './narration-plan';
import { prepareForProvider } from './providers';
import { assessScriptLength, estimateSpeechSec } from './speech-timing';
import {
  ElevenLabsTtsProvider,
  MockTtsProvider,
  resetElevenLabsCapabilityCache,
  TtsProviderError,
} from './tts';
import { parseVoiceList, ttsSetupFromEnv } from './tts-config';

const hasFfprobe = (() => {
  try {
    execFileSync(process.env.FFPROBE_PATH || 'ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const alignmentFor = (text: string, secPerChar = 0.07): CharacterAlignment => {
  const characters = [...text];
  return {
    characters,
    character_start_times_seconds: characters.map((_, i) => i * secPerChar),
    character_end_times_seconds: characters.map((_, i) => (i + 1) * secPerChar),
  };
};

describe('ambiguous Hebrew words', () => {
  it('flags ambiguous words without changing text by default', () => {
    const r = resolveAmbiguities('המבצע של הבוקר', false);
    expect(r.text).toBe('המבצע של הבוקר');
    expect(r.flagged.map((f) => f.word)).toEqual(['המבצע', 'הבוקר']);
  });

  it('applies selective niqqud only to standalone words with a safe ad default', () => {
    const r = resolveAmbiguities('מבצע בוקר ספר', true);
    expect(r.text).toBe('מִבְצָע בֹּקֶר ספר');
    expect(r.flagged).toEqual([
      { word: 'מבצע', applied: true },
      { word: 'בוקר', applied: true },
      { word: 'ספר', applied: false },
    ]);
  });

  it('never vocalizes the whole sentence', () => {
    const r = resolveAmbiguities('מבצע מיוחד על קפה', true);
    expect(r.text).toBe('מִבְצָע מיוחד על קפה');
  });
});

describe('provider preparation (expressive ElevenLabs models)', () => {
  it('uses plain text, fixed speed 1.0 and no audio tags by default', () => {
    const p = prepareForProvider('שלום לכולם', 'elevenlabs', { modelId: 'eleven_v3', delivery: 'energetic' });
    expect(p.payload).toBe('שלום לכולם');
    expect(p.settings).toEqual({ voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 1.0 } });
  });

  it('adds an audio tag and a punctuation pause only when enabled', () => {
    const p = prepareForProvider('שלום לכולם', 'elevenlabs', {
      modelId: 'eleven_v4',
      delivery: 'energetic',
      audioTags: true,
      pauseAfterMs: 250,
    });
    expect(p.payload).toBe('[excited] שלום לכולם...');
  });

  it('keeps dictionary niqqud but does not add niqqud on its own', () => {
    const p = prepareForProvider('בואו ללוּז, המבצע', 'elevenlabs', { modelId: 'eleven_v3' });
    expect(p.payload).toBe('בואו ללוּז, המבצע');
    expect(p.ambiguities).toEqual([{ word: 'המבצע', applied: false }]);
  });
});

describe('speech timing estimates and script length', () => {
  it('estimates speaking time from spoken characters and pauses', () => {
    expect(estimateSpeechSec('')).toBe(0);
    expect(estimateSpeechSec('א'.repeat(140))).toBeCloseTo(10, 1);
  });

  it('flags long scripts and blocks scripts far over the target', () => {
    expect(assessScriptLength(20, 20).status).toBe('OK');
    expect(assessScriptLength(25, 20).status).toBe('LONG');
    const tooLong = assessScriptLength(40, 20);
    expect(tooLong.status).toBe('TOO_LONG');
    expect(tooLong.message).toContain('ארוך מדי');
  });
});

describe('alignment → words → subtitle cues', () => {
  it('groups characters into words and skips audio tags', () => {
    const words = wordsFromAlignment(alignmentFor('[excited] קפה ומאפה'));
    expect(words.map((w) => w.text)).toEqual(['קפה', 'ומאפה']);
    expect(words[0]!.startSec).toBeGreaterThan(0.5);
  });

  it('maps subtitle chunks (original text with ₪) onto the spoken words', () => {
    const subtitle = 'עכשיו: קפה + מאפה ב-29.90 ₪ עד סוף החודש.';
    const spoken = 'עכשיו: קפה ומאפה בעשרים ותשעה שקלים ותשעים אגורות עד סוף החודש.';
    const words = wordsFromAlignment(alignmentFor(spoken));
    const audioSec = [...spoken].length * 0.07;
    const { cues, timing } = buildSpeechCues(subtitle, words, audioSec);
    expect(timing).toBe('provider');
    expect(cues.map((c) => c.text).join(' ')).toBe(subtitle);
    // Cues are ordered, non-overlapping, and end with the speech (plus a short hold).
    for (let i = 1; i < cues.length; i++)
      expect(cues[i]!.startSec).toBeGreaterThanOrEqual(cues[i - 1]!.startSec);
    expect(cues.at(-1)!.endSec).toBeLessThanOrEqual(audioSec + 0.31);
    // The price chunk lasts as long as the long spoken price, not as long as "29.90 ₪" looks.
    const priceCue = cues.find((c) => c.text.includes('29.90'))!;
    expect(priceCue.endSec - priceCue.startSec).toBeGreaterThan(1.5);
  });

  it('falls back to timing proportional to spoken length within the measured audio', () => {
    const { cues, timing } = buildSpeechCues('רגע, ראיתם את המבצע ב-Luz?', [], 2.4);
    expect(timing).toBe('estimated');
    expect(cues[0]!.startSec).toBe(0);
    expect(cues.at(-1)!.endSec).toBeCloseTo(2.7, 5);
  });
});

describe('narration plan', () => {
  const storyboard = {
    scenes: [
      { key: 'hook', order: 0, voiceover: 'רגע, ראיתם את המבצע ב-Luz?' },
      { key: 'offer', order: 1, voiceover: 'קפה + מאפה ב-29.90 ₪.' },
    ],
  } as unknown as Storyboard;

  it('normalizes each line for speech and estimates characters and time', () => {
    const plan = planNarration(storyboard, {
      provider: 'elevenlabs',
      modelId: 'eleven_v3',
      pronunciation: [{ term: 'Luz', spoken: 'לוּז', caseSensitive: false }],
      targetDurationSec: 10,
    });
    // Already ends with "?", so no pause ellipsis is appended.
    expect(plan.segments[0]!.speech.payload).toBe('רגע, ראיתם את המבצע בלוּז?');
    expect(plan.segments[1]!.spoken).toBe('קפה ומאפה בעשרים ותשעה שקלים ותשעים אגורות.');
    expect(plan.characters).toBe(plan.segments.reduce((s, x) => s + x.speech.characters, 0));
    expect(plan.scriptCheck.status).toBe('OK');
    expect(plan.warnings.some((w) => w.includes('AMBIGUOUS_WORD'))).toBe(true);
  });

  it('changes the script hash only when the spoken lines change', () => {
    const changed = {
      scenes: [{ ...storyboard.scenes[0]!, voiceover: 'טקסט אחר' }, storyboard.scenes[1]!],
    } as Storyboard;
    expect(scriptHash(storyboard)).toBe(
      scriptHash({ scenes: [...storyboard.scenes].reverse() } as Storyboard),
    );
    expect(scriptHash(changed)).not.toBe(scriptHash(storyboard));
  });
});

describe('ElevenLabs provider (HTTP contract, no network)', () => {
  const speech = prepareForProvider('שלום', 'elevenlabs', { modelId: 'eleven_v3' });
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', 'request-id': 'req-1' },
    });

  it('calls /with-timestamps with the key header and Hebrew language code, returning audio + alignment', async () => {
    resetElevenLabsCapabilityCache();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const provider = new ElevenLabsTtsProvider({
      apiKey: 'test-key',
      voiceId: 'voice123',
      modelId: 'eleven_v3',
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init: init! });
        return json(200, {
          audio_base64: Buffer.from('ID3fake').toString('base64'),
          alignment: alignmentFor('שלום'),
        });
      },
    });
    const res = await provider.synthesize({ segmentKey: 'hook', speech });
    expect(calls[0]!.url).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/voice123/with-timestamps?output_format=mp3_44100_128',
    );
    expect((calls[0]!.init.headers as Record<string, string>)['xi-api-key']).toBe('test-key');
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      text: 'שלום',
      model_id: 'eleven_v3',
      language_code: 'he',
    });
    expect(res.audio.toString()).toBe('ID3fake');
    expect(res.alignment?.characters).toEqual(['ש', 'ל', 'ו', 'ם']);
    expect(res).toMatchObject({ chargeType: 'ESTIMATED', requestId: 'req-1' });
  });

  it('falls back to the plain endpoint (no alignment) when timestamps are rejected for the model', async () => {
    resetElevenLabsCapabilityCache();
    const urls: string[] = [];
    const provider = new ElevenLabsTtsProvider({
      apiKey: 'k',
      voiceId: 'voice123',
      modelId: 'eleven_v4',
      fetchImpl: async (url) => {
        urls.push(String(url));
        return String(url).includes('with-timestamps')
          ? json(422, { detail: [{ msg: 'unsupported' }] })
          : new Response(Buffer.from('ID3audio'), { status: 200 });
      },
    });
    const res = await provider.synthesize({ segmentKey: 'hook', speech });
    expect(res.alignment).toBeNull();
    expect(urls).toHaveLength(2);
    await provider.synthesize({ segmentKey: 'hook', speech });
    expect(urls).toHaveLength(3); // remembered: no second timestamps attempt
  });

  it.each([
    [401, 'auth', false],
    [402, 'quota', false],
    [404, 'not_found', false],
    [429, 'rate_limit', true],
    [503, 'server', true],
  ] as const)('maps HTTP %i to %s (retryable=%s)', async (status, kind, retryable) => {
    resetElevenLabsCapabilityCache();
    const provider = new ElevenLabsTtsProvider({
      apiKey: 'k',
      voiceId: 'voice123',
      modelId: 'eleven_v3',
      fetchImpl: async () => json(status, { detail: 'x' }),
    });
    const error = (await provider
      .synthesize({ segmentKey: 'hook', speech })
      .catch((e: unknown) => e)) as TtsProviderError;
    expect(error).toBeInstanceOf(TtsProviderError);
    expect(error.kind).toBe(kind);
    expect(error.retryable).toBe(retryable);
    expect(error.message).not.toContain('k"');
  });

  it('maps network failures to retryable errors', async () => {
    const provider = new ElevenLabsTtsProvider({
      apiKey: 'k',
      voiceId: 'voice123',
      modelId: 'eleven_v3',
      fetchImpl: async () => {
        throw new Error('ECONNRESET');
      },
    });
    const error = (await provider
      .synthesize({ segmentKey: 'hook', speech })
      .catch((e: unknown) => e)) as TtsProviderError;
    expect(error).toMatchObject({ kind: 'network', retryable: true });
  });

  it('refuses models that are not known to support Hebrew', () => {
    expect(
      () => new ElevenLabsTtsProvider({ apiKey: 'k', voiceId: 'v', modelId: 'eleven_multilingual_v2' }),
    ).toThrow(/Hebrew/);
  });
});

describe('voice configuration', () => {
  it('parses configured voices and validates models', () => {
    expect(parseVoiceList('abc123XYZ|נועה|female;def456UVW|דני|male|eleven_v4', 'eleven_v3')).toEqual([
      { id: 'abc123XYZ', label: 'נועה', provider: 'elevenlabs', modelId: 'eleven_v3', gender: 'female' },
      { id: 'def456UVW', label: 'דני', provider: 'elevenlabs', modelId: 'eleven_v4', gender: 'male' },
    ]);
    expect(() => parseVoiceList('abc123XYZ|x|female|eleven_multilingual_v2', 'eleven_v3')).toThrow();
  });

  it('reports ElevenLabs as not ready without a key or voices', () => {
    expect(ttsSetupFromEnv({ TTS_PROVIDER: 'elevenlabs' } as NodeJS.ProcessEnv)).toMatchObject({
      ready: false,
      paid: true,
    });
    expect(ttsSetupFromEnv({} as NodeJS.ProcessEnv)).toMatchObject({
      provider: 'mock',
      ready: true,
      paid: false,
    });
  });
});

describe.skipIf(!hasFfprobe)('audio duration measurement (ffprobe)', () => {
  it('measures the mock narration audio and it matches the speech estimate', async () => {
    const text = 'קפה ומאפה בעשרים ותשעה שקלים ותשעים אגורות';
    const res = await new MockTtsProvider().synthesize({
      segmentKey: 'offer',
      speech: prepareForProvider(text, 'mock'),
    });
    const measured = await probeBufferDurationSec(res.audio, 'wav');
    expect(measured).toBeCloseTo(estimateSpeechSec(text), 1);
    expect(res.alignment?.characters.length).toBe([...text].length);
  });

  it('rejects non-media input', async () => {
    await expect(probeBufferDurationSec(Buffer.from('not audio'), 'mp3')).rejects.toThrow(/ffprobe/);
  });
});
