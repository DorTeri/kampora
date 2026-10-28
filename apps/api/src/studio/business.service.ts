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
import type { StorageDriver } from '@kampora/storage';
import type { AuthContext } from '../common/auth';
import { notFound } from '../common/errors';
import { DATABASE, STORAGE } from '../infra/tokens';

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
