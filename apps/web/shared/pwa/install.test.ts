/**
 * F61-S05 — quando convidar para instalar, e quando calar a boca.
 *
 * O que este arquivo protege: que o convite nunca apareça para quem já instalou
 * (a forma mais rápida de o produto parecer burro), que o iPhone receba
 * instruções em vez de um botão que não instala, e que uma dispensa não vire
 * silêncio permanente — porque no iOS a instalação é a condição para o aviso de
 * lead novo existir.
 */
import { describe, expect, it } from 'vitest';
import { decidePlatform, dispensaAtiva, isIOS, isStandalone, DISPENSA_DIAS } from './install';

const DIA = 24 * 60 * 60 * 1000;

describe('isStandalone', () => {
  it('display-mode standalone basta', () => {
    expect(isStandalone({ displayMode: true, navigatorStandalone: false })).toBe(true);
  });

  it('navigator.standalone da Apple basta — é o mais confiável no iOS', () => {
    expect(isStandalone({ displayMode: false, navigatorStandalone: true })).toBe(true);
  });

  it('nenhum dos dois: não instalado', () => {
    expect(isStandalone({ displayMode: false, navigatorStandalone: false })).toBe(false);
  });
});

describe('isIOS', () => {
  it('reconhece iPhone', () => {
    expect(isIOS({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)' })).toBe(
      true,
    );
  });

  it('reconhece iPad moderno, que se diz Macintosh', () => {
    // O iPad com iPadOS 13+ manda user agent de Mac. A única pista que sobra é a
    // tela sensível ao toque.
    expect(isIOS({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 })).toBe(
      true,
    );
  });

  it('NÃO confunde Mac de verdade com iPad', () => {
    // Sem este corte, todo usuário de Mac veria instruções de iPhone.
    expect(
      isIOS({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 }),
    ).toBe(false);
  });

  it('user agent ausente não lança', () => {
    expect(isIOS({})).toBe(false);
  });
});

describe('decidePlatform', () => {
  it('quem já instalou NUNCA é convidado', () => {
    // Vence até o prompt nativo: um app instalado pedindo para ser instalado é a
    // forma mais rápida de parecer quebrado.
    expect(decidePlatform({ standalone: true, ios: true, temPromptNativo: true })).toBe('nenhum');
  });

  it('Chromium com prompt real ganha do caminho do iOS', () => {
    expect(decidePlatform({ standalone: false, ios: false, temPromptNativo: true })).toBe('prompt');
  });

  it('iOS sem prompt recebe instruções', () => {
    expect(decidePlatform({ standalone: false, ios: true, temPromptNativo: false })).toBe('ios');
  });

  it('navegador que não instala nada não é incomodado', () => {
    expect(decidePlatform({ standalone: false, ios: false, temPromptNativo: false })).toBe(
      'nenhum',
    );
  });
});

describe('dispensaAtiva', () => {
  const agora = 1_800_000_000_000;

  it('dispensa recente silencia', () => {
    expect(dispensaAtiva(String(agora - 2 * DIA), agora)).toBe(true);
  });

  it('depois de 14 dias volta a convidar', () => {
    expect(dispensaAtiva(String(agora - (DISPENSA_DIAS + 1) * DIA), agora)).toBe(false);
  });

  it('nunca dispensado', () => {
    expect(dispensaAtiva(null, agora)).toBe(false);
  });

  it('valor corrompido não esconde o convite para sempre', () => {
    // Um localStorage sujo não pode enterrar o convite que destrava o push. O
    // pior caso aceitável é mostrar o convite uma vez a mais.
    for (const lixo of ['', 'abc', '0', '-1', 'NaN', '{}']) {
      expect(dispensaAtiva(lixo, agora)).toBe(false);
    }
  });

  it('data no futuro (relógio errado) não silencia para sempre', () => {
    expect(dispensaAtiva(String(agora + 30 * DIA), agora)).toBe(false);
  });
});
