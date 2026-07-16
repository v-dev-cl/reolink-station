'use client';
import { isImage, isVideo, recordingFileUrl, RecordingEntry } from '@/lib/recordings';

export default function RecordingTile({ profileId, entry, selected, onToggle, onOpen }: {
  profileId: string;
  entry: RecordingEntry;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="relative rounded-lg border border-neutral-800 bg-neutral-900 p-2">
      <input
        aria-label={`Select ${entry.name}`}
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        className="absolute left-3 top-3 z-10 h-4 w-4 accent-blue-600"
      />
      <button aria-label={`Open ${entry.name}`} onClick={onOpen} className="block w-full">
        {isImage(entry.name) ? (
          // eslint-disable-next-line @next/next/no-img-element -- authenticated same-origin media; next/image optimization would break the cookie flow
          <img
            src={recordingFileUrl(profileId, entry.path)}
            alt={entry.name}
            loading="lazy"
            className="h-28 w-full rounded object-cover"
          />
        ) : isVideo(entry.name) ? (
          <div className="flex h-28 w-full items-center justify-center rounded bg-neutral-800 text-3xl">▶</div>
        ) : (
          <div className="flex h-28 w-full items-center justify-center rounded bg-neutral-800 text-3xl">📄</div>
        )}
      </button>
      <p className="mt-1 truncate text-xs text-neutral-400">{entry.name}</p>
    </div>
  );
}
