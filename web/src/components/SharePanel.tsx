'use client';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';

export default function SharePanel({ profileId }: { profileId: string }) {
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState<'view' | 'manage'>('view');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  async function share(e: React.FormEvent) {
    e.preventDefault(); setError(''); setMsg('');
    try {
      await api.post(`/camera-profiles/${profileId}/shares`, { email, permission });
      setMsg(`Shared with ${email}`); setEmail('');
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403 ? 'You need manage permission to share'
        : err instanceof ApiError && err.status === 404 ? 'No user with that email' : 'Could not share');
    }
  }

  return (
    <section className="border-t border-neutral-800 p-6">
      <h2 className="mb-2 font-medium">Sharing</h2>
      <form onSubmit={share} className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-sm">Share with email
          <input aria-label="Share with email" type="email" value={email} required
            onChange={(e) => setEmail(e.target.value)} className="rounded bg-neutral-800 px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">Permission
          <select aria-label="Permission" value={permission}
            onChange={(e) => setPermission(e.target.value as 'view' | 'manage')} className="rounded bg-neutral-800 px-3 py-2">
            <option value="view">View</option>
            <option value="manage">Manage</option>
          </select>
        </label>
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        {msg && <p className="text-sm text-green-400">{msg}</p>}
        <button className="rounded bg-blue-600 py-2">Share</button>
      </form>
    </section>
  );
}
