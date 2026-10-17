/**
 * Marca de dado não confiável no `model_view` (F73-S07; COPILOTO.md P4, §8 R1; ADR-004 §6).
 *
 * O Node MARCA, o runtime DELIMITA: `render_model_view` (agent-runtime `app/copilot/prompt.py`)
 * só aplica o spotlighting ao que está na chave `untrusted` do `model_view` objeto; o resto é
 * tratado como confiável. Então TODO texto escrito por terceiro (cliente, quem agendou pela
 * página pública, quem mandou um documento à base) vai numa lista em `model_view.untrusted`,
 * um item por texto, cada item no formato
 *
 *     { untrusted: true, source, ...metadados do Node, text }
 *
 * O runtime delimita cada item da lista em bloco próprio. Os metadados (`role`, `at`, ids)
 * são do Node, mas ficam DENTRO do bloco junto do texto, serializados em JSON: um texto que
 * imite `"role":"human"` chega escapado, nunca como campo.
 *
 * O texto não é reescrito nem "limpo" aqui (o sentido chega intacto; quem neutraliza
 * delimitadores é o runtime, `neutralize_untrusted`). Só é recortado ao teto do item.
 */

/**
 * De onde veio o texto:
 * - `contact_message`: mensagem escrita pelo contato;
 * - `conversation_message`: mensagem NOSSA (pessoa ou IA) da mesma conversa. Não é texto do
 *   contato, mas a resposta da IA nasceu lendo o contato e a da pessoa pode citá-lo: vai
 *   marcada também (mais estrito que o mínimo do slot, sem custo para o modelo);
 * - `event`: título, notas e local de um compromisso (podem vir do agendamento público);
 * - `kb`: título e trecho de documento da base de conhecimento (podem ter vindo de terceiros).
 */
export const UNTRUSTED_SOURCES = [
  'contact_message',
  'conversation_message',
  'event',
  'kb',
] as const;
export type UntrustedSource = (typeof UNTRUSTED_SOURCES)[number];

/** Um texto de terceiro, no formato que o `model_view` leva. */
export type UntrustedItem<Meta extends Record<string, unknown> = Record<string, never>> = {
  readonly untrusted: true;
  readonly source: UntrustedSource;
  readonly text: string;
} & Readonly<Meta>;

/** Recorte de um texto de terceiro: fronteira de código Unicode, com reticências. */
export function clipUntrustedText(text: string, max: number): string {
  if (text.length <= max) return text;
  // `Array.from` separa por ponto de código: o corte nunca parte um emoji ao meio.
  const points = Array.from(text);
  if (points.length <= max) return text;
  return `${points.slice(0, max - 1).join('')}…`;
}

/**
 * Monta um item não confiável. `meta` não pode reaproveitar as chaves da marca: o TypeScript
 * recusa e, por garantia, a marca é escrita por último.
 */
export function untrusted<Meta extends Record<string, unknown>>(
  source: UntrustedSource,
  text: string,
  meta: Meta & { readonly untrusted?: never; readonly source?: never; readonly text?: never },
  maxChars: number,
): UntrustedItem<Meta> {
  return {
    ...meta,
    untrusted: true,
    source,
    text: clipUntrustedText(text, maxChars),
  } as UntrustedItem<Meta>;
}

/** O valor é um item marcado? (usado nos testes de forma) */
export function isUntrustedItem(value: unknown): value is UntrustedItem<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v['untrusted'] === true &&
    typeof v['text'] === 'string' &&
    typeof v['source'] === 'string' &&
    (UNTRUSTED_SOURCES as readonly string[]).includes(v['source'])
  );
}
