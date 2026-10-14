import { describe, expect, it } from 'vitest';
import { patchForMessageTypeChange } from './types';

describe('patchForMessageTypeChange', () => {
  it('remove a referencia de midia ao trocar de imagem para audio', () => {
    expect(patchForMessageTypeChange('image', 'audio')).toMatchObject({
      messageType: 'audio',
      audioMessageKind: 'voice',
      mediaStorageKey: undefined,
      mediaUrl: undefined,
      mediaType: undefined,
      mediaFilename: undefined,
    });
  });

  it('nao limpa o arquivo quando o usuario clica no tipo ja selecionado', () => {
    const patch = patchForMessageTypeChange('image', 'image');
    expect(patch).not.toHaveProperty('mediaStorageKey');
    expect(patch['mediaKind']).toBe('image');
  });

  it('preserva a modalidade do audio ao clicar novamente no tipo', () => {
    expect(patchForMessageTypeChange('audio', 'audio', 'audio_file')['audioMessageKind']).toBe(
      'audio_file',
    );
  });
});
