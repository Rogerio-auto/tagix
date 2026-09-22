'use client';

import Link from 'next/link';
import { Button } from '@hm/ui';
import { ErrorState, SkeletonList } from '@/shared/components/feedback';
import { useChannels } from '../queries';
import { MessageTemplatesCatalog } from './MessageTemplatesCatalog';

export function MessageTemplatesPage({ channelId }: { channelId: string }) {
  const channels = useChannels();
  if (channels.isLoading) return <SkeletonList rows={5} />;
  if (channels.isError) return <ErrorState title="Não foi possível carregar o canal" reason="A conexão com a API falhou ou expirou." whatToDo="Tente novamente antes de abrir os modelos." action={<Button variant="secondary" onClick={() => void channels.refetch()}>Tentar novamente</Button>} />;
  const channel = channels.data?.channels.find((item) => item.id === channelId);
  if (!channel) return <ErrorState title="Canal não encontrado" reason="Ele pode ter sido removido ou pertencer a outro workspace." whatToDo="Volte para a lista e escolha um canal disponível." action={<Link href="/settings/channels" className="inline-flex h-10 items-center rounded-md bg-surface-2 px-4 font-head text-sm font-semibold text-text outline-none hover:bg-surface-3 focus-visible:shadow-glow-md">Ver canais</Link>} />;
  return <MessageTemplatesCatalog channel={channel} />;
}
