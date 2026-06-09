import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getServerSession } from '@/shared/lib/supabase-server';
import { AppLayout } from '@/shared/components/layout/AppLayout';

export default async function AppGroupLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession();
  if (!session) redirect('/login');
  return <AppLayout>{children}</AppLayout>;
}
