import { createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface ReadUrlOptions {
  expiresInSec?: number;
  /** Suggests a download filename (Content-Disposition: attachment). */
  downloadName?: string;
}

export interface StorageDriver {
  readonly kind: 's3' | 'local';
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  getBuffer(key: string): Promise<Buffer>;
  getStream(key: string): Promise<Readable>;
  exists(key: string): Promise<boolean>;
  /** Short-lived URL a browser or worker can GET. */
  getReadUrl(key: string, options?: ReadUrlOptions): Promise<string>;
}

const KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,511}$/;

export class InvalidStorageKeyError extends Error {}

/** Keys are tenant-prefixed paths like "orgs/<org>/assets/<id>.jpg". No traversal, no odd characters. */
export function assertValidKey(key: string): void {
  if (!KEY_RE.test(key) || key.includes('..') || key.includes('//')) {
    throw new InvalidStorageKeyError(`Invalid storage key "${key}"`);
  }
}

export function contentDisposition(downloadName: string): string {
  const ascii = downloadName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`;
}

// ── S3 (AWS in production, MinIO locally) ─────────────────────────────

export interface S3StorageConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export class S3Storage implements StorageDriver {
  readonly kind = 's3' as const;
  private readonly client: S3Client;

  constructor(private readonly config: S3StorageConfig) {
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint || undefined,
      forcePathStyle: config.forcePathStyle,
      credentials:
        config.accessKeyId && config.secretAccessKey
          ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
          : undefined,
    });
  }

  /** Dev convenience for MinIO; production buckets are provisioned by infrastructure, not the app. */
  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.config.bucket }));
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertValidKey(key);
    await this.client.send(
      new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async getStream(key: string): Promise<Readable> {
    assertValidKey(key);
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
    return out.Body as Readable;
  }

  async getBuffer(key: string): Promise<Buffer> {
    const stream = await this.getStream(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
    return Buffer.concat(chunks);
  }

  async exists(key: string): Promise<boolean> {
    assertValidKey(key);
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async getReadUrl(key: string, options: ReadUrlOptions = {}): Promise<string> {
    assertValidKey(key);
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ResponseContentDisposition: options.downloadName
          ? contentDisposition(options.downloadName)
          : undefined,
      }),
      { expiresIn: options.expiresInSec ?? 900 },
    );
  }
}

// ── Local disk (zero-dependency dev mode) ─────────────────────────────

export function signMediaPath(key: string, expiresAt: number, secret: string, download = ''): string {
  return createHmac('sha256', secret).update(`${key}|${expiresAt}|${download}`).digest('base64url');
}

export function verifyMediaSignature(
  key: string,
  expiresAt: number,
  signature: string,
  secret: string,
  download = '',
  now = Date.now(),
): boolean {
  if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(now / 1000)) return false;
  const expected = Buffer.from(signMediaPath(key, expiresAt, secret, download));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export interface LocalStorageConfig {
  root: string;
  signingSecret: string;
  /** Base URL of the API that serves /v1/media/<key>. */
  publicBaseUrl: string;
}

export class LocalDiskStorage implements StorageDriver {
  readonly kind = 'local' as const;

  constructor(private readonly config: LocalStorageConfig) {}

  /** Resolves a key to an absolute path, guaranteed to stay inside the storage root. */
  resolvePath(key: string): string {
    assertValidKey(key);
    const root = path.resolve(this.config.root);
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep))
      throw new InvalidStorageKeyError(`Key escapes storage root: ${key}`);
    return full;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const file = this.resolvePath(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }

  async getBuffer(key: string): Promise<Buffer> {
    return readFile(this.resolvePath(key));
  }

  async getStream(key: string): Promise<Readable> {
    return createReadStream(this.resolvePath(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await stat(this.resolvePath(key))).isFile();
    } catch {
      return false;
    }
  }

  async getReadUrl(key: string, options: ReadUrlOptions = {}): Promise<string> {
    assertValidKey(key);
    const exp = Math.floor(Date.now() / 1000) + (options.expiresInSec ?? 900);
    const download = options.downloadName ?? '';
    const sig = signMediaPath(key, exp, this.config.signingSecret, download);
    const params = new URLSearchParams({ exp: String(exp), sig });
    if (download) params.set('download', download);
    return `${this.config.publicBaseUrl.replace(/\/$/, '')}/v1/media/${key}?${params.toString()}`;
  }
}

export function storageFromEnv(env: NodeJS.ProcessEnv = process.env): StorageDriver {
  if ((env.STORAGE_DRIVER ?? 's3') === 'local') {
    // Relative roots resolve against the monorepo root (packages/storage/dist → ../../..), because each
    // workspace process runs from its own directory.
    const root = env.STORAGE_LOCAL_ROOT ?? '.data/storage';
    return new LocalDiskStorage({
      root: path.isAbsolute(root) ? root : path.resolve(__dirname, '../../..', root),
      signingSecret: required(env, 'MEDIA_SIGNING_SECRET'),
      publicBaseUrl: env.API_PUBLIC_URL ?? 'http://localhost:4000',
    });
  }
  return new S3Storage({
    bucket: required(env, 'S3_BUCKET'),
    region: env.S3_REGION ?? 'us-east-1',
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  });
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}
