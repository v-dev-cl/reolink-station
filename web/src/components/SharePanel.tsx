'use client';
// Stub for Task 5 (sharing panel). Renders a placeholder so /profiles/[id] builds and
// renders correctly ahead of Task 5, which will replace this with the real share list
// (list/add/revoke shares via GET/POST/DELETE /camera-profiles/:id/shares).
export default function SharePanel({ profileId }: { profileId: string }) {
  void profileId;
  return (
    <section className="mx-auto max-w-md px-6 pb-6">
      <h2 className="text-sm font-medium text-neutral-400">Sharing</h2>
      <p className="mt-1 text-sm text-neutral-500">Coming soon.</p>
    </section>
  );
}
