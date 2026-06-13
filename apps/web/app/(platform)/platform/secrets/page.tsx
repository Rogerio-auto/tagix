import { SecretsManager } from '@/features/platform-admin/secrets';

export const metadata = { title: 'Plataforma — Secrets' };

export default function PlatformSecretsPage() {
  return <SecretsManager />;
}
