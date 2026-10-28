import { createHash } from 'node:crypto';
import { DEMO_BUSINESS } from '@kampora/creative-engine';
import { S3Storage, storageFromEnv } from '@kampora/storage';
import { createDatabase } from '../client';
import { DEMO_ASSET_DEFINITIONS, loadDemoAssetBytes } from '../demo/assets';
import { DEMO_IDS, DEMO_USER_EMAIL, demoAssetId } from '../demo/ids';
import {
  brandAssets,
  brandProfiles,
  businesses,
  memberships,
  organizations,
  pronunciationEntries,
  users,
} from '../schema';

/** Seeds the fictional demo business "Luz" (idempotent). Campaigns are created through the API journey. */
async function main() {
  const { db, close } = createDatabase(undefined, 2);
  const storage = storageFromEnv();
  if (storage instanceof S3Storage) await storage.ensureBucket();

  try {
    await db
      .insert(organizations)
      .values({ id: DEMO_IDS.org, name: 'Luz (demo)' })
      .onConflictDoUpdate({ target: organizations.id, set: { name: 'Luz (demo)' } });
    await db
      .insert(users)
      .values({ id: DEMO_IDS.user, email: DEMO_USER_EMAIL, displayName: 'נועה (דמו)' })
      .onConflictDoNothing();
    await db
      .insert(memberships)
      .values({ orgId: DEMO_IDS.org, userId: DEMO_IDS.user, role: 'OWNER' })
      .onConflictDoNothing();

    const b = DEMO_BUSINESS;
    const businessValues = {
      orgId: DEMO_IDS.org,
      name: b.name,
      website: b.website,
      category: b.category,
      city: b.city,
      address: b.address,
      description: b.description,
      products: b.products,
      targetAudience: b.targetAudience,
    };
    await db
      .insert(businesses)
      .values({ id: DEMO_IDS.business, ...businessValues })
      .onConflictDoUpdate({ target: businesses.id, set: businessValues });

    const brandValues = {
      orgId: DEMO_IDS.org,
      businessId: DEMO_IDS.business,
      tone: b.tone,
      colors: b.brandColors,
      approvedClaims: b.approvedClaims,
      guidelines: b.guidelines,
      fieldSources: b.fieldSources,
      confirmedAt: new Date(),
    };
    await db
      .insert(brandProfiles)
      .values({ id: DEMO_IDS.brandProfile, ...brandValues })
      .onConflictDoUpdate({ target: brandProfiles.id, set: brandValues });

    for (const entry of b.pronunciation) {
      await db
        .insert(pronunciationEntries)
        .values({ orgId: DEMO_IDS.org, businessId: DEMO_IDS.business, ...entry })
        .onConflictDoUpdate({
          target: [pronunciationEntries.businessId, pronunciationEntries.term],
          set: { spoken: entry.spoken, caseSensitive: entry.caseSensitive, note: entry.note },
        });
    }

    for (const def of DEMO_ASSET_DEFINITIONS) {
      const bytes = await loadDemoAssetBytes(def);
      const ext = def.mimeType === 'audio/wav' ? 'wav' : 'svg';
      const storageKey = `orgs/${DEMO_IDS.org}/brand-assets/${def.key}.${ext}`;
      await storage.put(storageKey, bytes, def.mimeType);
      const values = {
        orgId: DEMO_IDS.org,
        businessId: DEMO_IDS.business,
        kind: def.kind,
        storageKey,
        mimeType: def.mimeType,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        width: def.width,
        height: def.height,
        durationSec: def.durationSec,
        description: def.description,
        tags: def.tags,
        provenance: def.provenance,
      };
      await db
        .insert(brandAssets)
        .values({ id: demoAssetId(def.key), ...values })
        .onConflictDoUpdate({ target: brandAssets.id, set: values });
    }

    console.log(
      `✓ seeded demo business "${b.name}" with ${DEMO_ASSET_DEFINITIONS.length} assets (${storage.kind} storage)`,
    );
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
