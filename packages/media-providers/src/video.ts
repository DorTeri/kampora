import {
  GenerationApprovalError,
  GenerationUnavailableError,
  type ImageToVideoCapabilities,
  type ImageToVideoProvider,
  type ImageToVideoQuote,
  type ImageToVideoRequest,
} from './contracts';

/** Image-to-video configuration. Only a quote-only provider exists until the image workflow is proven. */
export interface VideoSetup {
  provider: 'quote-only' | 'none';
  /** Catalog model used for the estimate. */
  model: string;
}

export function videoSetupFromEnv(env: NodeJS.ProcessEnv = process.env): VideoSetup {
  return env.VIDEO_PROVIDER === 'none'
    ? { provider: 'none', model: 'none' }
    : { provider: 'quote-only', model: 'image-to-video-standard' };
}

/**
 * Quotes image-to-video with a planning price, so the owner can see what real subject motion would cost, but
 * never generates. `submit` checks the approval first (the same contract a real vendor adapter must keep) and
 * then refuses: no video vendor is integrated or allowed yet.
 */
export class QuoteOnlyImageToVideoProvider implements ImageToVideoProvider {
  readonly id = 'quote-only';
  readonly paid = true;
  readonly capabilities: ImageToVideoCapabilities = {
    durationsSec: [5, 10],
    aspectRatios: ['9:16', '4:5', '1:1'],
  };

  constructor(
    readonly model: string,
    private readonly usdPerSecond: number,
  ) {}

  quote(request: Pick<ImageToVideoRequest, 'durationSec' | 'aspectRatio'>): ImageToVideoQuote {
    const durations = this.capabilities.durationsSec;
    const durationSec = durations.find((d) => d >= request.durationSec) ?? durations[durations.length - 1]!;
    return {
      provider: this.id,
      model: this.model,
      durationSec,
      estimatedUsd: Math.round(durationSec * this.usdPerSecond * 1_000_000) / 1_000_000,
      available: false,
      reason: 'Quote only: no image-to-video provider is enabled yet',
    };
  }

  async submit(
    request: ImageToVideoRequest,
    approval: { approvedUsd: number },
  ): Promise<{ externalJobId: string }> {
    const quote = this.quote(request);
    if (!(approval.approvedUsd + 1e-9 >= quote.estimatedUsd))
      throw new GenerationApprovalError(
        `Approve the estimated cost ($${quote.estimatedUsd.toFixed(2)}) first`,
      );
    throw new GenerationUnavailableError(quote.reason);
  }

  async poll(): Promise<never> {
    throw new GenerationUnavailableError('Quote-only provider has no jobs');
  }
}
