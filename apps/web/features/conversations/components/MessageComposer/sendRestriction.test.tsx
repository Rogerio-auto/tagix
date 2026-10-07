/**
 * F60-S11 — o composer mostra a restrição de envio: por quê e quando volta a poder.
 *
 * Trava:
 *  - a tela NÃO recalcula regra: o modo vem só de `restriction` + flags da janela;
 *  - o portão vence a janela (suprimido dentro das 24h fica travado, sem CTA);
 *  - a janela de 24h do WhatsApp segue igual (regressão);
 *  - contato suprimido tem texto próprio, que diz que não é defeito;
 *  - `retryAt` vira horário legível; sem `retryAt`, a condição que libera.
 *
 * Ambiente `node` (sem DOM): estado puro + render com `react-dom/server`.
 */
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SendRestriction, WindowResponse, WindowState } from './useWindowState';

// O vitest do @hm/web compila JSX no modo clássico (`React.createElement`).
Reflect.set(globalThis, 'React', React);

const { composerGate, formatRetryAt, restrictionCopy, untilLine } =
  await import('./sendRestriction');
const { RestrictionNotice, RestrictionCheckError } = await import('./RestrictionNotice');
const { WindowNotice } = await import('./WindowNotice');

function janela(over: Partial<WindowState> = {}): WindowState {
  return {
    provider: 'meta_whatsapp',
    isOpen: true,
    expiresAt: null,
    requiresTemplate: false,
    messageTag: null,
    ...over,
  };
}

const LIBERADO: SendRestriction = { canSend: true, reason: 'ok', message: '', retryAt: null };

function resposta(window: WindowState, restriction?: SendRestriction): WindowResponse {
  return restriction === undefined ? { window } : { window, restriction };
}

describe('composerGate — a tela só lê a decisão da API', () => {
  it('sem resposta ainda: não trava (a API confere no envio)', () => {
    expect(composerGate(undefined)).toEqual({ kind: 'unknown' });
  });

  it('dentro da janela e liberado: aberto', () => {
    expect(composerGate(resposta(janela(), LIBERADO))).toEqual({ kind: 'open' });
  });

  it('recusa do portão trava com motivo, frase e retryAt da API', () => {
    const gate = composerGate(
      resposta(janela(), {
        canSend: false,
        reason: 'quiet_hours',
        message: 'Fora da janela permitida.',
        retryAt: '2026-10-08T11:00:00.000Z',
      }),
    );
    expect(gate).toEqual({
      kind: 'blocked',
      reason: 'quiet_hours',
      message: 'Fora da janela permitida.',
      retryAt: '2026-10-08T11:00:00.000Z',
    });
  });

  it('o portão vence a janela: suprimido fora das 24h trava, não vira modo modelo', () => {
    const gate = composerGate(
      resposta(janela({ isOpen: false, requiresTemplate: true }), {
        canSend: false,
        reason: 'suppressed',
        message: 'Contato pediu para não receber mensagens por WhatsApp.',
        retryAt: null,
      }),
    );
    expect(gate.kind).toBe('blocked');
  });

  it('a tela não inventa bloqueio: janela fechada sem recusa do portão não trava', () => {
    // Mesmo com isOpen false, quem decide é `restriction`. Instagram fora da
    // janela segue liberado com a tag.
    const gate = composerGate(
      resposta(janela({ provider: 'meta_instagram', isOpen: false, messageTag: 'HUMAN_AGENT' }), {
        canSend: true,
        reason: 'provider_window',
        message: 'Fora da janela de 24 horas: o envio usará a tag de atendimento humano.',
        retryAt: null,
      }),
    );
    expect(gate).toEqual({ kind: 'tagged' });
  });

  it('motivo desconhecido com canSend false continua travado, com texto genérico', () => {
    const gate = composerGate(
      resposta(janela(), {
        canSend: false,
        reason: 'ok',
        message: 'Recusado.',
        retryAt: null,
      }),
    );
    expect(gate).toMatchObject({ kind: 'blocked', reason: null });
    expect(restrictionCopy(null).title).toContain('travado');
  });
});

describe('regressão — janela de 24h do WhatsApp', () => {
  const foraDaJanela = janela({
    isOpen: false,
    requiresTemplate: true,
    expiresAt: '2026-10-06T12:00:00.000Z',
  });

  it('fora das 24h: modo modelo aprovado (texto livre travado)', () => {
    expect(
      composerGate(
        resposta(foraDaJanela, {
          canSend: true,
          reason: 'provider_window',
          message: 'Fora da janela de 24 horas: só um modelo aprovado reabre a conversa.',
          retryAt: null,
        }),
      ),
    ).toEqual({ kind: 'template' });
  });

  it('API anterior à restrição (descompasso de deploy) mantém a trava antiga', () => {
    expect(composerGate(resposta(foraDaJanela))).toEqual({ kind: 'template' });
    expect(composerGate(resposta(janela()))).toEqual({ kind: 'open' });
  });

  it('o aviso de 24h continua um alerta com o mesmo texto', () => {
    const html = renderToStaticMarkup(createElement(WindowNotice, { window: foraDaJanela }));
    expect(html).toContain('role="alert"');
    expect(html).toContain('Janela de 24h encerrada');
    expect(html).toContain('template aprovado');
  });

  it('CTA de reabrir só aparece com destino real (sem botão morto)', () => {
    const sem = renderToStaticMarkup(createElement(WindowNotice, { window: foraDaJanela }));
    expect(sem).not.toContain('Reabrir com template');

    const com = renderToStaticMarkup(
      createElement(WindowNotice, { window: foraDaJanela, onReopenWithTemplate: () => undefined }),
    );
    expect(com).toContain('Reabrir com template');
  });
});

describe('contato suprimido — texto próprio, deixa claro que não é defeito', () => {
  const gate = {
    kind: 'blocked' as const,
    reason: 'suppressed' as const,
    message: 'Contato pediu para não receber mensagens por WhatsApp.',
    retryAt: null,
  };

  it('tem título, motivo da API, garantia de que não é falha e prazo', () => {
    const html = renderToStaticMarkup(createElement(RestrictionNotice, { gate }));
    expect(html).toContain('Envio travado a pedido do contato');
    expect(html).toContain('por WhatsApp');
    expect(html).toContain('Não é uma falha do sistema');
    expect(html).toContain('Sem previsão de liberação');
    expect(html).toContain('data-restriction="suppressed"');
  });

  it('tom neutro, não de erro: suprimir é o sistema funcionando', () => {
    expect(restrictionCopy('suppressed').tone).toBe('neutral');
    const html = renderToStaticMarkup(createElement(RestrictionNotice, { gate }));
    expect(html).not.toContain('danger');
    expect(html).not.toContain('role="alert"');
  });

  it('cada motivo do portão tem texto próprio e completo', () => {
    const motivos = [
      'suppressed',
      'no_consent',
      'quiet_hours',
      'registration_pending',
      'channel_disabled',
    ] as const;
    const titulos = new Set<string>();
    for (const motivo of motivos) {
      const copy = restrictionCopy(motivo);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.reassurance).toContain('Não é uma falha');
      expect(copy.until.length).toBeGreaterThan(0);
      titulos.add(copy.title);
    }
    expect(titulos.size).toBe(motivos.length);
  });
});

describe('quando volta a poder', () => {
  const tz = 'America/Sao_Paulo';
  const agora = new Date('2026-10-07T15:00:00.000Z'); // 12:00 em São Paulo

  it('mesmo dia: "hoje às"', () => {
    expect(formatRetryAt('2026-10-07T20:30:00.000Z', agora, tz)).toBe('hoje às 17:30');
  });

  it('dia seguinte: "amanhã às"', () => {
    expect(formatRetryAt('2026-10-08T11:00:00.000Z', agora, tz)).toBe('amanhã às 08:00');
  });

  it('mais longe: dia da semana e data', () => {
    const texto = formatRetryAt('2026-10-12T11:00:00.000Z', agora, tz);
    expect(texto).toContain('12/10');
    expect(texto).toContain('08:00');
  });

  it('data inválida não vira horário inventado', () => {
    expect(formatRetryAt('não-é-data', agora, tz)).toBeNull();
    expect(
      untilLine(
        { kind: 'blocked', reason: 'quiet_hours', message: '', retryAt: 'lixo' },
        agora,
        tz,
      ),
    ).toBe(restrictionCopy('quiet_hours').until);
  });

  it('com retryAt, a linha traz o horário exato', () => {
    expect(
      untilLine(
        {
          kind: 'blocked',
          reason: 'quiet_hours',
          message: 'Fora da janela permitida.',
          retryAt: '2026-10-08T11:00:00.000Z',
        },
        agora,
        tz,
      ),
    ).toBe('Volta a poder amanhã às 08:00.');
  });
});

describe('falha ao consultar ≠ liberado', () => {
  it('diz o que falhou, o que fazer e oferece tentar de novo', () => {
    const html = renderToStaticMarkup(
      createElement(RestrictionCheckError, { onRetry: () => undefined, retrying: false }),
    );
    expect(html).toContain('Não foi possível conferir');
    expect(html).toContain('confere as regras do canal na hora de enviar');
    expect(html).toContain('Tentar de novo');
  });

  it('em andamento: botão desabilitado e ocupado', () => {
    const html = renderToStaticMarkup(
      createElement(RestrictionCheckError, { onRetry: () => undefined, retrying: true }),
    );
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
  });
});
