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

/**
 * Patch atomico ao trocar o tipo no inspector. A referencia anterior não pode
 * sobreviver a uma troca de familia (imagem -> audio, por exemplo), pois o
 * preview passaria a prometer uma nota de voz enquanto o storage ainda apontaria
 * para a imagem antiga.
 */
export function patchForMessageTypeChange(
  previous: MessageType,
  next: MessageType,
  currentAudioKind: AudioMessageKind = 'voice',
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    messageType: next,
    mediaKind: mediaKindForType(next),
    audioMessageKind: next === 'audio' ? currentAudioKind : undefined,
  };
  if (previous !== next) {
    patch['mediaStorageKey'] = undefined;
    patch['mediaUrl'] = undefined;
    patch['mediaType'] = undefined;
    patch['mediaFilename'] = undefined;
  }
  return patch;
}
