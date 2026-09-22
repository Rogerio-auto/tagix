/**
 * Prévia da última mensagem — a linha que o dono lê na lista e na tela "Hoje".
 *
 * ## Por que isto é um módulo compartilhado
 *
 * Existiam QUATRO implementações desta regra, em quatro workers. Uma estava
 * certa (`flows/outbound-publisher.ts`, humanizada) e três emitiam `[${type}]`
 * cru. Em produção o resultado era uma tela de leads onde a prévia dominante era
 * literalmente `[voice]` — sintaxe de máquina exibida para o dono do negócio.
 *
 * Quatro cópias de uma regra é a garantia de que três estarão erradas. Esta é a
 * única, e ninguém escreve `[${type}]` de novo.
 *
 * ## Duas funções, dois momentos
 *
 * - `previewFor` — na ESCRITA, quando temos tipo e conteúdo.
 * - `humanizePreview` — na LEITURA, para consertar o que já está gravado sem
 *   migration. As linhas antigas carregam o tipo dentro do próprio marcador
 *   (`[voice]`), então dá para traduzir na saída.
 */

/** Teto da prévia. Casa com o que já está gravado em `last_message_preview`. */
const MAX_PREVIEW = 280;

/**
 * Rótulo de mídia sem legenda. O emoji faz o trabalho que o texto sozinho não
 * faz numa lista escaneada de relance: o dono identifica o tipo antes de ler.
 */
const ROTULOS: Readonly<Record<string, string>> = {
  image: '📷 Foto',
  video: '🎬 Vídeo',
  voice: '🎤 Mensagem de voz',
  audio: '🎧 Áudio',
  document: '📄 Documento',
  sticker: '😀 Figurinha',
  location: '📍 Localização',
  contact: '👤 Contato',
  contacts: '👤 Contato',
  interactive: '💬 Mensagem interativa',
  template: '💬 Mensagem',
  reaction: '❤️ Reação',
  comment: '💬 Comentário',
  system: '💬 Mensagem',
  text: '💬 Mensagem',
};

/** Rótulo de um tipo, com fallback que nunca vaza sintaxe de máquina. */
export function labelForType(type: string): string {
  return ROTULOS[type] ?? '💬 Mensagem';
}

/**
 * Prévia a gravar em `conversations.last_message_preview`.
 *
 * O conteúdo real sempre vence o rótulo: uma foto COM legenda mostra a legenda,
 * porque é a legenda que diz se o lead quer orçamento ou está reclamando.
 */
export function previewFor(type: string, content: string | null | undefined): string {
  const texto = content?.trim();
  if (texto !== undefined && texto !== '') return texto.slice(0, MAX_PREVIEW);
  return labelForType(type);
}

/**
 * Marcador cru gravado pelas versões antigas: `[voice]`, `[image]`, `[system]`.
 * Ancorado nas duas pontas de propósito — uma mensagem que POR ACASO começa com
 * colchetes ("[URGENTE] preciso de orçamento") não pode ser confundida com um
 * marcador e apagada.
 */
const MARCADOR = /^\[([a-z_]+)\]$/;

/**
 * Traduz na LEITURA uma prévia já gravada. Idempotente: texto humano passa
 * intacto, e rodar duas vezes dá o mesmo resultado.
 *
 * Isto evita uma migration sobre `last_message_preview` — e, mais importante,
 * conserta as linhas antigas mesmo que uma delas venha a ser reescrita por um
 * caminho que ainda não passou por `previewFor`.
 */
export function humanizePreview(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const texto = raw.trim();
  if (texto === '') return null;
  const m = MARCADOR.exec(texto);
  return m?.[1] !== undefined ? labelForType(m[1]) : texto;
}
