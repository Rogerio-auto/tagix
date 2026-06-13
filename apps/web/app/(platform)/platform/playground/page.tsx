import { Suspense } from 'react';
import { AgentPlayground } from '@/features/platform-admin/playground';

export const metadata = { title: 'Plataforma — Playground' };

export default function PlatformPlaygroundPage() {
  return (
    <Suspense fallback={null}>
      <AgentPlayground />
    </Suspense>
  );
}
