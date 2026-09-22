/**
 * F61-S01 — o que o service worker pode e o que NÃO pode cachear.
 *
 * Este arquivo é a razão de a regra morar em `sw-strategy.js` separada do worker:
 * um SW roda num contexto que o Vitest não tem, e a decisão que mais importa —
 * "isto pode ser servido do cache?" — é justamente a que precisa de teste.
 *
 * O que ele protege: que dado de negócio nunca vire cache. "12 leads esperando"
 * servido do cache de ontem é pior que um erro honesto — o erro faz o dono tentar
 * de novo, o número velho faz ele ir dormir tranquilo.
 */
import { describe, expect, it } from 'vitest';
// Módulo JS puro em `public/` — o mesmo arquivo que o service worker importa em
// runtime. Testar a cópia real, e não uma reimplementação, é o ponto.
import { chooseStrategy } from '../../public/sw-strategy.js';

const ORIGEM = 'https://app.leadium.com.br';

function req(url: string, extra: Record<string, unknown> = {}) {
  return { url: `${ORIGEM}${url}`, method: 'GET', sameOrigin: true, ...extra };
}

describe('dado de negócio NUNCA vem do cache', () => {
  it('/api é rede pura', () => {
    expect(chooseStrategy(req('/api/dashboard/today'))).toBe('network-only');
    expect(chooseStrategy(req('/api/conversations'))).toBe('network-only');
  });

  it('/auth é rede pura — um "logado" cacheado é um usuário que não está', () => {
    expect(chooseStrategy(req('/auth/session'))).toBe('network-only');
  });

  it('/socket.io é rede pura', () => {
    expect(chooseStrategy(req('/socket.io/?EIO=4'))).toBe('network-only');
  });

  it('nenhum método além de GET entra em cache', () => {
    // Um POST servido do cache seria uma ação repetida sem o usuário pedir.
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(chooseStrategy(req('/icons/icon-192.png', { method }))).toBe('network-only');
    }
  });

  it('origem externa passa direto — mídia assinada expira e voltaria 403', () => {
    expect(
      chooseStrategy({
        url: 'https://x.r2.cloudflarestorage.com/a.ogg?X-Amz-Signature=y',
        method: 'GET',
        sameOrigin: false,
      }),
    ).toBe('network-only');
  });
});

describe('o que pode ser cacheado', () => {
  it('build output com hash no nome é cache-first', () => {
    expect(chooseStrategy(req('/_next/static/chunks/main-abc123.js'))).toBe('cache-first');
  });

  it('navegação é network-first — a tela de ontem não serve', () => {
    expect(chooseStrategy(req('/hoje', { mode: 'navigate' }))).toBe('network-first');
    expect(chooseStrategy(req('/hoje', { destination: 'document' }))).toBe('network-first');
  });

  it('ícones e fontes são stale-while-revalidate', () => {
    expect(chooseStrategy(req('/icons/icon-192.png'))).toBe('stale-while-revalidate');
    expect(chooseStrategy(req('/f.woff2', { destination: 'font' }))).toBe(
      'stale-while-revalidate',
    );
  });
});

describe('o desconhecido cai na rede', () => {
  it('rota que ninguém previu não é cacheada', () => {
    // Um SW que cacheia o que não conhece vai mentir sobre alguma coisa que
    // ainda não foi inventada.
    expect(chooseStrategy(req('/rota-do-futuro'))).toBe('network-only');
  });

  it('URL inválida não lança', () => {
    expect(chooseStrategy({ url: '::::', method: 'GET', sameOrigin: true })).toBe('network-only');
  });
});

describe('regressão — a rota de API mais parecida com asset', () => {
  it('/api/... com extensão de imagem continua sendo rede', () => {
    expect(chooseStrategy(req('/api/contacts/avatar.png'))).toBe('network-only');
  });

  it('prefixo que só PARECE /api não é confundido', () => {
    // "/apiary" não é "/api/" — o guard usa a barra final de propósito.
    expect(chooseStrategy(req('/apiary/icons/x.png', { destination: 'image' }))).toBe(
      'stale-while-revalidate',
    );
  });
});
