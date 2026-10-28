import Link from 'next/link';
import { SidebarNav, type NavItem } from '@/components/nav';
import { he } from '@/i18n/he';
import { api, type CampaignListItem } from '@/lib/api';

export const dynamic = 'force-dynamic';

function Logo() {
  return (
    <Link href="/studio" className="flex items-center gap-3" aria-label={he.brand.name}>
      <span
        aria-hidden
        className="grid size-10 place-items-center rounded-2xl bg-gradient-to-br from-primary to-accent text-lg font-black text-white shadow-[var(--shadow-lift)]"
      >
        K
      </span>
      <span className="leading-tight">
        <span className="block text-lg font-black tracking-tight" dir="ltr">
          Kampora
        </span>
        <span className="block text-xs text-muted">{he.brand.tagline}</span>
      </span>
    </Link>
  );
}

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const campaigns = await api<CampaignListItem[]>('/v1/campaigns').catch(() => []);
  const latest = campaigns[0];
  const latestProject = campaigns.find((c) => c.projectId);

  const items: NavItem[] = [
    { href: '/studio', label: he.nav.home, icon: '⌂', match: '/studio' },
    { href: '/studio/business', label: he.nav.business, icon: '◎', match: '/studio/business' },
    { href: '/studio/campaigns/new', label: he.nav.newCampaign, icon: '＋', match: '/studio/campaigns/new' },
    {
      href: latest ? `/studio/campaigns/${latest.id}` : null,
      label: he.nav.concepts,
      icon: '✦',
      match: '/studio/campaigns/',
      exclude: '/studio/campaigns/new',
    },
    {
      href: latestProject ? `/studio/projects/${latestProject.projectId}` : null,
      label: he.nav.planning,
      icon: '▤',
      match: '/studio/projects/',
    },
    {
      href: latestProject ? `/studio/projects/${latestProject.projectId}#production` : null,
      label: he.nav.production,
      icon: '▶',
      match: '/studio/production',
    },
    { href: '/studio/videos', label: he.nav.videos, icon: '▣', match: '/studio/videos' },
  ];

  return (
    <div className="mx-auto flex min-h-dvh max-w-[1440px] flex-col lg:flex-row">
      <aside className="sticky top-0 z-10 border-b border-line bg-canvas/90 px-4 py-3 backdrop-blur lg:h-dvh lg:w-72 lg:shrink-0 lg:border-b-0 lg:border-l lg:px-5 lg:py-8">
        <div className="mb-3 lg:mb-10">
          <Logo />
        </div>
        <SidebarNav items={items} />
      </aside>
      <main className="min-w-0 flex-1 px-4 py-8 sm:px-8 lg:px-12 lg:py-12">{children}</main>
    </div>
  );
}
