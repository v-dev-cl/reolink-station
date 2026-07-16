'use client';
import { useState } from 'react';
import { api, MaskedCamera, MaskedStorage } from '@/lib/api';

type Initial = { name: string; storage: MaskedStorage; camera: MaskedCamera };

export default function ProfileForm(props:
  | { mode: 'create'; onDone: () => void }
  | { mode: 'edit'; profileId: string; initial: Initial; onDone: () => void }) {
  const init = props.mode === 'edit' ? props.initial : undefined;
  const [name, setName] = useState(init?.name ?? '');
  const [host, setHost] = useState(init?.storage.host ?? '');
  const [port, setPort] = useState(String(init?.storage.port ?? 21));
  const [sUser, setSUser] = useState(init?.storage.user ?? '');
  const [sPass, setSPass] = useState('');
  const [basePath, setBasePath] = useState(init?.storage.basePath ?? '');
  const [uid, setUid] = useState(init?.camera.uid ?? '');
  const [cPass, setCPass] = useState('');
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError('');
    const storage: Record<string, unknown> = { host, port: Number(port), user: sUser, basePath };
    const camera: Record<string, unknown> = { uid };
    if (sPass) storage.pass = sPass;           // blank = keep stored (edit) / required by API (create)
    if (cPass) camera.password = cPass;
    try {
      if (props.mode === 'create') await api.post('/camera-profiles', { name, storage, camera });
      else await api.patch(`/camera-profiles/${props.profileId}`, { name, storage, camera });
      props.onDone();
    } catch { setError('Could not save'); }
  }

  const editing = props.mode === 'edit';
  const secretPlaceholder = editing ? 'leave blank to keep' : '';
  return (
    <form onSubmit={submit} className="mx-auto flex max-w-md flex-col gap-3 p-6">
      <Field label="Name" value={name} onChange={setName} required />
      <Field label="Host" value={host} onChange={setHost} required />
      <Field label="Port" value={port} onChange={setPort} />
      <Field label="Storage user" value={sUser} onChange={setSUser} required />
      <Field label="Storage password" value={sPass} onChange={setSPass} type="password" placeholder={secretPlaceholder} required={!editing} />
      <Field label="Base path" value={basePath} onChange={setBasePath} required />
      <Field label="Camera UID" value={uid} onChange={setUid} required />
      <Field label="Camera password" value={cPass} onChange={setCPass} type="password" placeholder={secretPlaceholder} required={!editing} />
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <button className="rounded bg-blue-600 py-2">Save</button>
    </form>
  );
}

function Field({ label, value, onChange, type = 'text', required, placeholder }:
  { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean; placeholder?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">{label}
      <input aria-label={label} type={type} value={value} placeholder={placeholder} required={required}
        onChange={(e) => onChange(e.target.value)} className="rounded bg-neutral-800 px-3 py-2" />
    </label>
  );
}
