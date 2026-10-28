import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ChargeType } from '@kampora/shared';
import type { PreparedSpeech, TtsProviderId } from './providers';

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
  /** Supplied narration is free; real providers report characters, which the cost engine prices as ESTIMATED. */
  chargeType: ChargeType | 'NONE';
}

export interface TtsProvider {
  readonly id: TtsProviderId;
  readonly model: string;
  /** Paid providers must only be invoked through the budget guard with an approved plan. */
  readonly paid: boolean;
  synthesize(request: TtsRequest): Promise<TtsResult>;
}

export class TtsProviderError extends Error {
  constructor(
    message: string,
    readonly provider: TtsProviderId,
    readonly retryable: boolean,
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
        return { audio, mimeType, provider: this.id, model: this.model, characters: 0, chargeType: 'NONE' };
      } catch {
        // try next extension
      }
    }
    throw new TtsProviderError(`No narration file for segment "${request.segmentKey}"`, this.id, false);
  }
}

export interface ElevenLabsConfig {
  apiKey: string;
  voiceId: string;
  /** Must be a Hebrew-capable model: eleven_v3 or eleven_v4 (eleven_multilingual_v2 does NOT support Hebrew). */
  modelId: string;
  baseUrl?: string;
  timeoutMs?: number;
}

const ELEVENLABS_HEBREW_MODELS = new Set(['eleven_v3', 'eleven_v4', 'eleven_v4_turbo']);

/**
 * ElevenLabs text-to-speech (POST /v1/text-to-speech/{voice_id}, docs verified 2026-10-28).
 * Not exercised in Increment 1: no API key is configured and paid calls require approval.
 */
export class ElevenLabsTtsProvider implements TtsProvider {
  readonly id = 'elevenlabs' as const;
  readonly paid = true;
  readonly model: string;

  constructor(private readonly config: ElevenLabsConfig) {
    if (!config.apiKey) throw new Error('ElevenLabs API key is required');
    if (!ELEVENLABS_HEBREW_MODELS.has(config.modelId)) {
      throw new Error(`ElevenLabs model "${config.modelId}" is not known to support Hebrew`);
    }
    this.model = config.modelId;
  }

  async synthesize(request: TtsRequest): Promise<TtsResult> {
    if (request.speech.provider !== 'elevenlabs') {
      throw new TtsProviderError('Speech was prepared for a different provider', this.id, false);
    }
    const voiceId = request.voiceId ?? this.config.voiceId;
    const url = `${this.config.baseUrl ?? 'https://api.elevenlabs.io'}/v1/text-to-speech/${encodeURIComponent(
      voiceId,
    )}?output_format=mp3_44100_128`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'xi-api-key': this.config.apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text: request.speech.payload,
        model_id: this.model,
        language_code: 'he',
        ...request.speech.settings,
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 60_000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const retryable = response.status === 429 || response.status >= 500;
      throw new TtsProviderError(
        `ElevenLabs ${response.status}: ${detail.slice(0, 300)}`,
        this.id,
        retryable,
      );
    }
    return {
      audio: Buffer.from(await response.arrayBuffer()),
      mimeType: 'audio/mpeg',
      provider: this.id,
      model: this.model,
      characters: request.speech.characters,
      chargeType: 'ESTIMATED',
    };
  }
}
