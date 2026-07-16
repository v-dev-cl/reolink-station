'use client';
import { use } from 'react';
import NavBar from '@/components/NavBar';
import RecordingsBrowser from '@/components/recordings/RecordingsBrowser';

export default function RecordingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <>
      <NavBar />
      <main className="mx-auto max-w-5xl p-6">
        <h1 className="mb-4 text-xl font-semibold">Recordings</h1>
        <RecordingsBrowser profileId={id} />
      </main>
    </>
  );
}
