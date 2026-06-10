import { ConversationsLayout } from '@/features/conversations/components/ConversationsLayout';

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ConversationsLayout conversationId={id} />;
}
