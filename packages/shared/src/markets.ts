/**
 * Market packs — fonte única de regra por mercado (AGENCIA_PLAN.md §3.1).
 *
 * O tagix opera em dois mercados que divergem em canal, lei, moeda, fuso e funil.
 * Esta divergência é um OBJETO DE CONFIGURAÇÃO, nunca `if (market === 'US')`
 * espalhado pelo produto — foi assim que o v1 apodreceu.
 *
 * Este módulo é PURO por decisão: sem I/O, sem `Date.now()`, sem leitura de env.
 * Fuso e horário são dados que entram por parâmetro, não efeitos que ele produz.
 * Quem decide se uma mensagem pode sair é `decideOutbound` (F59-S04), que consome
 * `getOutboundPolicy` daqui.
 *
 * Os fatos regulatórios codificados abaixo têm fonte primária datada em
 * `docs/features/AGENCIA_PLAN.md` §4 e §Fontes. Este arquivo só os codifica —
 * não os reinterpreta. Mudança de regra começa por atualizar aquele documento.
 */

// Import SÓ DE TIPO: `./index` re-exporta este módulo, então importar o valor
// `CHANNEL_PROVIDERS` daqui criaria ciclo em tempo de execução e o spread na
// inicialização veria `undefined`. O tipo é apagado na compilação; o ciclo não existe.
import type { ChannelProvider } from './index';

/** Mercados atendidos. Adicionar um exige um `MarketPack` completo — não há default. */
export const MARKET_CODES = ['BR', 'US'] as const;
export type MarketCode = (typeof MARKET_CODES)[number];

/**
 * Canais de comunicação. Superconjunto de `ChannelProvider` (mensageria já
 * implementada) mais os canais da paridade GoHighLevel (CANAIS_PLAN.md §2).
 *
 * `ChannelProvider` continua sendo o tipo de quem fala com um adapter; `ChannelKind`
 * é o tipo de quem raciocina sobre política de envio.
 */
export const CHANNEL_KINDS = [
  'meta_whatsapp',
  'meta_instagram',
  'waha',
  'email',
  'sms',
  'webchat',
  'messenger',
] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

/**
 * Trava de compilação: todo `ChannelProvider` precisa existir em `ChannelKind`.
 * Se alguém adicionar um provider em `./index` sem refletir aqui, o build quebra
 * neste ponto — que é onde o erro é barato, não no caminho de envio.
 */
type _ProviderIsChannelKind = ChannelProvider extends ChannelKind ? true : never;
const _providerCoverage: _ProviderIsChannelKind = true;
void _providerCoverage;

/**
 * Finalidade da mensagem. A distinção não é estética: nos EUA, marketing para
 * celular exige consentimento prévio expresso e por escrito; transacional
 * (confirmação de agendamento, lembrete) não.
 */
export const MESSAGE_PURPOSES = ['transactional', 'marketing'] as const;
export type MessagePurpose = (typeof MESSAGE_PURPOSES)[number];

/** Registro externo exigido antes do primeiro disparo no canal. */
export type ChannelRegistrationKind = 'none' | '10dlc';

/**
 * Janela horária legal, no fuso do CONTATO (não do workspace, não da campanha).
 *
 * Semântica: `startHour` inclusivo, `endHour` EXCLUSIVO. `{ startHour: 8, endHour: 21 }`
 * permite 08:00:00 até 20:59:59 e proíbe 21:00:00 — a hora 21 já está fora.
 */
export interface QuietHours {
  readonly startHour: number;
  readonly endHour: number;
}

export interface OutboundPolicy {
  /** Exige consentimento registrado antes de envio de MARKETING neste canal. */
  readonly requiresPriorConsent: boolean;
  /** Janela local permitida. `null` = sem restrição legal de horário neste canal. */
  readonly quietHours: QuietHours | null;
  /**
   * Revogação vale por qualquer meio razoável, não só palavra-chave.
   * Quando `true`, casar `STOP` é insuficiente: exige o detector de linguagem
   * natural (F59-S06).
   */
  readonly revocationByAnyReasonableMeans: boolean;
  /** Registro externo obrigatório antes do primeiro disparo. */
  readonly registrationRequired: ChannelRegistrationKind;
  /**
   * Palavras-chave de opt-out reconhecidas — minúsculas, sem acento, já normalizadas.
   * Cobre pt e en nos DOIS mercados de propósito: o público responde no idioma dele,
   * não no idioma do mercado. Um brasileiro na Flórida escreve "PARE".
   */
  readonly optOutKeywords: readonly string[];
}

export interface MarketPack {
  readonly code: MarketCode;
  readonly currency: 'BRL' | 'USD';
  readonly locales: readonly string[];
  readonly defaultLocale: string;
  /** Fuso usado quando o contato não tem fuso próprio. */
  readonly defaultTimezone: string;
  /**
   * `true` quando o mercado tem múltiplos fusos simultâneos e a janela horária
   * precisa ser calculada por contato. EUA: obrigatório. Brasil: um fuso domina.
   */
  readonly timezonePerContact: boolean;
  /** Canais oferecidos neste mercado. Disponibilidade de produto, NÃO gate legal. */
  readonly channels: readonly ChannelKind[];
  readonly outbound: Readonly<Record<ChannelKind, OutboundPolicy>>;
}

/**
 * Palavras-chave bilíngues. Normalizadas (minúsculas, sem acento) porque o
 * detector normaliza a entrada antes de comparar.
 */
const OPT_OUT_KEYWORDS = [
  // en
  'stop',
  'unsubscribe',
  'cancel',
  'quit',
  'end',
  'optout',
  // pt
  'pare',
  'parar',
  'sair',
  'cancelar',
  'descadastrar',
  'remover',
] as const;

/**
 * Padrão SEGURO para canal sem política explícita: exige consentimento e trata
 * revogação livre. Errar para o lado restritivo custa uma mensagem não enviada;
 * errar para o permissivo custa multa por mensagem.
 */
const SAFE_DEFAULT_POLICY: OutboundPolicy = {
  requiresPriorConsent: true,
  quietHours: { startHour: 8, endHour: 21 },
  revocationByAnyReasonableMeans: true,
  registrationRequired: 'none',
  optOutKeywords: OPT_OUT_KEYWORDS,
};

/** Política sem exigência de consentimento prévio, para canais iniciados pelo contato. */
const INBOUND_INITIATED_POLICY: OutboundPolicy = {
  requiresPriorConsent: false,
  quietHours: null,
  revocationByAnyReasonableMeans: true,
  registrationRequired: 'none',
  optOutKeywords: OPT_OUT_KEYWORDS,
};

/**
 * Brasil. LGPD admite base legal diversa e a janela horária não é imposta por lei
 * federal de mensageria como nos EUA — mas ignorar pedido de parada queima o número
 * do cliente na Meta, então `revocationByAnyReasonableMeans` vale aqui também.
 */
const BR_PACK: MarketPack = {
  code: 'BR',
  currency: 'BRL',
  locales: ['pt-BR'],
  defaultLocale: 'pt-BR',
  defaultTimezone: 'America/Sao_Paulo',
  timezonePerContact: false,
  channels: ['meta_whatsapp', 'meta_instagram', 'waha', 'email', 'webchat', 'messenger'],
  outbound: {
    meta_whatsapp: {
      requiresPriorConsent: true,
      quietHours: null,
      revocationByAnyReasonableMeans: true,
      registrationRequired: 'none',
      optOutKeywords: OPT_OUT_KEYWORDS,
    },
    meta_instagram: INBOUND_INITIATED_POLICY,
    waha: {
      requiresPriorConsent: true,
      quietHours: null,
      revocationByAnyReasonableMeans: true,
      registrationRequired: 'none',
      optOutKeywords: OPT_OUT_KEYWORDS,
    },
    email: {
      requiresPriorConsent: false,
      quietHours: null,
      revocationByAnyReasonableMeans: true,
      registrationRequired: 'none',
      optOutKeywords: OPT_OUT_KEYWORDS,
    },
    sms: SAFE_DEFAULT_POLICY,
    webchat: INBOUND_INITIATED_POLICY,
    messenger: INBOUND_INITIATED_POLICY,
  },
};

/**
 * Estados Unidos. TCPA exige consentimento prévio expresso e por escrito para
 * marketing a celular; a regra de revogação em vigor desde 11/04/2025 proíbe
 * exigir palavra-chave específica; SMS A2P exige registro 10DLC, e desde
 * 01/02/2025 as operadoras bloqueiam 100% do tráfego não registrado.
 * Fontes datadas em AGENCIA_PLAN.md §4 e §Fontes.
 */
const US_PACK: MarketPack = {
  code: 'US',
  currency: 'USD',
  locales: ['en-US', 'pt-BR'],
  defaultLocale: 'en-US',
  defaultTimezone: 'America/New_York',
  timezonePerContact: true,
  channels: [
    'meta_whatsapp',
    'meta_instagram',
    'waha',
    'email',
    'sms',
    'webchat',
    'messenger',
  ],
  outbound: {
    meta_whatsapp: {
      requiresPriorConsent: true,
      quietHours: { startHour: 8, endHour: 21 },
      revocationByAnyReasonableMeans: true,
      registrationRequired: 'none',
      optOutKeywords: OPT_OUT_KEYWORDS,
    },
    meta_instagram: {
      requiresPriorConsent: false,
      quietHours: null,
      revocationByAnyReasonableMeans: true,
      registrationRequired: 'none',
      optOutKeywords: OPT_OUT_KEYWORDS,
    },
    waha: SAFE_DEFAULT_POLICY,
    email: {
      // CAN-SPAM não exige opt-in prévio; exige opt-out funcional e honrado.
      requiresPriorConsent: false,
      quietHours: null,
      revocationByAnyReasonableMeans: true,
      registrationRequired: 'none',
      optOutKeywords: OPT_OUT_KEYWORDS,
    },
    sms: {
      requiresPriorConsent: true,
      quietHours: { startHour: 8, endHour: 21 },
      revocationByAnyReasonableMeans: true,
      registrationRequired: '10dlc',
      optOutKeywords: OPT_OUT_KEYWORDS,
    },
    webchat: INBOUND_INITIATED_POLICY,
    messenger: {
      requiresPriorConsent: false,
      quietHours: null,
      revocationByAnyReasonableMeans: true,
      registrationRequired: 'none',
      optOutKeywords: OPT_OUT_KEYWORDS,
    },
  },
};

const PACKS: Readonly<Record<MarketCode, MarketPack>> = {
  BR: BR_PACK,
  US: US_PACK,
};

/**
 * Pack do mercado. Cai em `BR` se o código vier corrompido do banco — o valor
 * default da coluna é `BR` e todo workspace existente é brasileiro, então essa
 * é a degradação que preserva o comportamento atual em vez de derrubar o envio.
 */
export function getMarketPack(code: MarketCode): MarketPack {
  return PACKS[code] ?? PACKS.BR;
}

/**
 * Política de envio para um canal num mercado.
 *
 * TOTAL por contrato: devolve política para todo `ChannelKind`, inclusive canal
 * não habilitado no mercado — nesse caso, o padrão seguro. Nunca devolve
 * `undefined`, porque o chamador é o caminho de envio e não deve ter ramo de
 * "não sei".
 */
export function getOutboundPolicy(code: MarketCode, channel: ChannelKind): OutboundPolicy {
  const pack = PACKS[code];
  // Mercado desconhecido não herda a permissividade do BR: aqui o custo de errar
  // para o lado permissivo é multa por mensagem, então vai no padrão seguro.
  if (pack === undefined) return SAFE_DEFAULT_POLICY;
  return pack.outbound[channel] ?? SAFE_DEFAULT_POLICY;
}

/**
 * Disponibilidade do canal no mercado.
 *
 * ATENÇÃO: isto é gate de PRODUTO (o que a UI oferece), nunca gate de
 * CONFORMIDADE. Quem decide se a mensagem pode sair é `decideOutbound`, que
 * consulta `getOutboundPolicy`. Usar `isChannelEnabled` como autorização deixa
 * passar canal habilitado sem consentimento.
 */
export function isChannelEnabled(code: MarketCode, channel: ChannelKind): boolean {
  return PACKS[code]?.channels.includes(channel) ?? false;
}

/** Type guard para valor vindo do banco ou de input externo. */
export function isMarketCode(value: unknown): value is MarketCode {
  return typeof value === 'string' && (MARKET_CODES as readonly string[]).includes(value);
}
