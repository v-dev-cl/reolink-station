'use client';
import { useState } from 'react';
import { ApiError } from '@/lib/api';
import { PtzCommand, sendPtz } from '@/lib/live';

const BUTTONS: { command: PtzCommand; label: string }[] = [
  { command: 'up', label: 'Up' },
  { command: 'down', label: 'Down' },
  { command: 'left', label: 'Left' },
  { command: 'right', label: 'Right' },
  { command: 'in', label: 'Zoom in' },
  { command: 'out', label: 'Zoom out' },
  { command: 'stop', label: 'Stop' },
];

export default function PtzControls({ profileId }: { profileId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function move(command: PtzCommand) {
    setError(''); setBusy(true);
    try {
      await sendPtz(profileId, command);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403
        ? 'You need manage permission to control this camera'
        : 'Command failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
      <div className="grid grid-cols-4 gap-2">
        {BUTTONS.map((b) => (
          <button
            key={b.command}
            onClick={() => move(b.command)}
            disabled={busy}
            className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700 disabled:opacity-50"
          >
            {b.label}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
