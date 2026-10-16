'use client';

import { useEffect, useState } from 'react';

/**
 * Cor de um token do DS como `#RRGGBB`, lida do CSS em tempo de execução (F72-S07).
 *
 * Por que existe: `<input type="color">` só aceita `#RRGGBB`, e o valor inicial do seletor
 * (cor da tag nova, cor da marca ainda não escolhida) era um hex literal no componente.
 * Agora o padrão vem do PRÓPRIO token (`--brand`), então o seletor abre na cor da marca
 * do tema sem nenhum hex no código. A cor que o usuário escolhe é DADO (vai para a API
 * como `#RRGGBB`); a que ele não escolheu não é enviada (o servidor aplica o padrão).
 *
 * Sem DOM (SSR/teste em node) ou token fora do formato → `''` (o chamador decide).
 */
const HEX_RRGGBB = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: string): boolean {
  return HEX_RRGGBB.test(value);
}

export function readTokenHex(token: `--${string}`): string {
  if (typeof document === 'undefined') return '';
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return isHexColor(raw) ? raw.toUpperCase() : '';
}

/** `readTokenHex` como estado: resolve depois da montagem (sem divergir do HTML do servidor). */
export function useTokenHex(token: `--${string}`): string {
  const [hex, setHex] = useState('');
  useEffect(() => {
    setHex(readTokenHex(token));
  }, [token]);
  return hex;
}
