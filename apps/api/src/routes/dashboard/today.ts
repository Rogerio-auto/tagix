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
import { and, asc, count, eq, gte, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm';
import { schema, type DbTx } from '@hm/db';
import { formatPhoneForDisplay, humanizePreview } from '@hm/shared';

/** Faixa de urgência — a tela agrupa por isto em vez de mostrar uma fila plana. */
export type UrgencyBand = 'esfriando' | 'atencao' | 'agora';

/** Lead que escreveu e ainda não teve resposta. */
export interface WaitingLead {
  readonly conversationId: string;
  readonly contactId: string | null;
  /**
   * Como chamar esta pessoa na tela. NUNCA nulo quando existe qualquer
   * identidade: nome do CRM > nome de perfil do WhatsApp > telefone formatado.
   *
   * Antes da F61-S12 isto vinha nulo em 199 de 200 contatos e a tela escrevia
   * "Contato sem nome" — uma lista de leads indistinguíveis não é uma lista.
   */
  readonly contactName: string | null;
  readonly preview: string | null;
  /** ISO da mensagem que está esperando. A UI formata "há 12 min". */
  readonly waitingSince: string;
  /** Minutos de espera, já calculados: a UI não deve depender do relógio dela. */
  readonly waitingMinutes: number;
  readonly channel: string;
  readonly urgency: UrgencyBand;
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

/** Quantos esperando em cada faixa — o dono vê o tamanho do problema, não só 10 linhas. */
export interface WaitingBands {
  readonly esfriando: number;
  readonly atencao: number;
  readonly agora: number;
}

export interface TodayPayload {
  readonly waiting: readonly WaitingLead[];
  readonly waitingTotal: number;
  readonly waitingBands: WaitingBands;
  readonly appointments: readonly TodayAppointment[];
  readonly month: MonthResult;
  /** Instante do servidor — a UI calcula "há X min" a partir daqui, não do relógio local. */
  readonly serverTime: string;
}

/**
 * Quantos leads esperando a tela carrega. Subiu de 10 para 30 na F61-S12: com 61
 * na fila, um top-10 ordenado por antiguidade mostrava só os mais FRIOS — os
 * únicos que já não dá para salvar — e escondia os que ainda dá.
 *
 * A tela agrupa por urgência e mostra os primeiros de cada faixa, então 30 cobre
 * as três faixas sem transformar a abertura no 4G em rolagem infinita.
 */
const WAITING_LIMIT = 30;

/** Acima de 1h o lead já fechou com outro; acima de 15 min está pedindo para o concorrente. */
const MINUTOS_ESFRIANDO = 60;
const MINUTOS_ATENCAO = 15;

function faixaDeUrgencia(minutos: number): UrgencyBand {
  if (minutos >= MINUTOS_ESFRIANDO) return 'esfriando';
  if (minutos >= MINUTOS_ATENCAO) return 'atencao';
  return 'agora';
}

/**
 * Como chamar a pessoa na tela.
 *
 * Ordem: nome do CRM (decisão de quem atende) → telefone formatado. Um telefone
 * identifica um lead; "Contato sem nome" não identifica nada e ainda parece
 * defeito do produto. Só devolve `null` quando não há identidade nenhuma — e aí
 * a UI é que decide o que dizer, com contexto que aqui não existe.
 */
function nomeExibivel(displayName: string | null, phone: string | null): string | null {
  const nome = displayName?.trim();
  if (nome !== undefined && nome !== '') return nome;
  return formatPhoneForDisplay(phone);
}

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

  // Cortes das faixas, calculados uma vez e usados na query de contagem.
  //
  // ISO + cast explícito, não `Date`: num `sql` cru o driver não infere o tipo do
  // parâmetro e rejeita o objeto Date ("must be of type string or Buffer"). Os
  // helpers tipados (`lt`/`gte`) fazem essa conversão sozinhos; o template cru não.
  const corteEsfriando = new Date(now.getTime() - MINUTOS_ESFRIANDO * 60_000).toISOString();
  const corteAtencao = new Date(now.getTime() - MINUTOS_ATENCAO * 60_000).toISOString();

  const [esperando, totalEsperando, faixas, compromissos, mesAtual, mesAnterior] =
    await Promise.all([
    tx
      .select({
        conversationId: conversations.id,
        contactId: conversations.contactId,
        contactName: contacts.displayName,
        // Identidade de reserva quando não há nome: todo contato tem telefone.
        contactPhone: contacts.phone,
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

    /**
     * Contagem por faixa sobre a fila INTEIRA, em uma query agregada.
     *
     * O dono precisa do tamanho do problema ("38 esfriando"), não do tamanho da
     * página. Contar no servidor evita trazer 61 linhas — e 610, quando o
     * workspace crescer — só para classificá-las no cliente.
     */
    tx
      .select({
        esfriando: count(
          sql`case when ${conversations.lastMessageAt} < ${corteEsfriando}::timestamptz then 1 end`,
        ),
        atencao: count(
          sql`case when ${conversations.lastMessageAt} >= ${corteEsfriando}::timestamptz
                    and ${conversations.lastMessageAt} < ${corteAtencao}::timestamptz then 1 end`,
        ),
        agora: count(
          sql`case when ${conversations.lastMessageAt} >= ${corteAtencao}::timestamptz then 1 end`,
        ),
      })
      .from(conversations)
      .where(aguardando),

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

  const esperandoComUrgencia: WaitingLead[] = esperando.map((c) => {
    const minutos = Math.max(
      0,
      Math.floor((now.getTime() - (c.waitingSince as Date).getTime()) / 60_000),
    );
    return {
      conversationId: c.conversationId,
      contactId: c.contactId,
      contactName: nomeExibivel(c.contactName, c.contactPhone),
      // Humaniza na LEITURA: o banco ainda tem `[voice]` de antes da F61-S12, e
      // consertar na saída conserta o histórico sem migration.
      preview: humanizePreview(c.preview),
      waitingSince: (c.waitingSince as Date).toISOString(),
      waitingMinutes: minutos,
      channel: c.channel,
      urgency: faixaDeUrgencia(minutos),
    };
  });

  return {
    waiting: esperandoComUrgencia,
    waitingTotal: totalEsperando[0]?.value ?? 0,
    waitingBands: {
      esfriando: faixas[0]?.esfriando ?? 0,
      atencao: faixas[0]?.atencao ?? 0,
      agora: faixas[0]?.agora ?? 0,
    },
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
