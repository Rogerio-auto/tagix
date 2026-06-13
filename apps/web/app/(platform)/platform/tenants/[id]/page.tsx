import { Workspace360 } from '@/features/platform-admin/tenants';

export const metadata = { title: 'Plataforma — Workspace 360' };

export default async function PlatformTenant360Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <Workspace360 id={id} />;
}
