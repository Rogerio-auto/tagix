/**
 * De "chegou mensagem" para "avise o dono" (F61-S04).
 *
 * ## Por que o gancho fica no relay, e não no worker
 *
 * O worker de inbound já publica `message:new` na fila `hm.q.socket.relay`, que a
 * API consome para reemitir por Socket.io. Ou seja: **a API já recebe todo evento
 * de mensagem nova**, com workspace e conversa. Pendurar a notificação aí custa
 * zero infraestrutura nova — nem fila, nem consumidor, nem contrato entre
 * processos —, e mantém o roteador do lado que já sabe falar com o push.
 *
 * A alternativa seria o worker chamar o roteador direto, o que exigiria mover o
 * serviço para um pacote compartilhado e dar ao worker acesso às chaves VAPID.
 * Mais peças, mais superfície, mesmo resultado.
 *
 * ## Best-effort, sempre
 *
 * Nada aqui pode derrubar o relay. O relay é o último trecho entre o banco e o
 * navegador: se ele engolir um evento, o sintoma é "o tempo real some às vezes" —
 * um bug caro de diagnosticar. Notificação que falha é um aviso perdido;
 * notificação que quebra o relay é o produto parecendo quebrado para todo mundo.
 */
import { and, count, eq, ne } from 'drizzle-orm';
import { schema, withWorkspace } from '@hm/db';
import { createLogger } from '@hm/logger';
import type { NotificationEvent } from '@hm/shared';
import { notifyEvent } from './index';

const logger = createLogger('info', { svc: '@hm/api' });

/** Rótulos por evento. Curtos: é o que cabe numa notificação de tela bloqueada. */
const TITULO: Record<NotificationEvent, string> = {
  lead_novo: 'Lead novo',
  mensagem_nova: 'Nova mensagem',
  lead_esfriando: 'Lead esperando há tempo',
  compromisso_proximo: 'Compromisso chegando',
  no_show: 'Cliente não apareceu',
};

/** Nome do canal como o dono chama, não como o código chama. */
export function origemLegivel(provider: string): string {
  if (provider === 'meta_whatsapp' || provider === 'waha') return 'WhatsApp';
  if (provider === 'meta_instagram') return 'Instagram';
  if (provider === 'email') return 'E-mail';
  if (provider === 'webchat') return 'Site';
  return 'Atendimento';
}

interface Contexto {
  readonly channelProvider: string;
  readonly assignedTo: string | null;
  readonly contactId: string | null;
  /** Primeira mensagem que este contato manda no workspace. */
  readonly primeiroContato: boolean;
}

/**
 * Quem deve ser avisado.
 *
 * Atribuído a alguém → só essa pessoa; ela é a dona do atendimento e avisar o
 * time inteiro transformaria cada mensagem numa reunião. Sem dono → os OWNER,
 * porque lead sem responsável é problema de quem é dono do negócio.
 *
 * ADMIN de propósito fora: numa agência, o ADMIN costuma ser da agência, e ele
 * não precisa do celular tocando a cada mensagem do cliente do cliente.
 */
async function destinatarios(workspaceId: string, ctx: Contexto): Promise<string[]> {
  if (ctx.assignedTo !== null) return [ctx.assignedTo];
  return withWorkspace(workspaceId, async (tx) => {
    const linhas = await tx
      .select({ id: schema.members.id })
      .from(schema.members)
      .where(
        and(
          eq(schema.members.workspaceId, workspaceId),
          eq(schema.members.role, 'OWNER'),
          eq(schema.members.status, 'active'),
        ),
      );
    return linhas.map((l) => l.id);
  });
}

/** Carrega o mínimo para decidir: canal, dono e se é o primeiro contato. */
async function carregarContexto(
  workspaceId: string,
  conversationId: string,
): Promise<Contexto | null> {
  return withWorkspace(workspaceId, async (tx) => {
    const [conv] = await tx
      .select({
        assignedTo: schema.conversations.assignedTo,
        contactId: schema.conversations.contactId,
        provider: schema.channels.provider,
      })
      .from(schema.conversations)
      .innerJoin(schema.channels, eq(schema.conversations.channelId, schema.channels.id))
      .where(eq(schema.conversations.id, conversationId))
      .limit(1);
    if (conv === undefined) return null;

    // "Lead novo" = o contato só tem ESTA conversa. Distinguir isso importa
    // porque é o único evento que justifica interromper alguém — e um cliente
    // antigo mandando "bom dia" não é um lead novo.
    let primeiroContato = false;
    if (conv.contactId !== null) {
      const [outras] = await tx
        .select({ n: count() })
        .from(schema.conversations)
        .where(
          and(
            eq(schema.conversations.workspaceId, workspaceId),
            eq(schema.conversations.contactId, conv.contactId),
            ne(schema.conversations.id, conversationId),
          ),
        );
      primeiroContato = (outras?.n ?? 0) === 0;
    }

    return {
      channelProvider: conv.provider,
      assignedTo: conv.assignedTo,
      contactId: conv.contactId,
      primeiroContato,
    };
  });
}

/**
 * Reage a uma mensagem inbound.
 *
 * `messageId` entra na chave do evento em `mensagem_nova` porque cada mensagem é
 * um fato distinto. Em `lead_novo` a chave é só a conversa: uma pessoa vira lead
 * novo uma vez, e um retry da fila três dias depois não pode avisar de novo.
 */
export async function notifyInboundMessage(input: {
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly messageId: string;
}): Promise<void> {
  try {
    const ctx = await carregarContexto(input.workspaceId, input.conversationId);
    if (ctx === null) return;

    const evento: NotificationEvent = ctx.primeiroContato ? 'lead_novo' : 'mensagem_nova';
    const eventKey =
      evento === 'lead_novo'
        ? `lead_novo:${input.conversationId}`
        : `mensagem_nova:${input.messageId}`;

    const membros = await destinatarios(input.workspaceId, ctx);
    if (membros.length === 0) return;

    await Promise.all(
      membros.map((memberId) =>
        notifyEvent({
          workspaceId: input.workspaceId,
          memberId,
          evento,
          eventKey,
          titulo: TITULO[evento],
          origem: origemLegivel(ctx.channelProvider),
          url: `/conversations?c=${input.conversationId}`,
        }),
      ),
    );
  } catch (err) {
    // Nunca propagar: um aviso perdido é ruim, o relay quebrado é pior.
    logger.warn('notificação de inbound falhou — evento de socket seguiu normalmente', {
      workspaceId: input.workspaceId,
      erro: err instanceof Error ? err.message : String(err),
    });
  }
}
