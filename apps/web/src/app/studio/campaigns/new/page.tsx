import { PageHeader } from '@/components/ui';
import { he } from '@/i18n/he';
import { api, type BusinessSummary } from '@/lib/api';
import { CampaignForm } from './campaign-form';

export default async function NewCampaignPage() {
  const [business] = await api<BusinessSummary[]>('/v1/businesses');
  return (
    <div className="animate-rise mx-auto max-w-3xl">
      <PageHeader title={he.campaign.newTitle} subtitle={he.campaign.newSubtitle} />
      {business && <CampaignForm businessId={business.id} />}
    </div>
  );
}
