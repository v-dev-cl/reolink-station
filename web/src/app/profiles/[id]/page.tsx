'use client';
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, CameraProfile } from '@/lib/api';
import ProfileForm from '@/components/ProfileForm';
import SharePanel from '@/components/SharePanel';
import NavBar from '@/components/NavBar';

export default function ProfileDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [p, setP] = useState<CameraProfile | null>(null);
  const [status, setStatus] = useState<'loading' | 'error' | 'ok'>('loading');
  useEffect(() => {
    api.get<CameraProfile>(`/camera-profiles/${id}`)
      .then((res) => { setP(res); setStatus('ok'); })
      .catch(() => setStatus('error'));
  }, [id]);
  if (status === 'loading') return <><NavBar /><main className="p-6 text-neutral-400">Loading…</main></>;
  if (status === 'error' || !p) return <><NavBar /><main className="p-6 text-neutral-400" role="alert">This camera couldn’t be loaded — it may not exist or you may not have access.</main></>;
  return (
    <>
      <NavBar />
      <main className="mx-auto max-w-md">
        <h1 className="px-6 pt-6 text-xl font-semibold">{p.name}</h1>
        <Link
          href={`/profiles/${id}/recordings`}
          className="mx-6 mt-2 inline-block rounded bg-blue-600 px-3 py-1.5 text-sm"
        >
          View recordings →
        </Link>
        <Link
          href={`/profiles/${id}/live`}
          className="mx-6 mt-2 inline-block rounded bg-blue-600 px-3 py-1.5 text-sm"
        >
          Live view →
        </Link>
        <ProfileForm mode="edit" profileId={id} initial={p} onDone={() => router.replace('/')} />
        <SharePanel profileId={id} />
      </main>
    </>
  );
}
