import Link from 'next/link';
import type { CameraProfile } from '@/lib/api';

export default function CameraCard({ profile }: { profile: CameraProfile }) {
  return (
    <Link href={`/profiles/${profile.id}`}
      className="block rounded-lg border border-neutral-800 bg-neutral-900 p-4 hover:border-neutral-600">
      <h3 className="font-medium">{profile.name}</h3>
      <p className="mt-1 text-sm text-neutral-400">{profile.storage.host}</p>
    </Link>
  );
}
