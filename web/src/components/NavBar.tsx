'use client';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useRouter } from 'next/navigation';

export default function NavBar() {
  const router = useRouter();
  async function logout() { await api.post('/auth/logout'); router.replace('/login'); }
  return (
    <nav className="flex items-center justify-between border-b border-neutral-800 px-6 py-3">
      <Link href="/" className="font-semibold">Reolink Station</Link>
      <button onClick={logout} className="text-sm text-neutral-400 hover:text-neutral-200">Sign out</button>
    </nav>
  );
}
