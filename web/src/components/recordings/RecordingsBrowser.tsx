'use client';
import { useCallback, useEffect, useState } from 'react';
import { listRecordings, RecordingEntry } from '@/lib/recordings';
import RecordingTile from './RecordingTile';
import PlayerModal from './PlayerModal';
import ManagerBar from './ManagerBar';

export default function RecordingsBrowser({ profileId }: { profileId: string }) {
  const [dir, setDir] = useState('');
  const [entries, setEntries] = useState<RecordingEntry[] | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<RecordingEntry | null>(null);

  const refresh = useCallback(() => {
    setEntries(null);
    setError('');
    listRecordings(profileId, dir)
      .then(setEntries)
      .catch(() => { setError('Could not load recordings'); setEntries([]); });
  }, [profileId, dir]);

  useEffect(() => { setSelected(new Set()); refresh(); }, [refresh]);

  const dirs = (entries ?? []).filter((e) => e.type === 'dir').sort((a, b) => b.name.localeCompare(a.name));
  const files = (entries ?? []).filter((e) => e.type === 'file').sort((a, b) => b.mtime - a.mtime);
  const crumbs = dir ? dir.split('/') : [];

  function toggle(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-neutral-400">
        <button onClick={() => setDir('')} className="hover:text-neutral-200">Recordings</button>
        {crumbs.map((seg, i) => (
          <span key={crumbs.slice(0, i + 1).join('/')} className="flex items-center gap-1">
            <span>/</span>
            <button onClick={() => setDir(crumbs.slice(0, i + 1).join('/'))} className="hover:text-neutral-200">
              {seg}
            </button>
          </span>
        ))}
      </nav>

      {entries === null && <p className="text-neutral-400">Loading…</p>}
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {entries?.length === 0 && !error && <p className="text-neutral-400">No recordings in this folder.</p>}

      {dirs.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {dirs.map((d) => (
            <button
              key={d.path}
              aria-label={`Open folder ${d.name}`}
              onClick={() => setDir(d.path)}
              className="rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-2 text-sm hover:border-neutral-600"
            >
              📁 {d.name}
            </button>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {files.map((f) => (
              <RecordingTile
                key={f.path}
                profileId={profileId}
                entry={f}
                selected={selected.has(f.path)}
                onToggle={() => toggle(f.path)}
                onOpen={() => setOpen(f)}
              />
            ))}
          </div>
          <ManagerBar
            profileId={profileId}
            selected={[...selected]}
            onMutated={() => { setSelected(new Set()); refresh(); }}
          />
        </>
      )}

      {open && <PlayerModal profileId={profileId} entry={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
