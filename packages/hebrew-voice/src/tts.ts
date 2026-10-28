import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ChargeType } from '@kampora/shared';
import type { CharacterAlignment } from './alignment';
import type { PreparedSpeech, TtsProviderId } from './providers';
import { estimateSpeechSec } from './speech-timing';

export interface TtsRequest {
  /** Stable key for the segment (usually the storyboard scene key). */
  segmentKey: string;
  speech: PreparedSpeech;
  voiceId?: string;
}

export interface TtsResult {
  audio: Buffer;
  mimeType: 'audio/mpeg' | 'audio/wav';
  provider: TtsProviderId;
  model: string;
  characters: number;
  /** Character timing for the text we sent, when the provider returned it. */
  alignment: CharacterAlignment | null;
  /** NONE: supplied file; SIMULATED: mock; ESTIMATED: real provider, USD from a planning price (credits vary by plan). */
  chargeType: ChargeType | 'NONE';
  requestId?: string;
}

export interface TtsProvider {
  readonly id: TtsProviderId;
  readonly model: string;
  /** Paid providers must only be invoked through the budget guard with an approved plan. */
  readonly paid: boolean;
  synthesize(request: TtsRequest): Promise<TtsResult>;
}

export type TtsErrorKind =
  'auth' | 'rate_limit' | 'server' | 'bad_request' | 'network' | 'not_found' | 'quota';

export class TtsProviderError extends Error {
  constructor(
    message: string,
    readonly provider: TtsProviderId,
    readonly retryable: boolean,
    readonly kind: TtsErrorKind = retryable ? 'server' : 'bad_request',
    readonly status?: number,
  ) {
    super(message);
  }
}

/**
 * Uses narration recorded or licensed by the customer: <dir>/<segmentKey>.wav|.mp3.
 * Lets the full pipeline run with real Hebrew voice without any TTS API key.
 */
export class SuppliedNarrationProvider implements TtsProvider {
  readonly id = 'supplied' as const;
  readonly model = 'supplied-file';
  readonly paid = false;

  constructor(private readonly directory: string) {}

  async synthesize(request: TtsRequest): Promise<TtsResult> {
    if (!/^[a-z0-9-]+$/.test(request.segmentKey)) {
      throw new TtsProviderError(`Invalid segment key "${request.segmentKey}"`, this.id, false);
    }
    for (const [ext, mimeType] of [
      ['wav', 'audio/wav'],
      ['mp3', 'audio/mpeg'],
    ] as const) {
      const file = path.join(this.directory, `${request.segmentKey}.${ext}`);
      try {
        const audio = await readFile(file);
        return {
          audio,
          mimeType,
          provider: this.id,
          model: this.model,
          characters: 0,
          alignment: null,
          chargeType: 'NONE',
        };
      } catch {
        // try next extension
      }
    }
    throw new TtsProviderError(
      `No narration file for segment "${request.segmentKey}"`,
      this.id,
      false,
      'not_found',
    );
  }
}

/**
 * Development/test stand-in (TTS_PROVIDER=mock). Produces REAL audio — a soft syllable-rate tone pattern with
 * word gaps, labeled MOCK, not speech — whose length follows the Hebrew speaking-time estimate, plus a
 * synthetic character alignment. This exercises ffprobe measurement, retiming, cues and ducking end to end.
 */
export class MockTtsProvider implements TtsProvider {
  readonly id = 'mock' as const;
  readonly model = 'mock-voice-v1';
  readonly paid = false;

  async synthesize(request: TtsRequest): Promise<TtsResult> {
    const text = request.speech.payload.replace(/\[[^\]]*\]\s*/g, '');
    const duration = Math.max(0.8, estimateSpeechSec(text));
    const characters = [...text];
    const step = duration / Math.max(1, characters.length);
    return {
      audio: synthesizeSpeechLikeWav(text, duration),
      mimeType: 'audio/wav',
      provider: this.id,
      model: this.model,
      characters: characters.length,
      alignment: {
        characters,
        character_start_times_seconds: characters.map((_, i) => round(i * step)),
        character_end_times_seconds: characters.map((_, i) => round((i + 1) * step)),
      },
      chargeType: 'SIMULATED',
    };
  }
}

const round = (n: number) => Math.round(n * 1000) / 1000;

function synthesizeSpeechLikeWav(text: string, durationSec: number, sampleRate = 22_050): Buffer {
  const total = Math.floor(durationSec * sampleRate);
  const chars = [...text];
  const data = Buffer.alloc(total * 2);
  for (let i = 0; i < total; i++) {
    const t = i / sampleRate;
    const ch = chars[Math.min(chars.length - 1, Math.floor((t / durationSec) * chars.length))] ?? ' ';
    const voiced = /\s|[.,!?]/.test(ch) ? 0 : 1;
    const syllable = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4.5 * t);
    const f0 = 170 + 25 * Math.sin(2 * Math.PI * 0.7 * t);
    const v =
      voiced * syllable * (0.5 * Math.sin(2 * Math.PI * f0 * t) + 0.2 * Math.sin(4 * Math.PI * f0 * t));
    data.writeInt16LE(Math.round(v * 0.35 * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

export interface ElevenLabsConfig {
  apiKey: string;
  voiceId: string;
  /** Must be a Hebrew-capable model: eleven_v3 or eleven_v4 (eleven_multilingual_v2 does NOT support Hebrew). */
  modelId: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
}

/** Hebrew-capable per the models page (checked 2026-10-28). */
export const ELEVENLABS_HEBREW_MODELS = ['eleven_v3', 'eleven_v4', 'eleven_v4_turbo'] as const;

/** Models where /with-timestamps was rejected at runtime; we fall back to the plain endpoint for them. */
const NO_TIMESTAMPS = new Set<string>();

/**
 * ElevenLabs text-to-speech (docs checked 2026-10-28):
 *  - POST /v1/text-to-speech/{voice_id}/with-timestamps → { audio_base64, alignment, normalized_alignment }
 *  - The docs do not state timestamp support per model and `alignment` is nullable, so alignment is optional:
 *    a 400/422 from the timestamps endpoint falls back once to POST /v1/text-to-speech/{voice_id} (audio only).
 * Paid: only called by the narration job after approval + budget checks.
 */
export class ElevenLabsTtsProvider implements TtsProvider {
  readonly id = 'elevenlabs' as const;
  readonly paid = true;
  readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: ElevenLabsConfig) {
    if (!config.apiKey) throw new Error('ElevenLabs API key is required');
    if (!(ELEVENLABS_HEBREW_MODELS as readonly string[]).includes(config.modelId)) {
      throw new Error(`ElevenLabs model "${config.modelId}" is not known to support Hebrew`);
    }
    this.model = config.modelId;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async synthesize(request: TtsRequest): Promise<TtsResult> {
    if (request.speech.provider !== 'elevenlabs') {
      throw new TtsProviderError('Speech was prepared for a different provider', this.id, false);
    }
    const voiceId = encodeURIComponent(request.voiceId ?? this.config.voiceId);
    const base = `${this.config.baseUrl ?? 'https://api.elevenlabs.io'}/v1/text-to-speech/${voiceId}`;
    const body = JSON.stringify({
      text: request.speech.payload,
      model_id: this.model,
      language_code: 'he',
      ...request.speech.settings,
    });

    if (!NO_TIMESTAMPS.has(this.model)) {
      const res = await this.post(
        `${base}/with-timestamps?output_format=mp3_44100_128`,
        body,
        'application/json',
      );
      if (res.ok) {
        const json = (await res.json()) as { audio_base64?: string; alignment?: CharacterAlignment | null };
        if (!json.audio_base64)
          throw new TtsProviderError('ElevenLabs returned no audio', this.id, true, 'server');
        return this.result(Buffer.from(json.audio_base64, 'base64'), json.alignment ?? null, request, res);
      }
      if (res.status !== 400 && res.status !== 422) throw await this.error(res);
      NO_TIMESTAMPS.add(this.model);
    }
    const res = await this.post(`${base}?output_format=mp3_44100_128`, body, 'audio/mpeg');
    if (!res.ok) throw await this.error(res);
    return this.result(Buffer.from(await res.arrayBuffer()), null, request, res);
  }

  private async post(url: string, body: string, accept: string): Promise<Response> {
    try {
      return await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'xi-api-key': this.config.apiKey, 'Content-Type': 'application/json', Accept: accept },
        body,
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 60_000),
      });
    } catch (error) {
      throw new TtsProviderError(
        `ElevenLabs network error: ${error instanceof Error ? error.message : String(error)}`,
        this.id,
        true,
        'network',
      );
    }
  }

  private result(
    audio: Buffer,
    alignment: CharacterAlignment | null,
    request: TtsRequest,
    res: Response,
  ): TtsResult {
    return {
      audio,
      mimeType: 'audio/mpeg',
      provider: this.id,
      model: this.model,
      characters: request.speech.characters,
      alignment,
      chargeType: 'ESTIMATED',
      requestId: res.headers.get('request-id') ?? res.headers.get('x-request-id') ?? undefined,
    };
  }

  private async error(res: Response): Promise<TtsProviderError> {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    const s = res.status;
    if (s === 401 || s === 403)
      return new TtsProviderError(`ElevenLabs auth error ${s}`, this.id, false, 'auth', s);
    if (s === 402 || /quota/i.test(detail))
      return new TtsProviderError(`ElevenLabs quota exceeded (${s})`, this.id, false, 'quota', s);
    if (s === 404)
      return new TtsProviderError(`ElevenLabs voice/model not found (${s})`, this.id, false, 'not_found', s);
    if (s === 429)
      return new TtsProviderError(`ElevenLabs rate limited (${s})`, this.id, true, 'rate_limit', s);
    if (s >= 500) return new TtsProviderError(`ElevenLabs server error ${s}`, this.id, true, 'server', s);
    return new TtsProviderError(`ElevenLabs ${s}: ${detail}`, this.id, false, 'bad_request', s);
  }
}

/** Test hook: forget runtime fallbacks. */
export function resetElevenLabsCapabilityCache(): void {
  NO_TIMESTAMPS.clear();
}
