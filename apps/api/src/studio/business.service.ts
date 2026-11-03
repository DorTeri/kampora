import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import {
  brandAssets,
  brandProfiles,
  businesses,
  pronunciationEntries,
  type Database,
} from '@kampora/database';
import {
  BusinessProfileSchema,
  type AvailableAsset,
  type BusinessProfile,
  type MediaAsset,
  type ToneOfVoice,
} from '@kampora/shared';
import { probeBufferDurationSec } from '@kampora/hebrew-voice';
import type { StorageDriver } from '@kampora/storage';
import type { AuthContext } from '../common/auth';
import { notFound } from '../common/errors';
import { DATABASE, STORAGE } from '../infra/tokens';
import { UPLOAD_SUBJECTS, UPLOAD_TYPES, imageSize, sniffUpload, uploadError } from './uploads';

export interface UploadInput {
  bytes: Buffer;
  mimeType: string;
  /** What the picture shows (UPLOAD_SUBJECTS key). */
  subject: string;
  description: string;
  /** The owner confirmed the media is theirs to use in ads. */
  rightsConfirmed: boolean;
}

export type BrandAssetRow = typeof brandAssets.$inferSelect;

@Injectable()
export class BusinessService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: StorageDriver,
  ) {}

  async list(ctx: AuthContext) {
    return this.db
      .select({
        id: businesses.id,
        name: businesses.name,
        category: businesses.category,
        city: businesses.city,
      })
      .from(businesses)
      .where(eq(businesses.orgId, ctx.orgId))
      .orderBy(asc(businesses.createdAt));
  }

  /** Assembles the canonical BusinessProfile (business + brand + pronunciation), validated by Zod. */
  async loadProfile(ctx: AuthContext, businessId: string): Promise<BusinessProfile> {
    const [business] = await this.db
      .select()
      .from(businesses)
      .where(and(eq(businesses.id, businessId), eq(businesses.orgId, ctx.orgId)));
    if (!business) throw notFound('Business');
    const [brand] = await this.db
      .select()
      .from(brandProfiles)
      .where(and(eq(brandProfiles.businessId, businessId), eq(brandProfiles.orgId, ctx.orgId)));
    if (!brand) throw notFound('Brand profile');
    const pronunciation = await this.db
      .select()
      .from(pronunciationEntries)
      .where(and(eq(pronunciationEntries.businessId, businessId), eq(pronunciationEntries.orgId, ctx.orgId)));

    return BusinessProfileSchema.parse({
      name: business.name,
      website: business.website ?? undefined,
      category: business.category,
      city: business.city ?? undefined,
      address: business.address ?? undefined,
      description: business.description,
      products: business.products,
      targetAudience: business.targetAudience,
      tone: brand.tone as ToneOfVoice,
      brandColors: brand.colors,
      logoAssetId: brand.logoAssetId ?? undefined,
      approvedClaims: brand.approvedClaims,
      guidelines: brand.guidelines,
      pronunciation: pronunciation.map((p) => ({
        term: p.term,
        spoken: p.spoken,
        caseSensitive: p.caseSensitive,
        note: p.note ?? undefined,
      })),
      fieldSources: brand.fieldSources,
    });
  }

  async assets(ctx: AuthContext, businessId: string): Promise<BrandAssetRow[]> {
    return this.db
      .select()
      .from(brandAssets)
      .where(and(eq(brandAssets.businessId, businessId), eq(brandAssets.orgId, ctx.orgId)))
      .orderBy(asc(brandAssets.createdAt));
  }

  /**
   * The owner's own photo or clip, stored like every other brand asset: the Art Director, the static-ad picture
   * choice and the video router read brand assets, and CUSTOMER_UPLOAD provenance marks it as the real business.
   */
  async upload(ctx: AuthContext, businessId: string, input: UploadInput) {
    const [business] = await this.db
      .select({ id: businesses.id })
      .from(businesses)
      .where(and(eq(businesses.id, businessId), eq(businesses.orgId, ctx.orgId)));
    if (!business) throw notFound('Business');
    const type = UPLOAD_TYPES[input.mimeType];
    if (!type) throw uploadError('UPLOAD_TYPE', `Unsupported file type ${input.mimeType}`);
    const tags = UPLOAD_SUBJECTS[input.subject];
    if (!tags) throw uploadError('UPLOAD_SUBJECT', 'Unknown subject');
    if (!input.rightsConfirmed) throw uploadError('UPLOAD_RIGHTS', 'The owner must confirm the rights to the media');
    if (!input.bytes.length || input.bytes.length > type.maxBytes) throw uploadError('UPLOAD_SIZE', 'File is empty or too large');
    if (!sniffUpload(input.mimeType, input.bytes)) throw uploadError('UPLOAD_CONTENT', 'File content does not match its type');
    const size = type.kind === 'image' ? imageSize(input.mimeType, input.bytes) : undefined;
    let durationSec: number | undefined;
    if (type.kind === 'video') {
      try {
        durationSec = await probeBufferDurationSec(input.bytes, type.ext, process.env.FFPROBE_PATH || undefined);
      } catch {
        throw uploadError('UPLOAD_VIDEO_UNREADABLE', 'The video could not be read (ffprobe)');
      }
    }
    const id = randomUUID();
    const storageKey = `orgs/${ctx.orgId}/businesses/${businessId}/uploads/${id}.${type.ext}`;
    await this.storage.put(storageKey, input.bytes, input.mimeType);
    const [row] = await this.db
      .insert(brandAssets)
      .values({
        id,
        orgId: ctx.orgId,
        businessId,
        kind: type.kind,
        storageKey,
        mimeType: input.mimeType,
        bytes: input.bytes.length,
        sha256: createHash('sha256').update(input.bytes).digest('hex'),
        width: size?.width,
        height: size?.height,
        durationSec,
        description: input.description.trim().slice(0, 200),
        tags,
        provenance: {
          source: 'CUSTOMER_UPLOAD',
          license: 'Uploaded by the business owner, who confirmed the right to use it in ads',
          commercialUse: true,
        },
      })
      .returning();
    return { id: row!.id, kind: row!.kind, tags: row!.tags, width: row!.width, height: row!.height, durationSec: row!.durationSec };
  }

  /** Profile + assets with short-lived preview URLs, for the "העסק שלי" page. */
  async detail(ctx: AuthContext, businessId: string) {
    const [profile, assets] = await Promise.all([
      this.loadProfile(ctx, businessId),
      this.assets(ctx, businessId),
    ]);
    return {
      id: businessId,
      profile,
      assets: await Promise.all(
        assets.map(async (a) => ({
          id: a.id,
          kind: a.kind,
          description: a.description,
          tags: a.tags,
          mimeType: a.mimeType,
          provenance: a.provenance,
          url: await this.storage.getReadUrl(a.storageKey, { expiresInSec: 3600 }),
        })),
      ),
    };
  }
}

/** Planning view of brand assets (no storage details). */
export function toAvailableAssets(rows: BrandAssetRow[]): AvailableAsset[] {
  return rows.map((a) => ({
    id: a.id,
    kind: a.kind,
    description: a.description,
    tags: a.tags,
    width: a.width ?? undefined,
    height: a.height ?? undefined,
    durationSec: a.durationSec ?? undefined,
    mimeType: a.mimeType,
    source: a.provenance.source,
    commercialUse: a.provenance.commercialUse,
  }));
}

/** Render view of brand assets (storage keys + provenance), as referenced by a VideoProject. */
export function toMediaAssets(rows: BrandAssetRow[]): MediaAsset[] {
  return rows.map((a) => ({
    id: a.id,
    kind: a.kind === 'logo' ? 'image' : a.kind,
    storageKey: a.storageKey,
    mimeType: a.mimeType,
    width: a.width ?? undefined,
    height: a.height ?? undefined,
    durationSec: a.durationSec ?? undefined,
    provenance: a.provenance,
  }));
}
