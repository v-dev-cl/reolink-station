'use client';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';

export default function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await api.post('/auth/login', { email, password });
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'Invalid credentials' : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto mt-24 flex w-80 flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">Email
        <input aria-label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          required className="rounded bg-neutral-800 px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1 text-sm">Password
        <input aria-label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          required className="rounded bg-neutral-800 px-3 py-2" />
      </label>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <button disabled={busy} className="rounded bg-blue-600 py-2 font-medium disabled:opacity-50">Sign in</button>
    </form>
  );
}
