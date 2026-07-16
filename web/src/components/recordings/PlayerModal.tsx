'use client';
import { isImage, recordingFileUrl, RecordingEntry } from '@/lib/recordings';

export default function PlayerModal({ profileId, entry, onClose }: {
  profileId: string;
  entry: RecordingEntry;
  onClose: () => void;
}) {
  const url = recordingFileUrl(profileId, entry.path);
  return (
    <div
      role="dialog"
      aria-label={entry.name}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div className="max-h-full w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
        {isImage(entry.name) ? (
          // eslint-disable-next-line @next/next/no-img-element -- authenticated same-origin media
          <img src={url} alt={entry.name} className="mx-auto max-h-[80vh] rounded" />
        ) : (
          <video data-testid="player" src={url} controls autoPlay className="mx-auto max-h-[80vh] w-full rounded" />
        )}
        <div className="mt-2 flex items-center justify-between text-sm text-neutral-300">
          <span className="truncate">{entry.name}</span>
          <button onClick={onClose} className="rounded bg-neutral-800 px-3 py-1 hover:bg-neutral-700">Close</button>
        </div>
      </div>
    </div>
  );
}
