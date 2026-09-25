/**
 * F70-S27 — a bolha troca o "carregando" eterno por um estado de falha honesto.
 *
 * Incidente de 25/09: o storage recusou a credencial e o chat mostrou "carregando
 * áudio…" para sempre. Aqui se trava:
 *  - `failed` do servidor (ou o prazo vencido) vira `error`, não `pending`;
 *  - motivo terminal (mídia expirada na origem) vira `unavailable`, sem botão;
 *  - o aviso de erro mostra a frase clara, o motivo e o botão "Tentar de novo" só
 *    para quem pode.
 *
 * Ambiente `node` (sem DOM): o estado é função pura e o aviso é renderizado com
 * `react-dom/server`.
 */
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FileWarning } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/stores/auth.store', () => ({
  useAuthStore: () => undefined,
}));

// O vitest do @hm/web compila JSX no modo clássico (`React.createElement`), e o Next
// usa o automático — o componente não importa `React`. Só para este render no node.
Reflect.set(globalThis, 'React', React);

const { deriveMediaState, isTerminalFailure, MEDIA_PENDING_TIMEOUT_MS } =
  await import('./useMediaResource');
const { MediaError, failureDetail, readMediaFacts } = await import('./MessageBubble');

describe('deriveMediaState — falha visível (F70-S27)', () => {
  it('media_status failed do servidor, sem URL → error (não fica carregando)', () => {
    expect(
      deriveMediaState({ url: null, status: 'live', failed: false, mediaStatus: 'failed' }),
    ).toBe('error');
  });

  it('pendente além do prazo → error', () => {
    expect(
      deriveMediaState({
        url: null,
        status: 'live',
        failed: false,
        mediaStatus: 'pending',
        pendingExpired: true,
      }),
    ).toBe('error');
    expect(MEDIA_PENDING_TIMEOUT_MS).toBe(120_000);
  });

  it('pendente dentro do prazo segue carregando', () => {
    expect(
      deriveMediaState({ url: null, status: 'live', failed: false, mediaStatus: 'pending' }),
    ).toBe('pending');
  });

  it('mídia expirada na origem → unavailable (sem retry), mesmo com failed', () => {
    expect(isTerminalFailure('media_expired')).toBe(true);
    expect(
      deriveMediaState({
        url: null,
        status: 'live',
        failed: true,
        mediaStatus: 'failed',
        failureReason: 'media_expired',
      }),
    ).toBe('unavailable');
  });

  it('storage indisponível é recuperável → error', () => {
    expect(isTerminalFailure('storage_unavailable')).toBe(false);
    expect(
      deriveMediaState({
        url: null,
        status: 'live',
        failed: false,
        mediaStatus: 'failed',
        failureReason: 'storage_unavailable',
      }),
    ).toBe('error');
  });

  it('"tentar de novo" recém-pedido volta a carregar', () => {
    expect(
      deriveMediaState({ url: null, status: 'requeued', failed: true, mediaStatus: 'failed' }),
    ).toBe('pending');
  });

  it('mídia recuperada (URL servida) renderiza, mesmo com falha antiga', () => {
    expect(
      deriveMediaState({
        url: 'https://x/a.ogg',
        status: 'live',
        failed: true,
        mediaStatus: 'ready',
        failureReason: 'storage_unavailable',
      }),
    ).toBe('ready');
  });
});

describe('readMediaFacts', () => {
  it('lê status e motivo sem confiar no formato', () => {
    const facts = readMediaFacts({
      id: 'm1',
      conversationId: 'c1',
      direction: 'inbound',
      senderType: 'contact',
      type: 'audio',
      content: null,
      viewStatus: 'delivered',
      mediaUrl: null,
      createdAt: '2026-09-25T10:00:00Z',
      metadata: { mediaFailure: { reason: 'storage_unavailable', code: 'AccessDenied' } },
      ...{ mediaStatus: 'failed' },
    });
    expect(facts).toMatchObject({ mediaStatus: 'failed', failureReason: 'storage_unavailable' });
  });

  it('metadata malformada não quebra', () => {
    const facts = readMediaFacts({
      id: 'm1',
      conversationId: 'c1',
      direction: 'inbound',
      senderType: 'contact',
      type: 'audio',
      content: null,
      viewStatus: 'delivered',
      mediaUrl: null,
      createdAt: '2026-09-25T10:00:00Z',
      metadata: { mediaFailure: 'lixo' },
    });
    expect(facts).toMatchObject({ mediaStatus: null, failureReason: null });
  });
});

describe('MediaError — o aviso', () => {
  it('mostra a frase, o motivo sem jargão e o botão "Tentar de novo" para quem pode', () => {
    const html = renderToStaticMarkup(
      createElement(MediaError, {
        icon: FileWarning,
        label: 'Não foi possível carregar a mídia.',
        detail: failureDetail('storage_unavailable'),
        onRetry: () => undefined,
      }),
    );
    expect(html).toContain('Não foi possível carregar a mídia.');
    expect(html).toContain('A mídia é recuperada assim que ele voltar.');
    expect(html).toContain('Tentar de novo');
    expect(html).toContain('role="alert"');
    // Nada de jargão técnico nem código do provedor na tela.
    expect(html).not.toMatch(/AccessDenied|storage_unavailable|R2|bucket/);
  });

  it('sem permissão (sem onRetry): mostra o estado, sem botão', () => {
    const html = renderToStaticMarkup(
      createElement(MediaError, {
        icon: FileWarning,
        label: 'Não foi possível carregar o áudio.',
      }),
    );
    expect(html).toContain('Não foi possível carregar o áudio.');
    expect(html).not.toContain('Tentar de novo');
  });
});
