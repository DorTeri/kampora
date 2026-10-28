import type { Metadata } from 'next';
import { Heebo } from 'next/font/google';
import './globals.css';

const heebo = Heebo({ subsets: ['hebrew', 'latin'], variable: '--font-heebo', display: 'swap' });

export const metadata: Metadata = {
  title: 'Kampora · סוכנות הפרסום החכמה',
  description: 'פרסומות וידאו לעסקים – מתיאור מטרה ועד סרטון מוכן',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={heebo.variable}>
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
