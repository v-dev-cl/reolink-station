'use client';
import { useCallback, useState } from 'react';
import { liveStreamUrl } from '@/lib/live';

export default function LivePlayer({ profileId }: { profileId: string }) {
  const [errored, setErrored] = useState(false);
  const [key, setKey] = useState(0);

  function retry() { setErrored(false); setKey((k) => k + 1); }

  // React sets `muted` as a DOM property (not an HTML attribute) on <video>,
  // by design, to avoid autoplay-policy races. Explicitly mirror it onto the
  // attribute so it's reliably present (e.g. for tooling/tests that inspect
  // the attribute, and so it's visible in the serialized DOM).
  const setMutedAttr = useCallback((node: HTMLVideoElement | null) => {
    node?.setAttribute('muted', '');
  }, []);

  if (errored) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-lg bg-neutral-900">
        <p role="alert" className="text-sm text-neutral-300">
          Couldn&apos;t load the live stream. The camera may be offline or still connecting.
        </p>
        <button onClick={retry} className="rounded bg-blue-600 px-3 py-1.5 text-sm">Retry</button>
      </div>
    );
  }

  return (
    <video
      key={key}
      ref={setMutedAttr}
      data-testid="live-video"
      src={liveStreamUrl(profileId)}
      controls
      autoPlay
      muted
      playsInline
      onError={() => setErrored(true)}
      className="w-full rounded-lg bg-black"
    />
  );
}
