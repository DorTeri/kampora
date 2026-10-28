import { PageHeader } from '@/components/ui';
import { he } from '@/i18n/he';
import { formatIls } from '@kampora/shared';
import { USD_TO_ILS, api, type BusinessSummary, type CreativeQuote } from '@/lib/api';
import { CampaignForm } from './campaign-form';

export default async function NewCampaignPage() {
  const [[business], quote] = await Promise.all([
    api<BusinessSummary[]>('/v1/businesses'),
    api<CreativeQuote>('/v1/creative/quote'),
  ]);
  const ai = {
    paid: quote.paid,
    ready: quote.ready,
    maxUsd: quote.maxUsd,
    maxIls: formatIls(quote.maxUsd * USD_TO_ILS),
  };
  return (
    <div className="animate-rise mx-auto max-w-3xl">
      <PageHeader title={he.campaign.newTitle} subtitle={he.campaign.newSubtitle} />
      {business && <CampaignForm businessId={business.id} ai={ai} />}
    </div>
  );
}
