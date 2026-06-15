/** Tipos compartilhados do node `message` (F31-S02). */

/** Tipo de mensagem selecionado no inspector. */
export type MessageType = 'text' | 'image' | 'video' | 'document' | 'audio';

/** Audio: nota de voz vs arquivo de audio encaminhado. */
export type AudioMessageKind = 'voice' | 'audio_file';

export const MESSAGE_TYPES: readonly MessageType[] = [
  'text',
  'image',
  'video',
  'document',
  'audio',
] as const;

/** Mapeia o tipo selecionado ao `mediaKind` outbound (audio decide depois). */
export function mediaKindForType(type: MessageType): string | undefined {
  switch (type) {
    case 'image':
      return 'image';
    case 'video':
      return 'video';
    case 'document':
      return 'document';
    default:
      return undefined;
  }
}
