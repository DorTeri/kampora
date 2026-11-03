'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button, ErrorNote } from '@/components/ui';
import { errorMessage, he } from '@/i18n/he';

const ACCEPT = 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime';

/** The owner's own photo or clip: what it shows decides which scenes and ads can use it. */
export function MediaUpload({ businessId }: { businessId: string }) {
  const t = he.business.upload;
  const router = useRouter();
  const [file, setFile] = useState<File>();
  const [subject, setSubject] = useState('product');
  const [description, setDescription] = useState('');
  const [rights, setRights] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      if (!file) return;
      setError(undefined);
      setDone(false);
      const query = new URLSearchParams({ subject, description, rights: String(rights) });
      const res = await fetch(`/api/businesses/${businessId}/assets?${query}`, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { code?: string } | null;
        setError(errorMessage(json?.code));
        return;
      }
      setFile(undefined);
      setDescription('');
      setDone(true);
      router.refresh();
    });

  return (
    <div className="mt-4 space-y-3 rounded-2xl bg-ink/[0.03] p-4 text-sm">
      <p className="font-bold">{t.title}</p>
      <input
        type="file"
        accept={ACCEPT}
        onChange={(e) => setFile(e.target.files?.[0] ?? undefined)}
        className="block w-full text-sm"
      />
      <label className="block">
        <span className="font-semibold">{t.subject}</span>
        <select value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1 block w-full rounded-xl border border-line bg-white px-3 py-2">
          {Object.entries(t.subjects).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="font-semibold">{t.description}</span>
        <input
          value={description}
          maxLength={200}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t.descriptionPlaceholder}
          className="mt-1 block w-full rounded-xl border border-line bg-white px-3 py-2"
        />
      </label>
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-1" />
        <span>{t.rights}</span>
      </label>
      <p className="text-xs text-muted">{t.limits}</p>
      {error && <ErrorNote message={error} />}
      {done && <p className="text-success">{t.done}</p>}
      <Button type="button" disabled={!file || !rights || pending} onClick={submit}>
        {pending ? t.sending : t.submit}
      </Button>
    </div>
  );
}
