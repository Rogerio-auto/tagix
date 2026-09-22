/**
 * Capacidades negociadas do adapter (F60-S01 — CANAIS_PLAN.md §3.1).
 *
 * `AdapterCapabilities` nasceu com forma de WhatsApp: toda entrada é um booleano
 * nomeado por um recurso da Meta (`templatesHSM`, `storyMentions`, `sticker`…).
 * Funciona bem para os três adapters de hoje e quebra quando e-mail e SMS entram:
 * e-mail não tem sticker nem localização, mas tem assunto, cópia oculta, anexo e
 * encadeamento; SMS tem segmentação e limite de caracteres.
 *
 * Acrescentar campos até virar uma lista de vinte booleanos, metade irrelevante
 * para cada adapter, é o caminho de volta ao `Record<string, any>` do v1.
 *
 * A saída é **aditiva**: o contrato antigo continua intacto (os três adapters
 * existentes não mudam uma linha) e ganha um conjunto declarativo por cima. Quem
 * monta mensagem — composer, wizard de campanha — **pergunta** em vez de saber.
 */

import type { AdapterCapabilities } from './types';

/**
 * Capacidades que um canal pode declarar.
 *
 * A lista cresce por canal novo, mas cada entrada descreve uma **habilidade de
 * composição**, não um recurso de um provider específico. É essa diferença que
 * impede a lista de virar despejo.
 */
export const CHANNEL_CAPABILITIES = [
  /** Exige modelo pré-aprovado pelo provider para iniciar conversa (WhatsApp HSM). */
  'approved_template_required',
  /** Mensagem tem linha de assunto (e-mail). */
  'subject',
  /** Corpo em HTML, além de texto puro (e-mail). */
  'html_body',
  /** Aceita anexo de arquivo (e-mail). */
  'attachments',
  /** Cópia e cópia oculta (e-mail). */
  'cc_bcc',
  /** Conversa é thread encadeada por cabeçalho, não fila linear (e-mail). */
  'threading',
  /** Texto tem limite duro de tamanho e é cobrado por segmento (SMS). */
  'segmented_text',
  /** Aceita mídia embutida na mensagem (WhatsApp, Instagram, MMS). */
  'media',
  /** Botões e listas interativas. */
  'interactive',
  /** Nota de voz nativa. */
  'voice_note',
  /** Figurinha. */
  'sticker',
  /** Localização. */
  'location',
  /** Reação a mensagem. */
  'reaction',
  /** Indicador de digitando/gravando. */
  'presence',
  /** Comentário público (Instagram). */
  'public_comments',
  /** Tag de mensagem fora da janela (Instagram). */
  'message_tags',
] as const;

export type ChannelCapability = (typeof CHANNEL_CAPABILITIES)[number];

/** Limites numéricos que a UI precisa para não deixar o usuário compor o impossível. */
export interface ChannelLimits {
  /** Caracteres por segmento; `null` quando não há segmentação. */
  readonly charactersPerSegment: number | null;
  /** Teto de segmentos por mensagem; `null` = sem teto conhecido. */
  readonly maxSegments: number | null;
  /** Bytes por anexo; `null` quando o canal não aceita anexo. */
  readonly maxAttachmentBytes: number | null;
}

export const NO_LIMITS: ChannelLimits = {
  charactersPerSegment: null,
  maxSegments: null,
  maxAttachmentBytes: null,
};

/**
 * Conjunto declarado por um adapter.
 *
 * `supports` é o único jeito de perguntar. Ler o `Set` direto funciona, mas o
 * método existe para que a intenção fique legível no ponto de uso:
 * `if (!caps.supports('subject')) esconderCampoDeAssunto()`.
 */
export interface DeclaredCapabilities {
  readonly limits: ChannelLimits;
  supports(capability: ChannelCapability): boolean;
  /** Lista ordenada, para UI e para log. */
  list(): readonly ChannelCapability[];
}

export function declareCapabilities(
  capabilities: readonly ChannelCapability[],
  limits: ChannelLimits = NO_LIMITS,
): DeclaredCapabilities {
  const set = new Set(capabilities);
  return {
    limits,
    supports: (c) => set.has(c),
    list: () => CHANNEL_CAPABILITIES.filter((c) => set.has(c)),
  };
}

/**
 * Ponte a partir do contrato antigo.
 *
 * Enquanto os adapters existentes não declararem capacidades por conta própria,
 * derivamos o conjunto dos booleanos que eles já expõem. Assim o consumidor novo
 * (composer, wizard) já funciona com WhatsApp, Instagram e WAHA **sem** alterar
 * uma linha desses adapters — que é o requisito do slot.
 *
 * Quando um adapter passar a declarar diretamente, esta função deixa de ser
 * usada para ele; ela não é o caminho definitivo, é a ponte.
 */
export function capabilitiesFromLegacy(
  legacy: AdapterCapabilities,
  limits: ChannelLimits = NO_LIMITS,
): DeclaredCapabilities {
  const caps: ChannelCapability[] = ['media', 'interactive', 'presence', 'reaction'];
  if (legacy.templatesHSM) caps.push('approved_template_required');
  if (legacy.voicePtt) caps.push('voice_note');
  if (legacy.sticker) caps.push('sticker');
  if (legacy.location) caps.push('location');
  if (legacy.publicComments) caps.push('public_comments');
  if (legacy.messageTags) caps.push('message_tags');
  return declareCapabilities(caps, limits);
}
