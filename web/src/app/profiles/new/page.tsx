'use client';
import { useRouter } from 'next/navigation';
import ProfileForm from '@/components/ProfileForm';
import NavBar from '@/components/NavBar';

export default function NewProfile() {
  const router = useRouter();
  return <><NavBar /><ProfileForm mode="create" onDone={() => router.replace('/')} /></>;
}
