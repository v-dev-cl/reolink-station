'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, CameraProfile } from '@/lib/api';
import CameraCard from '@/components/CameraCard';
import NavBar from '@/components/NavBar';

export default function Home() {
  const [profiles, setProfiles] = useState<CameraProfile[] | null>(null);
  useEffect(() => { api.get<CameraProfile[]>('/camera-profiles').then(setProfiles).catch(() => setProfiles([])); }, []);
  return (
    <>
      <NavBar />
      <main data-testid="home" className="mx-auto max-w-4xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Cameras</h1>
          <Link href="/profiles/new" className="rounded bg-blue-600 px-3 py-1.5 text-sm">Add camera</Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {(profiles ?? []).map((p) => <CameraCard key={p.id} profile={p} />)}
        </div>
        {profiles?.length === 0 && <p className="text-neutral-400">No cameras yet.</p>}
      </main>
    </>
  );
}
