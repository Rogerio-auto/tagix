/**
 * F61-S12 — a prévia é o que o dono lê de relance.
 *
 * O que este arquivo protege: que `[voice]` nunca mais chegue à tela. Em
 * produção era a prévia DOMINANTE de uma tela feita para o dono do negócio.
 */
import { describe, expect, it } from 'vitest';
import { humanizePreview, labelForType, previewFor } from './preview';

describe('previewFor — na escrita', () => {
  it('conteúdo real vence o rótulo: legenda de foto é o que decide a venda', () => {
    expect(previewFor('image', 'quanto fica 40m de piso?')).toBe('quanto fica 40m de piso?');
  });

  it('mídia sem legenda vira rótulo humano, nunca [type]', () => {
    expect(previewFor('voice', null)).toBe('🎤 Mensagem de voz');
    expect(previewFor('image', '')).toBe('📷 Foto');
    expect(previewFor('video', '   ')).toBe('🎬 Vídeo');
  });

  it('tipo desconhecido não vaza sintaxe de máquina', () => {
    // A regra é: o cliente nunca lê um identificador interno.
    const p = previewFor('tipo_do_futuro', null);
    expect(p).not.toMatch(/[[\]]/);
    expect(p).toBe('💬 Mensagem');
  });

  it('corta em 280 sem estourar a linha da lista', () => {
    expect(previewFor('text', 'a'.repeat(400))).toHaveLength(280);
  });
});

describe('humanizePreview — consertando o que já está gravado', () => {
  it('traduz o marcador cru que está no banco hoje', () => {
    expect(humanizePreview('[voice]')).toBe('🎤 Mensagem de voz');
    expect(humanizePreview('[image]')).toBe('📷 Foto');
    expect(humanizePreview('[system]')).toBe('💬 Mensagem');
  });

  it('texto humano passa intacto', () => {
    expect(humanizePreview('Di manhã e a noite')).toBe('Di manhã e a noite');
    expect(humanizePreview('https://payt.site/8oCl4ba')).toBe('https://payt.site/8oCl4ba');
  });

  it('NÃO come mensagem que por acaso começa com colchete', () => {
    // "[URGENTE] preciso de orçamento" é a mensagem mais valiosa da fila.
    // Um regex frouxo a transformaria em "💬 Mensagem".
    expect(humanizePreview('[URGENTE] preciso de orçamento')).toBe(
      '[URGENTE] preciso de orçamento',
    );
    expect(humanizePreview('[voice] e mais texto')).toBe('[voice] e mais texto');
  });

  it('é idempotente — rodar duas vezes dá o mesmo', () => {
    const uma = humanizePreview('[voice]');
    expect(humanizePreview(uma)).toBe(uma);
  });

  it('vazio e nulo viram null, não string vazia', () => {
    expect(humanizePreview(null)).toBeNull();
    expect(humanizePreview(undefined)).toBeNull();
    expect(humanizePreview('   ')).toBeNull();
  });
});

describe('labelForType', () => {
  it('todo tipo conhecido tem rótulo em português, com emoji', () => {
    for (const t of ['image', 'video', 'voice', 'audio', 'document', 'sticker', 'location']) {
      const l = labelForType(t);
      expect(l).not.toMatch(/[[\]]/);
      expect(l.length).toBeGreaterThan(2);
    }
  });
});
