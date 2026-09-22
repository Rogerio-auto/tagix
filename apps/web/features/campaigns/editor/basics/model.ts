/**
 * Primeiro passo do criador de campanha — a decisão pura (F58-S07).
 *
 * ## O que este passo resolve
 *
 * O editor antigo pedia "tipo: broadcast / drip / triggered". Nenhum dono de
 * empresa de reforma sabe o que é drip, e quem não entende a primeira pergunta
 * não chega na segunda. A interface passa a falar **Envio único** e **Sequência
 * de mensagens**; o banco continua guardando `broadcast`/`drip` (a tradução mora
 * em `campaigns/builder/contracts.ts`, do lado da API).
 *
 * ## Por que a validação é uma função pura
 *
 * "Posso avançar?" é a pergunta mais cara de errar num wizard: liberar cedo leva
 * o usuário a um passo que vai falhar depois, e travar sem motivo faz ele
 * desistir. Sendo pura, a regra inteira é testável sem React — e o componente
 * fica só com a apresentação.
 */

export type CampaignMode = 'single' | 'sequence';

/** Canal como o passo precisa vê-lo. Espelha `BuilderChannelOption` da API. */
export interface ChannelChoice {
  readonly id: string;
  readonly name: string;
  readonly displayHandle: string | null;
  readonly provider: string;
  readonly eligible: boolean;
  /** Já traduzido pela API para a linguagem do cliente. */
  readonly ineligibleMessage: string | null;
  readonly approvedTemplateCount: number;
}

export interface BasicsState {
  readonly name: string;
  readonly mode: CampaignMode | null;
  readonly channelId: string | null;
}

export const EMPTY_BASICS: BasicsState = { name: '', mode: null, channelId: null };

/** Teto do nome. Generoso: é rótulo interno, e cortar cedo irrita sem proteger nada. */
export const NAME_MAX = 120;

export type BasicsField = 'name' | 'mode' | 'channelId';

/** Erro por campo, em texto que o dono entende. */
export type BasicsErrors = Partial<Record<BasicsField, string>>;

/**
 * Avisos que NÃO impedem avançar.
 *
 * A distinção importa: canal sem modelo aprovado é um problema real, mas ele se
 * resolve no passo da mensagem (ou numa outra aba, aprovando o modelo). Travar
 * aqui obrigaria o usuário a abandonar o rascunho para voltar depois — e
 * rascunho abandonado não vira campanha.
 */
export type BasicsWarnings = Partial<Record<BasicsField, string>>;

export function validateBasics(state: BasicsState, canais: readonly ChannelChoice[]): BasicsErrors {
  const erros: BasicsErrors = {};

  const nome = state.name.trim();
  if (nome === '') {
    erros.name = 'Dê um nome para você reconhecer esta campanha depois.';
  } else if (nome.length > NAME_MAX) {
    erros.name = `O nome pode ter no máximo ${NAME_MAX} caracteres.`;
  }

  if (state.mode === null) {
    erros.mode = 'Escolha se é um envio único ou uma sequência.';
  }

  if (state.channelId === null) {
    erros.channelId = 'Escolha por onde a campanha vai sair.';
  } else {
    const canal = canais.find((c) => c.id === state.channelId);
    if (canal === undefined) {
      // O canal saiu da lista entre a escolha e o envio (desconectado noutra aba,
      // removido por outro membro). Silenciar isso deixaria o usuário travado num
      // erro que só apareceria no fim.
      erros.channelId = 'Este canal não está mais disponível. Escolha outro.';
    } else if (!canal.eligible) {
      erros.channelId = canal.ineligibleMessage ?? 'Este canal não pode enviar campanhas.';
    }
  }

  return erros;
}

/** O que merece um aviso, sem travar. */
export function warnBasics(
  state: BasicsState,
  canais: readonly ChannelChoice[],
): BasicsWarnings {
  const avisos: BasicsWarnings = {};
  const canal = canais.find((c) => c.id === state.channelId);
  if (canal !== undefined && canal.eligible && canal.approvedTemplateCount === 0) {
    avisos.channelId =
      'Este canal ainda não tem nenhum modelo aprovado. Você pode continuar, mas vai precisar de um modelo aprovado para enviar.';
  }
  return avisos;
}

export function canAdvance(state: BasicsState, canais: readonly ChannelChoice[]): boolean {
  return Object.keys(validateBasics(state, canais)).length === 0;
}

/**
 * Canais na ordem em que ajudam a decidir: elegíveis primeiro, e entre eles os
 * que já têm modelo aprovado — que são os que realmente conseguem enviar hoje.
 *
 * Os inelegíveis continuam VISÍVEIS, no fim. Escondê-los produziria a pior
 * pergunta de suporte que existe: "cadê meu número?".
 */
export function sortChannels(canais: readonly ChannelChoice[]): ChannelChoice[] {
  return [...canais].sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    const aPronto = a.approvedTemplateCount > 0;
    const bPronto = b.approvedTemplateCount > 0;
    if (aPronto !== bPronto) return aPronto ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** Nome do canal como o dono o reconhece: o apelido e, quando houver, o número. */
export function channelLabel(canal: ChannelChoice): string {
  return canal.displayHandle !== null && canal.displayHandle !== ''
    ? `${canal.name} · ${canal.displayHandle}`
    : canal.name;
}
