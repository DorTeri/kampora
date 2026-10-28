import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function PageHeader({
  title,
  subtitle,
  action,
  eyebrow,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        {eyebrow && <div className="mb-2">{eyebrow}</div>}
        <h1 className="text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-2 text-base leading-relaxed text-ink-soft">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

export function Card({ className, children, ...rest }: ComponentProps<'section'>) {
  return (
    <section
      className={cn(
        'rounded-[var(--radius-card)] border border-line bg-surface p-6 shadow-[var(--shadow-card)]',
        className,
      )}
      {...rest}
    >
      {children}
    </section>
  );
}

export function CardTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-bold text-ink">{children}</h2>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
    </div>
  );
}

const buttonStyles = {
  primary:
    'bg-primary text-white shadow-[var(--shadow-lift)] hover:bg-primary-ink focus-visible:outline-primary disabled:bg-primary/50 disabled:shadow-none',
  secondary: 'border border-line bg-surface text-ink hover:border-ink/30 focus-visible:outline-ink',
  ghost: 'text-ink-soft hover:bg-ink/5 focus-visible:outline-ink',
};

export function Button({
  variant = 'primary',
  className,
  ...rest
}: ComponentProps<'button'> & { variant?: keyof typeof buttonStyles }) {
  return (
    <button
      className={cn(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-6 text-[15px] font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed',
        buttonStyles[variant],
        className,
      )}
      {...rest}
    />
  );
}

export function ButtonLink({
  variant = 'primary',
  className,
  ...rest
}: ComponentProps<typeof Link> & { variant?: keyof typeof buttonStyles }) {
  return (
    <Link
      className={cn(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-6 text-[15px] font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2',
        buttonStyles[variant],
        className,
      )}
      {...rest}
    />
  );
}

const badgeTones = {
  primary: 'bg-primary-soft text-primary-ink',
  accent: 'bg-accent-soft text-[#c2410c]',
  success: 'bg-success-soft text-success',
  warn: 'bg-warn-soft text-warn',
  neutral: 'bg-ink/5 text-ink-soft',
};

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: keyof typeof badgeTones;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold',
        badgeTones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm font-medium text-[#9a3412]"
    >
      {message}
    </p>
  );
}

export function EmptyState({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-[var(--radius-card)] border border-dashed border-line bg-surface/60 px-6 py-12 text-center">
      <div
        aria-hidden
        className="grid size-14 place-items-center rounded-2xl bg-primary-soft text-2xl text-primary"
      >
        ✦
      </div>
      <p className="max-w-sm text-ink-soft">{title}</p>
      {action}
    </div>
  );
}

/** Wraps LTR fragments (prices, URLs, English) so they keep their own direction inside Hebrew text. */
export function Ltr({ children }: { children: ReactNode }) {
  return <bdi className="ltr-isolate">{children}</bdi>;
}
