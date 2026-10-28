import { describe, expect, it } from 'vitest';
import { MockImageProvider, OpenAiImageProvider, imageCallEstimateUsd, imageSetupFromEnv } from './images';

describe('MockImageProvider', () => {
  it('returns a deterministic PNG of the requested aspect, free', async () => {
    const p = new MockImageProvider();
    const a = await p.generate({ prompt: 'x #7c3aed #f59e0b', aspectRatio: '9:16' });
    const b = await p.generate({ prompt: 'x #7c3aed #f59e0b', aspectRatio: '9:16' });
    expect(a.data.equals(b.data)).toBe(true);
    expect(a.data.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(a.data.readUInt32BE(16)).toBe(540);
    expect(a.data.readUInt32BE(20)).toBe(960);
    expect(a.usage).toMatchObject({ chargeType: 'SIMULATED', costUsd: 0 });
    const square = await p.generate({ prompt: 'x', aspectRatio: '1:1' });
    expect(square.data.readUInt32BE(20)).toBe(540);
  });
});

describe('OpenAiImageProvider (fake client, no network)', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
  const fakeClient = () => {
    const calls: { kind: string; params: Record<string, unknown> }[] = [];
    const respond = async (params: Record<string, unknown>, kind: string) => {
      calls.push({ kind, params });
      return { data: [{ b64_json: jpeg }], usage: { input_tokens: 10, output_tokens: 20 } };
    };
    return {
      calls,
      client: {
        images: {
          generate: (p: Record<string, unknown>) => respond(p, 'generate'),
          edit: (p: Record<string, unknown>) => respond(p, 'edit'),
        },
      } as never,
    };
  };

  it('uses generate without references and edit with them; jpeg, one image, estimated charge', async () => {
    const { calls, client } = fakeClient();
    const p = new OpenAiImageProvider({
      apiKey: '',
      model: 'gpt-image-2',
      quality: 'medium',
      unitPriceUsd: 0.041,
      verified: false,
      client,
    });
    const plain = await p.generate({ prompt: 'p', negativePrompt: 'text', aspectRatio: '9:16' });
    expect(calls[0]).toMatchObject({
      kind: 'generate',
      params: { model: 'gpt-image-2', size: '1024x1536', quality: 'medium', n: 1, output_format: 'jpeg' },
    });
    expect(calls[0]!.params.prompt).toContain('Avoid: text');
    expect(plain.usage).toMatchObject({ chargeType: 'ESTIMATED', costUsd: 0.041, outputTokens: 20 });

    const ref = { data: Buffer.from('x'), mimeType: 'image/jpeg', name: 'p.jpg' };
    const withRef = await p.generate({ prompt: 'p', aspectRatio: '1:1', referenceImages: [ref] });
    expect(calls[1]!.kind).toBe('edit');
    expect(calls[1]!.params.size).toBe('1024x1024');
    expect(calls[1]!.params).not.toHaveProperty('input_fidelity');
    expect(withRef.usage.costUsd).toBe(imageCallEstimateUsd(0.041, 1));
  });

  it('refuses too many references instead of silently dropping them', async () => {
    const { client } = fakeClient();
    const p = new OpenAiImageProvider({
      apiKey: '',
      model: 'm',
      quality: 'low',
      unitPriceUsd: 0.005,
      verified: true,
      client,
    });
    const ref = { data: Buffer.from('x'), mimeType: 'image/png', name: 'r.png' };
    await expect(
      p.generate({ prompt: 'p', aspectRatio: '9:16', referenceImages: [ref, ref, ref, ref, ref] }),
    ).rejects.toThrow(/reference/);
  });
});

describe('imageSetupFromEnv', () => {
  it('defaults to the free mock and reports a missing key for openai', () => {
    expect(imageSetupFromEnv({})).toMatchObject({ provider: 'mock', paid: false, ready: true });
    expect(imageSetupFromEnv({ IMAGE_PROVIDER: 'openai' })).toMatchObject({
      provider: 'openai',
      model: 'gpt-image-2',
      quality: 'medium',
      ready: false,
      reason: 'OPENAI_API_KEY is not set',
    });
  });
});
