/**
 * `GET /api/dashboard/today` — a visão de dono (F61-S02 — APP_MOBILE_PLAN §3.1).
 *
 * O dono do negócio não é atendente. Ele abre o celular entre uma tarefa e outra
 * e quer três respostas: entrou lead e alguém respondeu? o que eu tenho hoje?
 * como está o mês?
 *
 * **Uma chamada, não três.** A tela é aberta no 4G, muitas vezes na obra. Três
 * requisições em cascata é meio segundo a mais de espera e três chances de uma
 * falhar e a tela ficar pela metade.
 *
 * O número que fecha venda é o **tempo de espera do lead**: quem pede orçamento
 * pede três, e quem responde primeiro ganha. Por isso ele vem primeiro e ordenado
 * pelo mais antigo — quem está esperando há mais tempo é quem está mais perto de
 * fechar com o concorrente.
 */
import { and, asc, count, eq, gte, isNotNull, isNull, lt, ne } from 'drizzle-orm';
import { schema, type DbTx } from '@hm/db';

/** Lead que escreveu e ainda não teve resposta. */
export interface WaitingLead {
  readonly conversationId: string;
  readonly contactName: string | null;
  readonly preview: string | null;
  /** ISO da mensagem que está esperando. A UI formata "há 12 min". */
  readonly waitingSince: string;
  /** Minutos de espera, já calculados: a UI não deve depender do relógio dela. */
  readonly waitingMinutes: number;
  readonly channel: string;
}

export interface TodayAppointment {
  readonly id: string;
  readonly title: string;
  readonly startsAt: string;
  readonly contactName: string | null;
}

/** Resultado do mês corrente contra o anterior. Honesto quando o mês está ruim. */
export interface MonthResult {
  readonly leads: number;
  readonly leadsPrevious: number;
  readonly appointments: number;
  readonly appointmentsPrevious: number;
  readonly conversations: number;
  readonly conversationsPrevious: number;
}

export interface TodayPayload {
  readonly waiting: readonly WaitingLead[];
  readonly waitingTotal: number;
  readonly appointments: readonly TodayAppointment[];
  readonly month: MonthResult;
  /** Instante do servidor — a UI calcula "há X min" a partir daqui, não do relógio local. */
  readonly serverTime: string;
}

/** Quantos leads esperando cabem na tela sem virar rolagem infinita. */
const WAITING_LIMIT = 10;

function startOfMonth(at: Date, monthsBack = 0): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - monthsBack, 1));
}

export async function loadToday(
  tx: DbTx,
  input: { readonly workspaceId: string; readonly now?: Date },
): Promise<TodayPayload> {
  const now = input.now ?? new Date();
  const { conversations, contacts, channels, events } = schema;

  const inicioMes = startOfMonth(now);
  const inicioMesAnterior = startOfMonth(now, 1);

  // Início e fim do dia. Usa o fuso do workspace quando houver — o dono pensa em
  // "hoje" no fuso dele, não no do servidor.
  const inicioDia = new Date(now);
  inicioDia.setUTCHours(0, 0, 0, 0);
  const fimDia = new Date(inicioDia.getTime() + 86_400_000);

  /**
   * "Aguardando resposta" = a última mensagem veio do contato.
   * `lastMessageFrom` é denormalizado justamente para isso não virar um join
   * pesado em `messages` toda vez que a tela abre.
   */
  const aguardando = and(
    eq(conversations.workspaceId, input.workspaceId),
    eq(conversations.status, 'open'),
    eq(conversations.lastMessageFrom, 'contact'),
    isNotNull(conversations.lastMessageAt),
    // Conversa adiada não está esperando: alguém decidiu que ela espera.
    isNull(conversations.snoozedUntil),
  );

  const [esperando, totalEsperando, compromissos, mesAtual, mesAnterior] = await Promise.all([
    tx
      .select({
        conversationId: conversations.id,
        contactName: contacts.displayName,
        preview: conversations.lastMessagePreview,
        waitingSince: conversations.lastMessageAt,
        channel: channels.provider,
      })
      .from(conversations)
      .leftJoin(contacts, eq(conversations.contactId, contacts.id))
      .innerJoin(channels, eq(conversations.channelId, channels.id))
      .where(aguardando)
      // Mais antigo primeiro: quem espera há mais tempo está mais perto de
      // fechar com o concorrente.
      .orderBy(asc(conversations.lastMessageAt))
      .limit(WAITING_LIMIT),

    tx.select({ value: count() }).from(conversations).where(aguardando),

    tx
      .select({
        id: events.id,
        title: events.title,
        startsAt: events.startAt,
        contactName: contacts.displayName,
      })
      .from(events)
      .leftJoin(contacts, eq(events.contactId, contacts.id))
      .where(
        and(
          eq(events.workspaceId, input.workspaceId),
          gte(events.startAt, inicioDia),
          lt(events.startAt, fimDia),
          // Compromisso cancelado nao e "o que eu tenho hoje".
          ne(events.status, 'cancelled'),
        ),
      )
      .orderBy(asc(events.startAt))
      .limit(20),

    contagemDoPeriodo(tx, input.workspaceId, inicioMes, now),
    contagemDoPeriodo(tx, input.workspaceId, inicioMesAnterior, inicioMes),
  ]);

  return {
    waiting: esperando.map((c) => ({
      conversationId: c.conversationId,
      contactName: c.contactName,
      preview: c.preview,
      waitingSince: (c.waitingSince as Date).toISOString(),
      waitingMinutes: Math.max(
        0,
        Math.floor((now.getTime() - (c.waitingSince as Date).getTime()) / 60_000),
      ),
      channel: c.channel,
    })),
    waitingTotal: totalEsperando[0]?.value ?? 0,
    appointments: compromissos.map((a) => ({
      id: a.id,
      title: a.title,
      startsAt: a.startsAt.toISOString(),
      contactName: a.contactName,
    })),
    month: {
      leads: mesAtual.leads,
      leadsPrevious: mesAnterior.leads,
      appointments: mesAtual.appointments,
      appointmentsPrevious: mesAnterior.appointments,
      conversations: mesAtual.conversations,
      conversationsPrevious: mesAnterior.conversations,
    },
    serverTime: now.toISOString(),
  };
}

/** Contagens de um intervalo. Separado para o mês atual e o anterior usarem o mesmo caminho. */
async function contagemDoPeriodo(
  tx: DbTx,
  workspaceId: string,
  from: Date,
  to: Date,
): Promise<{ leads: number; appointments: number; conversations: number }> {
  const { contacts, conversations, events } = schema;

  const [leads, conversas, compromissos] = await Promise.all([
    tx
      .select({ value: count() })
      .from(contacts)
      .where(
        and(
          eq(contacts.workspaceId, workspaceId),
          gte(contacts.createdAt, from),
          lt(contacts.createdAt, to),
          isNull(contacts.deletedAt),
        ),
      ),
    tx
      .select({ value: count() })
      .from(conversations)
      .where(
        and(
          eq(conversations.workspaceId, workspaceId),
          gte(conversations.createdAt, from),
          lt(conversations.createdAt, to),
        ),
      ),
    tx
      .select({ value: count() })
      .from(events)
      .where(
        and(
          eq(events.workspaceId, workspaceId),
          gte(events.startAt, from),
          lt(events.startAt, to),
          ne(events.status, 'cancelled'),
        ),
      ),
  ]);

  return {
    leads: leads[0]?.value ?? 0,
    conversations: conversas[0]?.value ?? 0,
    appointments: compromissos[0]?.value ?? 0,
  };
}
