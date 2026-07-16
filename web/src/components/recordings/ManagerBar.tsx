'use client';
import { useState } from 'react';
import { ApiError } from '@/lib/api';
import { deleteRecordings, pruneRecordings } from '@/lib/recordings';

export default function ManagerBar({ profileId, selected, onMutated }: {
  profileId: string;
  selected: string[];
  onMutated: () => void;
}) {
  const [days, setDays] = useState('30');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<{ deleted: number }>) {
    setError(''); setMsg(''); setBusy(true);
    try {
      const { deleted } = await fn();
      setMsg(`Deleted ${deleted} file${deleted === 1 ? '' : 's'}`);
      onMutated();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403
        ? 'You need manage permission to delete recordings'
        : 'Operation failed');
    } finally {
      setBusy(false);
    }
  }

  async function del() {
    if (!selected.length) return;
    if (!window.confirm(`Delete ${selected.length} selected file(s)? This cannot be undone.`)) return;
    await run(() => deleteRecordings(profileId, selected));
  }

  async function prune() {
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1) { setError('Days must be a whole number of at least 1'); return; }
    if (!window.confirm(`Delete ALL recordings older than ${n} days? This cannot be undone.`)) return;
    await run(() => pruneRecordings(profileId, n));
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900 p-3">
      <button
        onClick={del}
        disabled={busy || selected.length === 0}
        className="rounded bg-red-700 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
      >
        Delete selected ({selected.length})
      </button>
      <div className="flex items-center gap-2 text-sm">
        <label htmlFor="prune-days">Older than</label>
        <input
          id="prune-days"
          aria-label="Older than days"
          type="number"
          min={1}
          value={days}
          onChange={(e) => setDays(e.target.value)}
          className="w-20 rounded bg-neutral-800 px-2 py-1"
        />
        <span>days</span>
        <button onClick={prune} disabled={busy} className="rounded bg-red-900 px-3 py-1.5 disabled:opacity-50">
          Prune
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {msg && <p className="text-sm text-green-400">{msg}</p>}
    </div>
  );
}
