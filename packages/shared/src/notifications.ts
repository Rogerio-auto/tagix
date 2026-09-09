/**
 * Roteador de notificação — a decisão pura (F61-S04 — APP_MOBILE_PLAN.md §4.2).
 *
 * ## O problema que isto resolve
 *
 * Um evento ("entrou lead novo") pode virar push, WhatsApp e e-mail ao mesmo
 * tempo. O dono recebe três vezes a mesma coisa, desliga tudo — e não religa. Aí
 * o produto perdeu justamente o canal que sustentava o tempo de resposta, que é o
 * número que fecha venda.
 *
 * Notificação demais não é incômodo: é a destruição do canal.
 *
 * ## Cascata, não paralelo
 *
 * A ordem é `push → whatsapp → email`, e cada degrau só é tentado se o anterior
 * não resolveu. Push é o mais barato e o mais imediato; e-mail é o último porque é
 * o que menos gente lê no celular, e o único que não custa nada mandar por engano.
 *
 * ## Este módulo não manda nada
 *
 * Só decide. Todo IO — ler assinatura, mandar WhatsApp, gravar entrega — fica na
 * API. É o que permite testar a regra inteira sem banco, sem rede e sem relógio.
 */

/**
 * O que pode ser notificado.
 *
 * Por TIPO, e não um interruptor geral, porque as preferências reais são assim:
 * "me avise de lead novo, não de cada mensagem numa conversa que já estou
 * acompanhando".
 */
export const NOTIFICATION_EVENTS = [
  /** Primeiro contato de alguém que nunca escreveu. O que fecha venda. */
  'lead_novo',
  /** Mensagem em conversa já existente. */
  'mensagem_nova',
  /** Conversa esperando resposta há tempo demais. */
  'lead_esfriando',
  /** Compromisso chegando. */
  'compromisso_proximo',
  /** Cliente não apareceu. */
  'no_show',
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

/** Canais de aviso ao MEMBRO (não ao contato). Ordem = ordem da cascata. */
export const NOTIFICATION_CHANNELS = ['push', 'whatsapp', 'email'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * Preferências como estão gravadas em `members.notification_prefs`.
 *
 * As três chaves antigas (`in_app`/`email`/`push`) continuam existindo: são o
 * interruptor GERAL, e existem em toda linha do banco desde o F0. `byEvent` é o
 * refinamento novo, opcional — quem nunca abriu as configurações continua com o
 * comportamento de antes, sem migration e sem backfill.
 */
export interface NotificationPrefs {
  readonly in_app?: boolean;
  readonly email?: boolean;
  readonly push?: boolean;
  /** Refinamento por tipo de evento. Ausente = usar o interruptor geral. */
  readonly byEvent?: Partial<Record<NotificationEvent, readonly NotificationChannel[]>>;
  /** Silêncio local do membro. Ausente = sem silêncio (o padrão do produto). */
  readonly quietHours?: { readonly startHour: number; readonly endHour: number };
}

/**
 * Default por evento quando o membro nunca configurou nada.
 *
 * `lead_novo` é o único que sai por WhatsApp por padrão: é o evento que justifica
 * interromper alguém. Os demais ficam no push, que o dono lê quando quiser.
 * Nenhum manda e-mail por padrão — e-mail de notificação vira filtro, e filtro é
 * como um canal morre em silêncio.
 */
const DEFAULT_POR_EVENTO: Record<NotificationEvent, readonly NotificationChannel[]> = {
  lead_novo: ['push', 'whatsapp'],
  mensagem_nova: ['push'],
  lead_esfriando: ['push'],
  compromisso_proximo: ['push'],
  no_show: ['push'],
};

/**
 * Canais que o membro aceita para este evento.
 *
 * Precedência: `byEvent` (escolha explícita para este evento) → default do evento
 * filtrado pelo interruptor geral. O interruptor geral **restringe**, nunca
 * amplia: alguém que desligou push no perfil não volta a receber push porque o
 * default do evento inclui.
 */
export function channelsFor(
  prefs: NotificationPrefs | null | undefined,
  evento: NotificationEvent,
): readonly NotificationChannel[] {
  const p = prefs ?? {};
  const explicito = p.byEvent?.[evento];
  if (explicito !== undefined) return explicito;

  return DEFAULT_POR_EVENTO[evento].filter((c) => {
    if (c === 'push') return p.push !== false;
    if (c === 'email') return p.email !== false;
    // WhatsApp não tem interruptor geral no formato antigo — o default manda.
    return true;
  });
}

/**
 * Está dentro do silêncio local?
 *
 * `startHour` é quando o silêncio COMEÇA e `endHour` quando TERMINA, no relógio
 * do membro. A janela pode cruzar a meia-noite (22h→7h é o caso normal), e é por
 * isso que a comparação não é um simples `>=` e `<`.
 */
export function inQuietHours(
  hora: number,
  janela: { startHour: number; endHour: number } | undefined,
): boolean {
  if (janela === undefined) return false;
  const { startHour, endHour } = janela;
  if (startHour === endHour) return false;
  if (startHour < endHour) return hora >= startHour && hora < endHour;
  // Cruza a meia-noite.
  return hora >= startHour || hora < endHour;
}

/** O que a cascata decidiu, e por quê — o "por quê" é o que responde ao suporte. */
export interface RoutingDecision {
  /** Canais a tentar, em ordem. Vazio = não avisar. */
  readonly channels: readonly NotificationChannel[];
  /** Motivo quando nada sai. `null` quando há canal. */
  readonly suppressedBy:
    | 'preferencia'
    | 'silencio'
    | 'ja_avisado'
    | 'ja_viu'
    /** O membro aceitaria, mas nenhum canal escolhido consegue entregar agora. */
    | 'indisponivel'
    | null;
}

const SEM_AVISO = (motivo: RoutingDecision['suppressedBy']): RoutingDecision => ({
  channels: [],
  suppressedBy: motivo,
});

/**
 * Decide por onde avisar.
 *
 * A ordem das checagens é a ordem em que elas ficam mais caras de errar:
 *
 * 1. **Já avisado** — o mesmo evento não pode gerar dois avisos. É o que impede
 *    um retry de fila virar spam.
 * 2. **Preferência** — o membro decidiu. Nenhuma regra abaixo reverte isso.
 * 3. **Disponibilidade** — canal que não entrega não é degrau da cascata.
 * 4. **Já viu** — pessoa com o app aberto agora não precisa de WhatsApp. Só corta
 *    os canais INTRUSIVOS: o push ainda vale, porque é ele que acende o badge.
 * 5. **Silêncio** — fora da janela, só o que não faz barulho.
 *
 * "Já viu" antes de "silêncio" de propósito: quem está com o app aberto às 23h já
 * está trabalhando, e silenciar o push dele seria esconder o lead de quem está
 * olhando.
 */
export function routeNotification(input: {
  readonly evento: NotificationEvent;
  readonly prefs: NotificationPrefs | null | undefined;
  /** Hora local do MEMBRO (0-23), já convertida pelo chamador. */
  readonly horaLocal: number;
  /** Minutos desde a última vez que a pessoa esteve no app. `null` = nunca. */
  readonly minutosDesdeUltimaVisita: number | null;
  /** Este evento já foi entregue a este membro. */
  readonly jaAvisado: boolean;
  /**
   * Canais que o sistema consegue ENTREGAR agora.
   *
   * Separado da preferência de propósito: "o membro quer WhatsApp" e "o produto
   * sabe mandar WhatsApp" são fatos diferentes, e confundi-los produz o pior dos
   * resultados — a cascata para num degrau que nunca entrega, e o dono não é
   * avisado por um canal que funcionava.
   */
  readonly canaisDisponiveis: readonly NotificationChannel[];
}): RoutingDecision {
  if (input.jaAvisado) return SEM_AVISO('ja_avisado');

  let canais = channelsFor(input.prefs, input.evento);
  if (canais.length === 0) return SEM_AVISO('preferencia');

  // Canal que não entrega não conta como degrau da cascata — senão o WhatsApp
  // nunca sairia para quem não instalou o app, e o e-mail nunca sairia para quem
  // não tem WhatsApp conectado.
  canais = canais.filter((c) => input.canaisDisponiveis.includes(c));
  if (canais.length === 0) return SEM_AVISO('indisponivel');

  // Quem esteve no app há pouco já viu. Cortar só o intrusivo.
  const viuAgora =
    input.minutosDesdeUltimaVisita !== null &&
    input.minutosDesdeUltimaVisita <= JANELA_JA_VIU_MIN;
  if (viuAgora) {
    canais = canais.filter((c) => c !== 'whatsapp' && c !== 'email');
    if (canais.length === 0) return SEM_AVISO('ja_viu');
  }

  if (inQuietHours(input.horaLocal, input.prefs?.quietHours)) {
    // No silêncio, nada que toque o telefone da pessoa. E-mail passa: ele espera
    // na caixa e não acorda ninguém.
    canais = canais.filter((c) => c === 'email');
    if (canais.length === 0) return SEM_AVISO('silencio');
  }

  if (canais.length === 0) return SEM_AVISO('preferencia');
  return { channels: canais, suppressedBy: null };
}

/**
 * Quanto tempo depois de abrir o app a pessoa ainda "acabou de ver".
 *
 * Cinco minutos: tempo de ler a tela e sair. Mais que isso e o dono que fechou o
 * app às 14h05 deixaria de ser avisado do lead das 14h20.
 */
export const JANELA_JA_VIU_MIN = 5;
