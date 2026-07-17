'use client';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { PtzCommand, sendPtz } from '@/lib/live';

const MOVES: { command: PtzCommand; label: string }[] = [
  { command: 'up', label: 'Up' },
  { command: 'down', label: 'Down' },
  { command: 'left', label: 'Left' },
  { command: 'right', label: 'Right' },
  { command: 'in', label: 'Zoom in' },
  { command: 'out', label: 'Zoom out' },
];

export default function PtzControls({ profileId }: { profileId: string }) {
  const [error, setError] = useState('');
  // Ref, not state: the unmount cleanup must see the latest value.
  const movingRef = useRef(false);

  function report(err: unknown) {
    setError(err instanceof ApiError && err.status === 403
      ? 'You need manage permission to control this camera'
      : 'Command failed');
  }

  function start(command: PtzCommand) {
    setError('');
    movingRef.current = true;
    sendPtz(profileId, command).catch(report);
  }

  function release() {
    if (!movingRef.current) return;
    movingRef.current = false;
    sendPtz(profileId, 'stop').catch(report);
  }

  function hardStop() {
    setError('');
    movingRef.current = false;
    sendPtz(profileId, 'stop').catch(report);
  }

  useEffect(() => {
    return () => {
      // The camera moves until it receives 'stop' — never leave it moving on navigation.
      if (movingRef.current) void sendPtz(profileId, 'stop').catch(() => undefined);
    };
  }, [profileId]);

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
      <div className="grid grid-cols-4 gap-2">
        {MOVES.map((b) => (
          <button
            key={b.command}
            onPointerDown={() => start(b.command)}
            onPointerUp={release}
            onPointerLeave={release}
            onPointerCancel={release}
            onKeyDown={(e) => { if (!e.repeat && (e.key === 'Enter' || e.key === ' ')) start(b.command); }}
            onKeyUp={(e) => { if (e.key === 'Enter' || e.key === ' ') release(); }}
            className="touch-none select-none rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700"
          >
            {b.label}
          </button>
        ))}
        <button
          onClick={hardStop}
          className="rounded bg-red-900/70 px-3 py-2 text-sm font-medium hover:bg-red-800/70"
        >
          Stop
        </button>
      </div>
      <p className="mt-2 text-xs text-neutral-500">Hold a button to move; release to stop.</p>
      {error && <p role="alert" className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
