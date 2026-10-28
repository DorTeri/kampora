import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import OpenAI, { toFile } from 'openai';
import type {
  GeneratedMedia,
  ImageGenerationCapabilities,
  ImageGenerationProvider,
  ImageGenerationRequest,
} from './contracts';

export type ImageQuality = 'low' | 'medium' | 'high';

/** Image provider configuration resolved from env. Secrets stay in env; callers only see ready/reason. */
export interface ImageSetup {
  provider: 'mock' | 'openai' | 'none';
  model: string;
  quality: ImageQuality;
  paid: boolean;
  ready: boolean;
  reason?: string;
}

export function imageSetupFromEnv(env: NodeJS.ProcessEnv = process.env): ImageSetup {
  const quality =
    (['low', 'medium', 'high'] as const).find((q) => q === env.OPENAI_IMAGE_QUALITY) ?? 'medium';
  switch (env.IMAGE_PROVIDER) {
    case 'openai': {
      const reason = env.OPENAI_API_KEY ? undefined : 'OPENAI_API_KEY is not set';
      const model = env.OPENAI_IMAGE_MODEL || 'gpt-image-2';
      return { provider: 'openai', model, quality, paid: true, ready: !reason, reason };
    }
    case 'none':
      return {
        provider: 'none',
        model: 'none',
        quality,
        paid: false,
        ready: false,
        reason: 'AI images disabled (IMAGE_PROVIDER=none)',
      };
    default:
      return { provider: 'mock', model: MOCK_IMAGE_MODEL, quality, paid: false, ready: true };
  }
}

/** Price-catalog model key: image prices depend on quality, so it is part of the key. */
export function imagePriceModel(setup: Pick<ImageSetup, 'model' | 'quality' | 'provider'>): string {
  return setup.provider === 'openai' ? `${setup.model}@${setup.quality}` : setup.model;
}

/**
 * Planning surcharge per reference photo: reference images are billed as image input tokens, which we cannot
 * know exactly before the call. Deliberately conservative.
 */
export const REFERENCE_IMAGE_SURCHARGE_USD = 0.01;

/** Worst-case USD of one image call. Both the API quote and the worker gate use this, so they always agree. */
export function imageCallEstimateUsd(unitPriceUsd: number, referenceCount: number): number {
  if (unitPriceUsd === 0) return 0;
  return Math.round((unitPriceUsd + referenceCount * REFERENCE_IMAGE_SURCHARGE_USD) * 1_000_000) / 1_000_000;
}

/** Throws if the setup is not ready (callers check `ready` first). */
export function createImageProvider(
  setup: ImageSetup,
  price: { unitPriceUsd: number; verified: boolean },
  env: NodeJS.ProcessEnv = process.env,
): ImageGenerationProvider {
  if (!setup.ready) throw new Error(setup.reason ?? 'Image provider is not configured');
  if (setup.provider === 'openai')
    return new OpenAiImageProvider({
      apiKey: env.OPENAI_API_KEY ?? '',
      model: setup.model,
      quality: setup.quality,
      unitPriceUsd: price.unitPriceUsd,
      verified: price.verified,
      timeoutMs: env.OPENAI_IMAGE_TIMEOUT_MS ? Number(env.OPENAI_IMAGE_TIMEOUT_MS) : undefined,
    });
  return new MockImageProvider();
}

// ── OpenAI ────────────────────────────────────────────────────────────

export interface OpenAiImageConfig {
  apiKey: string;
  model: string;
  quality: ImageQuality;
  unitPriceUsd: number;
  /** VERIFIED catalog price ⇒ CONFIRMED charge; otherwise ESTIMATED. */
  verified: boolean;
  timeoutMs?: number;
  baseURL?: string;
  /** Injected for tests. */
  client?: Pick<OpenAI, 'images'>;
}

/** Sizes with known prices. Portrait formats share 1024x1536; the renderer crops to cover (4:5, 9:16). */
const OPENAI_SIZES: Record<ImageGenerationRequest['aspectRatio'], { size: string; w: number; h: number }> = {
  '9:16': { size: '1024x1536', w: 1024, h: 1536 },
  '4:5': { size: '1024x1536', w: 1024, h: 1536 },
  '1:1': { size: '1024x1024', w: 1024, h: 1024 },
  '16:9': { size: '1536x1024', w: 1536, h: 1024 },
};

/**
 * OpenAI Images API. Without references: `images.generate`. With customer photos: `images.edit`, which uses the
 * photos as references so the product stays recognizable. SDK retries are off: one approved call = one charge.
 */
export class OpenAiImageProvider implements ImageGenerationProvider {
  readonly id = 'openai';
  readonly paid = true;
  readonly model: string;
  readonly capabilities: ImageGenerationCapabilities = {
    referenceImages: true,
    maxReferenceImages: 4,
    aspectRatios: ['9:16', '4:5', '1:1'],
  };
  private readonly client: Pick<OpenAI, 'images'>;

  constructor(private readonly config: OpenAiImageConfig) {
    if (!config.apiKey && !config.client)
      throw new Error('OPENAI_API_KEY is required for the OpenAI image provider');
    this.model = config.model;
    this.client =
      config.client ??
      new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        timeout: config.timeoutMs ?? 180_000,
        maxRetries: 0,
      });
  }

  async generate(request: ImageGenerationRequest): Promise<GeneratedMedia> {
    const refs = request.referenceImages ?? [];
    if (refs.length > this.capabilities.maxReferenceImages)
      throw new Error(`At most ${this.capabilities.maxReferenceImages} reference images are supported`);
    const { size, w, h } = OPENAI_SIZES[request.aspectRatio];
    const prompt = request.negativePrompt
      ? `${request.prompt}\n\nAvoid: ${request.negativePrompt}`
      : request.prompt;
    const common = { model: this.model, prompt, size, quality: this.config.quality, n: 1 } as const;
    const res = refs.length
      ? await this.client.images.edit({
          ...common,
          image: await Promise.all(refs.map((r) => toFile(r.data, r.name, { type: r.mimeType }))),
          output_format: 'jpeg',
        })
      : await this.client.images.generate({ ...common, output_format: 'jpeg' });
    const b64 = res.data?.[0]?.b64_json;
    if (!b64) throw new Error('OpenAI returned no image data');
    return {
      data: Buffer.from(b64, 'base64'),
      mimeType: 'image/jpeg',
      width: w,
      height: h,
      usage: {
        provider: this.id,
        model: this.model,
        chargeType: this.config.verified ? 'CONFIRMED' : 'ESTIMATED',
        costUsd: imageCallEstimateUsd(this.config.unitPriceUsd, refs.length),
        inputTokens: res.usage?.input_tokens,
        outputTokens: res.usage?.output_tokens,
      },
    };
  }
}

// ── Mock ──────────────────────────────────────────────────────────────

export const MOCK_IMAGE_MODEL = 'mock-image-v1';

const MOCK_SIZES: Record<ImageGenerationRequest['aspectRatio'], [number, number]> = {
  '9:16': [540, 960],
  '4:5': [540, 675],
  '1:1': [540, 540],
  '16:9': [960, 540],
};

/**
 * Deterministic placeholder "photo": a soft studio backdrop in the prompt's brand colors (#hex found in the
 * prompt), a floor plane and a lit subject shape. No text. Same prompt ⇒ same bytes. Free (SIMULATED).
 */
export class MockImageProvider implements ImageGenerationProvider {
  readonly id = 'mock';
  readonly model = MOCK_IMAGE_MODEL;
  readonly paid = false;
  readonly capabilities: ImageGenerationCapabilities = {
    referenceImages: true,
    maxReferenceImages: 4,
    aspectRatios: ['9:16', '4:5', '1:1'],
  };

  async generate(request: ImageGenerationRequest): Promise<GeneratedMedia> {
    const [w, h] = MOCK_SIZES[request.aspectRatio];
    const seed = createHash('sha256').update(request.prompt).digest();
    const hexes = [...request.prompt.matchAll(/#([0-9a-f]{6})\b/gi)].map((m) => hexToRgb(m[1]!));
    const base = hexes[0] ?? [seed[0]!, seed[1]!, seed[2]!];
    const accent = hexes[1] ?? [seed[3]!, seed[4]!, seed[5]!];
    const top = mix(base, [255, 255, 255], 0.55);
    const bottom = mix(base, [20, 20, 28], 0.35);
    const floor = mix(accent, [30, 30, 36], 0.5);
    const cx = w * (0.35 + (seed[6]! / 255) * 0.3);
    const cy = h * (0.45 + (seed[7]! / 255) * 0.15);
    const r = Math.min(w, h) * (0.18 + (seed[8]! / 255) * 0.08);
    const horizon = h * 0.68;

    const rgb = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let c =
          y < horizon ? mix(top, bottom, y / horizon) : mix(floor, bottom, (y - horizon) / (h - horizon));
        const d = Math.hypot(x - cx, (y - cy) * 0.9) / r;
        if (d < 1) c = mix(mix(accent, [255, 255, 255], 0.35 * (1 - d)), c, Math.pow(d, 6));
        else c = mix(c, [255, 255, 255], 0.12 * Math.max(0, 1 - (d - 1) / 2));
        // Soft vignette, like a lit studio shot.
        const v = Math.hypot((x - w / 2) / w, (y - h / 2) / h);
        c = mix(c, [0, 0, 0], Math.min(0.35, v * v * 0.9));
        const i = (y * w + x) * 3;
        rgb[i] = c[0];
        rgb[i + 1] = c[1];
        rgb[i + 2] = c[2];
      }
    }
    return {
      data: encodePng(w, h, rgb),
      mimeType: 'image/png',
      width: w,
      height: h,
      usage: { provider: this.id, model: this.model, chargeType: 'SIMULATED', costUsd: 0 },
    };
  }
}

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: Rgb | number[], b: Rgb | number[], t: number): Rgb {
  const k = Math.max(0, Math.min(1, t));
  return [0, 1, 2].map((i) => Math.round(a[i]! * (1 - k) + b[i]! * k)) as Rgb;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Minimal 8-bit RGB PNG encoder (no dependencies). */
export function encodePng(width: number, height: number, rgb: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // filter: none
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
