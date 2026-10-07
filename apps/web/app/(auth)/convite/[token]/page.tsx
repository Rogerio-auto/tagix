import type { Metadata } from 'next';
import { InviteScreen } from '@/features/invites/components/InviteScreen';

/**
 * `/convite/<token>` — o token é credencial: a página não vaza por Referer
 * (`<meta name="referrer" content="no-referrer">`), não é indexada nem guardada em cache.
 * A prova de posse do email chega no FRAGMENTO e é limpa pelo cliente ao montar.
 */
export const metadata: Metadata = {
  title: 'Convite — Leadium',
  referrer: 'no-referrer',
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-dynamic';

interface InvitePageProps {
  params: Promise<{ token: string }>;
}

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;
  return <InviteScreen token={token} />;
}
