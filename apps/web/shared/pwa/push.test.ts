/**
 * F61-S03 — quando pedir permissão de notificação, e quando NÃO pedir.
 *
 * O que este arquivo protege: a única chance. No iOS a permissão negada é
 * lembrada e só volta pelas configurações do navegador — pedir na hora errada
 * (numa aba, antes de instalar, ou para quem já negou) queima o canal que
 * sustenta o tempo de resposta, que é o número que fecha venda.
 */
import { describe, expect, it } from 'vitest';
import { decidePushState, urlBase64ToUint8Array } from './push';

const base = {
  suportado: true,
  temChavePublica: true,
  permissao: 'default' as NotificationPermission | null,
  jaAssinado: false,
  standalone: true,
  ios: false,
};

describe('decidePushState', () => {
  it('sem suporte do navegador: não mostrar nada', () => {
    expect(decidePushState({ ...base, suportado: false })).toBe('indisponivel');
  });

  it('sem VAPID no servidor: não oferecer o que não funciona', () => {
    expect(decidePushState({ ...base, temChavePublica: false })).toBe('indisponivel');
  });

  it('iOS numa aba precisa instalar ANTES', () => {
    // O Safari só entrega push para app na tela de início. Pedir permissão numa
    // aba do iOS gasta a única chance que existe.
    expect(decidePushState({ ...base, ios: true, standalone: false })).toBe('precisa-instalar');
  });

  it('iOS instalado pode ativar', () => {
    expect(decidePushState({ ...base, ios: true, standalone: true })).toBe('pode-ativar');
  });

  it('quem negou NÃO recebe convite — nem no iOS não instalado', () => {
    // Bloqueado vem antes de "precisa instalar": insistir com quem já negou é o
    // caminho mais curto para o dono desinstalar o app.
    expect(decidePushState({ ...base, permissao: 'denied' })).toBe('bloqueado');
    expect(decidePushState({ ...base, permissao: 'denied', ios: true, standalone: false })).toBe(
      'bloqueado',
    );
  });

  it('assinado e permitido é ativo', () => {
    expect(decidePushState({ ...base, jaAssinado: true, permissao: 'granted' })).toBe('ativo');
  });

  it('assinado mas SEM permissão não é ativo — a permissão manda', () => {
    // Permissão revogada nos ajustes do sistema deixa a assinatura órfã: dizer
    // "ativo" faria o dono confiar num aviso que não vai chegar.
    expect(decidePushState({ ...base, jaAssinado: true, permissao: 'default' })).toBe(
      'pode-ativar',
    );
  });

  it('desktop sem assinatura pode ativar', () => {
    expect(decidePushState(base)).toBe('pode-ativar');
  });
});

describe('urlBase64ToUint8Array', () => {
  it('decodifica base64url com os caracteres trocados', () => {
    // `-` e `_` no lugar de `+` e `/`: passar direto para atob falha em algumas
    // chaves e funciona em outras — um bug que só aparece com certas chaves.
    const bytes = urlBase64ToUint8Array('-_8');
    expect(Array.from(bytes)).toEqual([251, 255]);
  });

  it('repõe o padding omitido', () => {
    expect(urlBase64ToUint8Array('QQ').length).toBe(1);
    expect(urlBase64ToUint8Array('QUJD').length).toBe(3);
  });

  it('chave VAPID real (65 bytes de ponto P-256 descomprimido)', () => {
    const chave =
      'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
    expect(urlBase64ToUint8Array(chave).length).toBe(65);
  });
});
