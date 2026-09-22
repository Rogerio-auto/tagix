import { MessageTemplatesPage } from '@/features/channels/message-templates';
import { PageContainer } from '@/shared/components/layout';

export const metadata = { title: 'Modelos de mensagem do WhatsApp · Configurações' };

export default async function ChannelMessageTemplatesRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PageContainer><MessageTemplatesPage channelId={id} /></PageContainer>;
}
