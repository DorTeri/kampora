import Link from 'next/link';
import { Badge, Card, PageHeader } from '@/components/ui';
import { DEMO } from '@/lib/demo-cases';
import { DEMO_MODE } from '@/lib/review';

export const metadata = { title: 'Kampora · סקירת קריאייטיב' };

export default function ReviewIndex() {
  return (
    <div className="animate-rise">
      <PageHeader
        title="סקירת קריאייטיב"
        subtitle="שלושה כיווני עיצוב לכל קונספט, עם נימוק, השראות, ממצאי בדיקה, היסטוריית תיקונים ואישור. בקשות שינוי בעברית חופשית."
        eyebrow={
          <div className="flex flex-wrap gap-2">
            {DEMO_MODE ? <Badge tone="warn">מצב הדגמה · בלי שרת</Badge> : null}
            <Badge tone="success">יצירה בתשלום כבויה</Badge>
          </div>
        }
      />
      <div className="grid gap-5 md:grid-cols-2">
        {DEMO.cases.map((c) => {
          const chosen = c.concepts.find((x) => x.chosen) ?? c.concepts[0]!;
          const rec = c.directions.find((d) => d.key === c.review.set.recommended);
          return (
            <Link key={c.id} href={`/studio/review/${c.id}`} className="group">
              <Card className="h-full transition group-hover:border-ink/30">
                <div className="flex gap-4">
                  {rec?.renders['4:5'] ? (
                    <img src={`/demo-media/${rec.renders['4:5']}`} alt="" className="w-28 shrink-0 rounded-xl bg-canvas object-cover sm:w-36" />
                  ) : null}
                  <div>
                    <p className="text-xs font-bold text-muted">
                      {c.business.category}
                      {c.business.city ? ` · ${c.business.city}` : ''}
                    </p>
                    <h2 className="mt-1 text-xl font-black">
                      <bdi>{c.business.name}</bdi>
                    </h2>
                    <p className="mt-1 font-semibold">{chosen.title}</p>
                    <p className="mt-2 text-sm text-ink-soft">{c.brief.offer ?? c.brief.keyMessage}</p>
                    <p className="mt-3 text-sm font-bold text-primary">לסקירה ←</p>
                  </div>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
      <p className="mt-8 max-w-3xl text-sm text-muted">{DEMO.provenance}</p>
    </div>
  );
}
