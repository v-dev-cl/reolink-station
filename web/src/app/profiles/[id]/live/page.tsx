'use client';
import { use } from 'react';
import NavBar from '@/components/NavBar';
import LivePlayer from '@/components/live/LivePlayer';
import PtzControls from '@/components/live/PtzControls';

export default function LivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <>
      <NavBar />
      <main className="mx-auto max-w-4xl space-y-4 p-6">
        <h1 className="text-xl font-semibold">Live</h1>
        <LivePlayer profileId={id} />
        <PtzControls profileId={id} />
      </main>
    </>
  );
}
