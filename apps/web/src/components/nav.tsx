'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from './ui';

export interface NavItem {
  href: string | null;
  label: string;
  icon: string;
  /** Path prefix that marks this item active. */
  match: string;
  /** Path prefix that must NOT match (e.g. /studio/campaigns/new is its own item). */
  exclude?: string;
}

export function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="ניווט ראשי" className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
      {items.map((item) => {
        const active =
          item.match === '/studio'
            ? pathname === '/studio'
            : pathname.startsWith(item.match) && !(item.exclude && pathname.startsWith(item.exclude));
        const content = (
          <>
            <span
              aria-hidden
              className={cn(
                'grid size-8 shrink-0 place-items-center rounded-xl text-base',
                active ? 'bg-white/15' : 'bg-ink/5',
              )}
            >
              {item.icon}
            </span>
            <span className="whitespace-nowrap">{item.label}</span>
          </>
        );
        const base = 'flex min-h-11 items-center gap-3 rounded-2xl px-3 text-[15px] font-semibold transition';
        if (!item.href) {
          return (
            <span key={item.label} aria-disabled className={cn(base, 'cursor-not-allowed text-muted/70')}>
              {content}
            </span>
          );
        }
        return (
          <Link
            key={item.label}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              base,
              active
                ? 'bg-ink text-white shadow-[var(--shadow-card)]'
                : 'text-ink-soft hover:bg-ink/5 hover:text-ink',
            )}
          >
            {content}
          </Link>
        );
      })}
    </nav>
  );
}
