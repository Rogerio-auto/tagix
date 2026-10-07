/**
 * Política de URL vinda de e-mail (F60-S10 — mesma régua da F56-S07).
 *
 * Todo link e toda imagem de um e-mail recebido foram escritos por um
 * desconhecido. Duas superfícies diferentes leem essas URLs:
 *
 * 1. **O servidor**, quando busca um anexo por URL — aí o risco é SSRF clássico,
 *    e a defesa dura é o `ssrfSafeFetch`/`createGuardedLookup` de
 *    `@hm/shared/net`, que valida o IP no instante do connect.
 * 2. **O navegador do atendente**, quando renderiza o HTML — um
 *    `<img src="http://192.168.0.1/reboot">` faz o navegador logado de quem
 *    atende disparar um `GET` para a rede interna DELE (roteador, intranet,
 *    painel administrativo), sem clique. Não é SSRF do nosso servidor, mas é o
 *    mesmo ataque com outro intermediário.
 *
 * Este módulo é a camada síncrona e sem rede: decide pela forma da URL. O que
 * passa daqui ainda pode resolver para IP interno via DNS — por isso o caminho
 * de servidor (1) NUNCA confia só nesta função.
 */
import { isBlockedIpAddress } from '@hm/shared/net';

/** Sufixos de nome que só existem dentro de uma rede (RFC 6762, 8375, uso comum). */
const SUFIXOS_INTERNOS = [
  '.localhost',
  '.local',
  '.internal',
  '.intranet',
  '.lan',
  '.home.arpa',
  '.corp',
];

/**
 * O host aponta para dentro? Fail-closed para o que não dá para classificar.
 *
 * Inclui o nome de uma palavra só (`http://jenkins/`): fora de uma rede
 * corporativa ele não resolve, e dentro dela é exatamente o alvo.
 */
export function isInternalHost(hostnameBruto: string): boolean {
  let host = hostnameBruto.trim().toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host.length === 0) return true;

  // IP literal (v4 canônico — o `URL` já converte `2130706433` e `0x7f.1` — ou v6).
  if (/^[\d.]+$/.test(host) || host.includes(':')) return isBlockedIpAddress(host);

  if (host === 'localhost' || host === 'metadata' || host === 'metadata.google.internal') {
    return true;
  }
  if (SUFIXOS_INTERNOS.some((s) => host.endsWith(s))) return true;
  // Nome sem ponto só resolve por search domain da rede local.
  return !host.includes('.');
}

/** Motivo da recusa — para log e teste, nunca para o remetente. */
export type EmailUrlRejection = 'invalid_url' | 'scheme' | 'credentials' | 'internal_host';

export type EmailUrlCheck =
  | { readonly ok: true; readonly url: URL }
  | { readonly ok: false; readonly reason: EmailUrlRejection };

/**
 * URL absoluta de rede (`http:`/`https:`) que pode sair de um e-mail.
 *
 * Recusa credencial embutida (`https://user:pw@host`), que serve para disfarçar
 * o destino real ao olho humano, e qualquer host interno.
 */
export function checkEmailNetworkUrl(bruta: string): EmailUrlCheck {
  let url: URL;
  try {
    url = new URL(bruta);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'scheme' };
  }
  if (url.username !== '' || url.password !== '') return { ok: false, reason: 'credentials' };
  if (isInternalHost(url.hostname)) return { ok: false, reason: 'internal_host' };
  return { ok: true, url };
}
