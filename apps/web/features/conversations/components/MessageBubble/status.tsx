/**
 * Camada de tempo real do status de entrega (read receipts) — F1-S20.
 *
 * O `StatusIcon` (F1-S15) renderiza o `view_status` ATUAL de cada mensagem. Este
 * módulo provê a camada que mantém esse ícone vivo: ao chegar
 * `message:status_changed` no socket compartilhado, faz patch do `viewStatus` da
 * mensagem no cache do TanStack Query (`['conversation', id, 'messages']`), e a
 * bolha re-renderiza com o novo ícone (clock → check → double-check → eye verde).
 *
 * Transporte-agnóstico: ouve `window.__hmSocket` (mesmo padrão de
 * `useConversationSocket`, S14) — sem acoplar a `socket.io-client` (que não é
 * dependência de @hm/web). Sem socket injetado, é um no-op silencioso (degrada
 * para "sem live receipts", sem quebrar build).
 *
 * Patch (em vez de invalidate): o payload do evento é totalmente tipado
 * (`MessageStatusChangedPayload {conversationId, messageId, status}`) e a
 * mutação é local e determinística (um campo de uma linha). Patch evita um
 * refetch de toda a página de mensagens a cada ack — receipts são de alta
 * frequência (sent→delivered→read por mensagem).
 *
 * Fronteira de slot: este arquivo EXPORTA o hook + o announcer; o `MessageBubble`
 * (S15, fora dos `files_allowed`) consome `useMessageStatusReceipts` no container
 * da timeline (ver relatório do slot). Não edita `MessageBubble.tsx`/
 * `StatusIcon.tsx`.
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { MessageStatusChangedPayload, ViewStatus } from '@hm/shared';
import { messagesKey } from '../../queries';
import type { MessageItem } from '../../types';

/**
 * Assinatura mínima de socket que os receipts precisam — tipada contra o mapa de
 * eventos de `@hm/shared`, sem acoplar a `socket.io-client`. Espelha o padrão de
 * `useConversationSocket` (a instância real é injetada em `window.__hmSocket`
 * pelo provider de real-time).
 */
export interface MessageStatusSocket {
  on(
    event: 'message:status_changed',
    listener: (p: MessageStatusChangedPayload) => void,
  ): unknown;
  off(
    event: 'message:status_changed',
    listener: (p: MessageStatusChangedPayload) => void,
  ): unknown;
}

function resolveSocket(): MessageStatusSocket | undefined {
  if (typeof window === 'undefined') return undefined;
  // `window.__hmSocket` é declarado por `useConversationSocket` (mesma instância).
  const candidate: unknown = window.__hmSocket;
  if (candidate === undefined || candidate === null) return undefined;
  return candidate as MessageStatusSocket;
}

/** Estado entregue ao announcer acessível (aria-live). */
export interface StatusAnnouncement {
  readonly messageId: string;
  readonly status: ViewStatus;
}

/** Rótulos pt-BR dos status para o leitor de tela (alinhados ao `StatusIcon`). */
const STATUS_LABEL: Record<ViewStatus, string> = {
  pending: 'Enviando',
  sent: 'Enviada',
  delivered: 'Entregue',
  read: 'Lida',
  failed: 'Falha no envio',
};

function statusLabel(status: ViewStatus): string {
  return STATUS_LABEL[status];
}

/** Aplica o novo `viewStatus` à mensagem-alvo dentro de uma página em cache. */
function patchMessages(
  data: { messages: MessageItem[] } | undefined,
  messageId: string,
  status: ViewStatus,
): { messages: MessageItem[] } | undefined {
  if (data === undefined) return data;
  let changed = false;
  const messages = data.messages.map((m) => {
    if (m.id !== messageId || m.viewStatus === status) return m;
    changed = true;
    return { ...m, viewStatus: status };
  });
  return changed ? { messages } : data;
}

export interface UseMessageStatusReceiptsOptions {
  /**
   * Conversa atualmente aberta. Recebido para escopar o patch ao cache certo e
   * ignorar receipts de outras conversas (o socket é compartilhado). Quando
   * `undefined`, o hook é um no-op (nenhuma timeline montada).
   */
  readonly conversationId: string | undefined;
  /**
   * Callback opcional para anunciar a mudança via aria-live (acessibilidade).
   * Tipicamente conectado ao `StatusAnnouncer` exportado abaixo.
   */
  readonly onAnnounce?: (announcement: StatusAnnouncement) => void;
}

/**
 * Mantém os ícones de status da timeline vivos em tempo real (LIVECHAT.md §6).
 *
 * Faz patch do `viewStatus` da mensagem no cache de
 * `['conversation', conversationId, 'messages']` a cada `message:status_changed`
 * da conversa aberta. Sem socket injetado, é no-op.
 */
export function useMessageStatusReceipts(options: UseMessageStatusReceiptsOptions): void {
  const { conversationId, onAnnounce } = options;
  const queryClient = useQueryClient();

  // Mantém o callback estável sem re-assinar o socket a cada render.
  const announceRef = useRef<UseMessageStatusReceiptsOptions['onAnnounce']>(onAnnounce);
  announceRef.current = onAnnounce;

  useEffect(() => {
    if (conversationId === undefined) return;
    const socket = resolveSocket();
    if (socket === undefined) return;

    const onStatusChanged = (p: MessageStatusChangedPayload): void => {
      if (p.conversationId !== conversationId) return;

      const key = messagesKey(conversationId);
      const next = patchMessages(
        queryClient.getQueryData<{ messages: MessageItem[] }>(key),
        p.messageId,
        p.status,
      );
      // `setQueryData` só dispara render se a referência mudar (patch retorna a
      // mesma quando não houve alteração — evita re-render redundante).
      queryClient.setQueryData(key, next);

      announceRef.current?.({ messageId: p.messageId, status: p.status });
    };

    socket.on('message:status_changed', onStatusChanged);
    return () => {
      socket.off('message:status_changed', onStatusChanged);
    };
  }, [conversationId, queryClient]);
}

/**
 * Região aria-live discreta que anuncia a última mudança de status ao leitor de
 * tela (UX: mudanças de estado assíncronas devem ser percebidas sem foco). Não
 * desenha nada visível — o ícone (S15) já é a affordance visual. `polite` para
 * não interromper a leitura em curso.
 *
 * Uso: o container da timeline mantém um `useState<StatusAnnouncement | null>`,
 * passa o setter como `onAnnounce` para `useMessageStatusReceipts` e renderiza
 * `<StatusAnnouncer announcement={…} />`.
 */
export function StatusAnnouncer({
  announcement,
}: {
  announcement: StatusAnnouncement | null;
}) {
  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only" role="status">
      {announcement !== null ? `Mensagem ${statusLabel(announcement.status)}` : ''}
    </div>
  );
}

/**
 * Variante self-contained: combina o hook + o announcer num único componente
 * invisível, para quem só quer plugar receipts sem gerenciar estado de anúncio.
 * Renderiza apenas a região aria-live.
 */
export function MessageStatusReceipts({
  conversationId,
}: {
  conversationId: string | undefined;
}) {
  const [announcement, setAnnouncement] = useState<StatusAnnouncement | null>(null);
  useMessageStatusReceipts({ conversationId, onAnnounce: setAnnouncement });
  return <StatusAnnouncer announcement={announcement} />;
}
