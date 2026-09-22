/**
 * Roteador de notificação — a execução (F61-S04 — APP_MOBILE_PLAN.md §4.2).
 *
 * A **decisão** mora em `@hm/shared/notifications`, pura e testada sem banco, sem
 * rede e sem relógio. Aqui fica o IO: ler o membro, descobrir o que consegue
 * entregar, tentar em cascata e gravar o que aconteceu.
 *
 * ## A cascata para no primeiro sucesso
 *
 * `push → whatsapp → email`. Se o push entregou, o WhatsApp não sai — é a regra
 * inteira do slot em uma frase. Mandar os três "por garantia" é como o dono acaba
 * desligando tudo, e ele não religa.
 *
 * ## Gravar a supressão é tão importante quanto gravar o envio
 *
 * Um aviso que não saiu com motivo registrado responde "por que não fui avisado?".
 * Sem essa resposta, o dono deixa de confiar e volta a conferir o app por
 * garantia — que é justamente o trabalho que o produto deveria ter tirado dele.
 */
import { and, eq } from 'drizzle-orm';
import {
  routeNotification,
  type NotificationChannel,
  type NotificationEvent,
  type NotificationPrefs,
} from '@hm/shared';
import { schema, withWorkspace, type DbTx } from '@hm/db';
import { createLogger } from '@hm/logger';
import { isPushConfigured, notifyMember, type PushNotification } from '../push';

const logger = createLogger('info', { svc: '@hm/api' });

/**
 * Um fato a notificar.
 *
 * `eventKey` é a identidade do FATO (ex.: `lead_novo:<conversationId>`), não do
 * disparo: é o que faz dois disparos do mesmo fato colidirem no dedupe, mesmo
 * vindos de execuções diferentes do worker.
 *
 * Repare que não há campo para conteúdo de mensagem de cliente — a mesma decisão
 * de privacidade do `PushNotification` (§4.3), pelo mesmo motivo.
 */
export interface NotifiableEvent {
  readonly workspaceId: string;
  readonly memberId: string;
  readonly evento: NotificationEvent;
  readonly eventKey: string;
  /** Rótulo curto do que aconteceu. Ex.: "Lead novo". */
  readonly titulo: string;
  /** De onde veio. Ex.: "WhatsApp". NUNCA nome nem mensagem do cliente. */
  readonly origem?: string;
  /** Para onde levar ao tocar. */
  readonly url?: string;
}

/**
 * Hora local do membro, a partir do fuso dele.
 *
 * `Intl` em vez de aritmética com offset: horário de verão existe, e nos EUA ele
 * muda em datas diferentes das do Brasil. Fuso inválido (dado velho, IANA que
 * mudou) cai no relógio do servidor em vez de lançar — errar a janela de silêncio
 * é ruim, não avisar por causa de uma string é pior.
 */
export function horaLocalDe(agora: Date, timezone: string | null): number {
  if (timezone === null || timezone === '') return agora.getUTCHours();
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    });
    const h = Number(fmt.format(agora));
    return Number.isFinite(h) ? h % 24 : agora.getUTCHours();
  } catch {
    return agora.getUTCHours();
  }
}

/** Minutos desde a última presença no app. `null` quando nunca esteve. */
export function minutosDesde(agora: Date, lastSeenAt: Date | null): number | null {
  if (lastSeenAt === null) return null;
  return Math.max(0, Math.floor((agora.getTime() - lastSeenAt.getTime()) / 60_000));
}

/** Já existe entrega registrada para este fato, em qualquer canal? */
async function jaAvisado(tx: DbTx, e: NotifiableEvent): Promise<boolean> {
  const { notificationDeliveries } = schema;
  const [linha] = await tx
    .select({ id: notificationDeliveries.id })
    .from(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.workspaceId, e.workspaceId),
        eq(notificationDeliveries.memberId, e.memberId),
        eq(notificationDeliveries.eventKey, e.eventKey),
        eq(notificationDeliveries.status, 'enviado'),
      ),
    )
    .limit(1);
  return linha !== undefined;
}

/**
 * Registra o que aconteceu.
 *
 * `onConflictDoNothing` porque o índice único `(workspace, member, event_key,
 * channel)` é o dedupe **estrutural**: se dois consumidores da fila chegarem
 * juntos, um grava e o outro não — sem exceção, sem transação longa e sem perder
 * a corrida que uma consulta prévia perderia.
 */
async function registrar(
  tx: DbTx,
  e: NotifiableEvent,
  channel: NotificationChannel,
  status: 'enviado' | 'falhou' | 'suprimido',
  suppressedBy: string | null,
): Promise<boolean> {
  const [linha] = await tx
    .insert(schema.notificationDeliveries)
    .values({
      workspaceId: e.workspaceId,
      memberId: e.memberId,
      eventType: e.evento,
      eventKey: e.eventKey,
      channel,
      status,
      suppressedBy,
    })
    .onConflictDoNothing({
      target: [
        schema.notificationDeliveries.workspaceId,
        schema.notificationDeliveries.memberId,
        schema.notificationDeliveries.eventKey,
        schema.notificationDeliveries.channel,
      ],
    })
    .returning({ id: schema.notificationDeliveries.id });
  return linha !== undefined;
}

export interface NotifyOutcome {
  /** Canal que efetivamente entregou. `null` quando nada saiu. */
  readonly entreguePor: NotificationChannel | null;
  readonly suppressedBy: string | null;
}

/**
 * Avisa um membro sobre um fato, por um canal só.
 *
 * Hoje **só o push está ligado**. WhatsApp e e-mail para o membro dependem de
 * infraestrutura que ainda não existe (WhatsApp exige template aprovado para
 * mensagem iniciada pelo negócio fora da janela de 24h; e-mail transacional para
 * membro ainda não tem remetente próprio). Eles não entram em
 * `canaisDisponiveis`, então a cascata simplesmente não os tenta — e o dia em que
 * entrarem, o roteador já sabe o que fazer sem mudar uma linha.
 *
 * Declarar isso aqui em vez de fingir que funciona é o que evita um "canal
 * fantasma": aquele que aparece nas preferências, o usuário liga, e nada chega.
 */
export async function notifyEvent(e: NotifiableEvent, agora = new Date()): Promise<NotifyOutcome> {
  const contexto = await withWorkspace(e.workspaceId, async (tx) => {
    const [membro] = await tx
      .select({
        prefs: schema.members.notificationPrefs,
        lastSeenAt: schema.members.lastSeenAt,
        timezone: schema.members.timezone,
      })
      .from(schema.members)
      .where(eq(schema.members.id, e.memberId))
      .limit(1);
    if (membro === undefined) return null;
    return { membro, jaAvisado: await jaAvisado(tx, e) };
  });

  if (contexto === null) {
    logger.warn('notificação: membro não encontrado no workspace', {
      workspaceId: e.workspaceId,
    });
    return { entreguePor: null, suppressedBy: 'membro_inexistente' };
  }

  const { membro } = contexto;

  const decisao = routeNotification({
    evento: e.evento,
    prefs: membro.prefs as NotificationPrefs,
    horaLocal: horaLocalDe(agora, membro.timezone),
    minutosDesdeUltimaVisita: minutosDesde(agora, membro.lastSeenAt),
    jaAvisado: contexto.jaAvisado,
    canaisDisponiveis: isPushConfigured() ? ['push'] : [],
  });

  if (decisao.channels.length === 0) {
    // Registrar a supressão é o que responde ao "por que não fui avisado?".
    await withWorkspace(e.workspaceId, (tx) =>
      registrar(tx, e, 'push', 'suprimido', decisao.suppressedBy),
    );
    return { entreguePor: null, suppressedBy: decisao.suppressedBy };
  }

  const notificacao: PushNotification = {
    title: e.titulo,
    ...(e.origem !== undefined ? { origin: e.origem } : {}),
    ...(e.url !== undefined ? { url: e.url } : {}),
    // Agrupa por TIPO de evento: cinco "lead novo" viram um aviso, em vez de uma
    // pilha que o dono desliga no terceiro dia.
    tag: e.evento,
  };

  for (const canal of decisao.channels) {
    if (canal !== 'push') continue;

    // Reserva o lugar ANTES de mandar: se dois consumidores da fila chegarem
    // juntos, só um passa pelo índice único, e só ele envia. Fazer o contrário
    // mandaria dois avisos e gravaria um.
    const reservou = await withWorkspace(e.workspaceId, (tx) =>
      registrar(tx, e, canal, 'enviado', null),
    );
    if (!reservou) return { entreguePor: null, suppressedBy: 'ja_avisado' };

    const r = await notifyMember({ workspaceId: e.workspaceId, memberId: e.memberId }, notificacao);
    if (r.enviados > 0) return { entreguePor: canal, suppressedBy: null };

    // Nenhum aparelho recebeu: corrige o registro para não bloquear a próxima
    // tentativa deste mesmo fato. Um "enviado" mentiroso silenciaria o evento
    // para sempre — o pior resultado possível num canal de aviso.
    await withWorkspace(e.workspaceId, async (tx) => {
      await tx
        .update(schema.notificationDeliveries)
        .set({ status: 'falhou' })
        .where(
          and(
            eq(schema.notificationDeliveries.workspaceId, e.workspaceId),
            eq(schema.notificationDeliveries.memberId, e.memberId),
            eq(schema.notificationDeliveries.eventKey, e.eventKey),
            eq(schema.notificationDeliveries.channel, canal),
          ),
        );
    });
  }

  return { entreguePor: null, suppressedBy: 'sem_entrega' };
}
