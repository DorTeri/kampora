import { describe, expect, it } from 'vitest';
import { mediaAuthenticity, representsRealBusiness } from './authenticity';

describe('mediaAuthenticity', () => {
  it('only the business own photos represent the real business', () => {
    const product = mediaAuthenticity({
      source: 'CUSTOMER_UPLOAD',
      mimeType: 'image/jpeg',
      tags: ['product'],
    });
    const place = mediaAuthenticity({ source: 'CUSTOMER_UPLOAD', mimeType: 'image/jpeg', tags: ['store'] });
    expect(product).toBe('VERIFIED_PRODUCT_PHOTO');
    expect(place).toBe('VERIFIED_BUSINESS_PHOTO');
    expect(representsRealBusiness(product)).toBe(true);
    expect(representsRealBusiness(place)).toBe(true);
  });

  it('generated images are stand-ins, guided by real photos or not', () => {
    expect(mediaAuthenticity({ source: 'AI_GENERATED', referenceGuided: true })).toBe('REFERENCE_GUIDED_AI');
    expect(mediaAuthenticity({ source: 'AI_GENERATED' })).toBe('SYNTHETIC_AI');
    expect(representsRealBusiness('REFERENCE_GUIDED_AI')).toBe(false);
    expect(representsRealBusiness('SYNTHETIC_AI')).toBe(false);
  });

  it('illustrations, stock, demo and unknown provenance are never verified', () => {
    expect(
      mediaAuthenticity({ source: 'CUSTOMER_UPLOAD', mimeType: 'image/svg+xml', tags: ['product'] }),
    ).toBe('ILLUSTRATION');
    expect(mediaAuthenticity({ source: 'DEMO', mimeType: 'image/jpeg' })).toBe('GENERIC_STOCK');
    expect(mediaAuthenticity({ source: 'STOCK', mimeType: 'image/jpeg' })).toBe('GENERIC_STOCK');
    expect(mediaAuthenticity({ mimeType: 'image/jpeg', tags: ['product'] })).toBe('GENERIC_STOCK');
  });
});
