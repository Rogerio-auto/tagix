import { describe, expect, it } from 'vitest';
import { deriveMediaState } from './useMediaResource';

/**
 * F52-S07 — máquina de estados pura da mídia (loading ≠ error; recuperação
 * acionável). Testada sem React/DOM (harness `node`).
 */

describe('deriveMediaState', () => {
  it('pending enquanto não há URL e não falhou', () => {
    expect(deriveMediaState({ url: null, status: 'live', failed: false })).toBe('pending');
  });

  it('ready quando há URL viva', () => {
    expect(deriveMediaState({ url: 'https://x/a.jpg', status: 'live', failed: false })).toBe(
      'ready',
    );
  });

  it('pending durante a reidratação (refresh em voo), mesmo com URL antiga', () => {
    expect(
      deriveMediaState({ url: 'https://x/old.jpg', status: 'refreshing', failed: false }),
    ).toBe('pending');
  });

  it('error quando o refresh falhou (status error), independentemente de URL', () => {
    expect(deriveMediaState({ url: 'https://x/a.jpg', status: 'error', failed: false })).toBe(
      'error',
    );
  });

  it('error quando o worker sinalizou falha e não há URL', () => {
    expect(deriveMediaState({ url: null, status: 'live', failed: true })).toBe('error');
  });

  it('failed com URL presente ainda renderiza (a URL servida prevalece)', () => {
    expect(deriveMediaState({ url: 'https://x/a.jpg', status: 'live', failed: true })).toBe(
      'ready',
    );
  });
});

describe('mídia que não existe mais (F61-S11)', () => {
  // Em produção eram 561 mensagens girando "carregando áudio…" para sempre.
  // Este bloco existe para isso não voltar.
  it('unavailable quando marcado e sem URL — não fica girando', () => {
    expect(
      deriveMediaState({ url: null, status: 'live', failed: false, unavailable: true }),
    ).toBe('unavailable');
  });

  it('unavailable ganha de failed — o motivo mais específico é o que informa', () => {
    // Ambos verdadeiros: dizer "erro, tente de novo" seria empurrar o usuário
    // para um beco que já sabemos que não tem saída.
    expect(
      deriveMediaState({ url: null, status: 'live', failed: true, unavailable: true }),
    ).toBe('unavailable');
  });

  it('URL servida prevalece sobre a marca antiga — mídia que voltou renderiza', () => {
    // Se um backfill posterior recuperou o arquivo, a marca velha não pode
    // esconder mídia que existe.
    expect(
      deriveMediaState({
        url: 'https://x/a.ogg',
        status: 'live',
        failed: false,
        unavailable: true,
      }),
    ).toBe('ready');
  });

  it('ausência da flag preserva o comportamento anterior', () => {
    expect(deriveMediaState({ url: null, status: 'live', failed: false })).toBe('pending');
    expect(
      deriveMediaState({ url: null, status: 'live', failed: false, unavailable: false }),
    ).toBe('pending');
  });
});
