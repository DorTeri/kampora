import { PageHeader } from '@/components/ui';
import { api, type VoiceLabOverview } from '@/lib/api';
import { VoiceLab } from './voice-lab';

export const dynamic = 'force-dynamic';

/** Internal: compare voice configurations on the same script by listening, and record ratings. */
export default async function VoiceLabPage() {
  const overview = await api<VoiceLabOverview>('/v1/voice-lab');
  return (
    <div className="animate-rise">
      <PageHeader
        title="מעבדת קולות (פנימי)"
        subtitle="אותו תסריט בכמה קולות והגדרות. ההשוואה נעשית בהאזנה – הדירוגים כאן הם של אנשים, לא של המערכת."
      />
      <VoiceLab initial={overview} usdToIls={Number(process.env.DISPLAY_USD_TO_ILS ?? 3.7)} />
    </div>
  );
}
