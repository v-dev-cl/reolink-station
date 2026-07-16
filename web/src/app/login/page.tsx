'use client';
import { useRouter } from 'next/navigation';
import LoginForm from '@/components/LoginForm';

export default function LoginPage() {
  const router = useRouter();
  return <LoginForm onSuccess={() => router.replace('/')} />;
}
