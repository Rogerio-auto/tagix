/**
 * Tipos locais do `MessageBubble` (F1-S15).
 *
 * `MessageItem.type` e `MessageItem.viewStatus` chegam da API como `string`
 * (espelham as colunas `messages.type` / `messages.view_status`, ambas com
 * CHECK no Postgres — ver `docs/DATA_MODEL.md`). Aqui estreitamos esses
 * `string`s para as uniões canônicas para conseguir um `switch` exaustivo com
 * `assertNever`, sem editar `features/conversations/types.ts` (fora do escopo
 * deste slot).
 */

/** Conjunto canônico de `messages.type` (DATA_MODEL.md). */
export type MessageType =
  // comuns
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'voice'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contact'
  | 'interactive'
  | 'template'
  | 'reaction'
  | 'system'
  // Instagram-específicos (stubs visuais neste slot)
  | 'story_mention'
  | 'story_reply'
  | 'share'
  | 'comment'
  | 'comment_reply'
  | 'ig_postback'
  | 'referral';

/** Conjunto canônico de `messages.view_status` (DATA_MODEL.md). */
export type ViewStatus =
  | 'pending'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'deleted';

const MESSAGE_TYPES: ReadonlySet<MessageType> = new Set<MessageType>([
  'text',
  'image',
  'video',
  'audio',
  'voice',
  'document',
  'sticker',
  'location',
  'contact',
  'interactive',
  'template',
  'reaction',
  'system',
  'story_mention',
  'story_reply',
  'share',
  'comment',
  'comment_reply',
  'ig_postback',
  'referral',
]);

const VIEW_STATUSES: ReadonlySet<ViewStatus> = new Set<ViewStatus>([
  'pending',
  'sending',
  'sent',
  'delivered',
  'read',
  'failed',
  'deleted',
]);

/**
 * Estreita o `type` cru (`string`) para `MessageType`. Valores desconhecidos
 * (ex.: um tipo novo no backend ainda não modelado aqui) caem em `'text'`, que
 * o `switch` renderiza de forma segura como `content`/placeholder — nunca quebra.
 */
export function toMessageType(raw: string): MessageType {
  return (MESSAGE_TYPES as ReadonlySet<string>).has(raw) ? (raw as MessageType) : 'text';
}

/** Estreita o `viewStatus` cru; desconhecido → `'pending'`. */
export function toViewStatus(raw: string): ViewStatus {
  return (VIEW_STATUSES as ReadonlySet<string>).has(raw) ? (raw as ViewStatus) : 'pending';
}

/**
 * Guarda de exaustividade. Se um `case` do `switch` for esquecido, o compilador
 * acusa porque o parâmetro deixa de ser `never`. Em runtime (tipo novo vindo do
 * backend) degrada para `null` no chamador, nunca lança em produção.
 */
export function assertNever(value: never): never {
  throw new Error(`Caso não tratado em MessageBubble: ${JSON.stringify(value)}`);
}
