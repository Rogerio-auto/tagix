/**
 * Busca de anexo de e-mail por URL, com guarda anti-SSRF (F60-S10, política F56-S07).
 *
 * Alguns provedores não mandam o binário do anexo no webhook: mandam uma URL e o
 * worker busca depois. Essa URL chegou num payload que nasceu de um e-mail — ou
 * seja, de um desconhecido. Sem guarda, `https://meu-dominio.com/x` que resolve
 * para `169.254.169.254` entrega as credenciais da máquina para quem mandou o
 * e-mail, e o anexo "baixado" é a resposta dos metadados da nuvem.
 *
 * Por que não o `ssrfSafeFetch` direto: ele corta a resposta em 64 KiB (feito
 * para o corpo de resposta de webhook) e devolveria anexo truncado em silêncio.
 * Aqui o teto é o do anexo e estourar o teto é RECUSA, nunca truncamento. As
 * peças de segurança são as mesmas, de `@hm/shared/net`:
 *
 *   1. `checkWebhookUrlSyntax` — `https:` obrigatório, sem credencial embutida,
 *      sem `localhost`, sem IP literal interno/de metadados;
 *   2. `createGuardedLookup` — o IP é validado NA resolução usada para conectar
 *      (fecha DNS-rebinding: não existe janela entre validar e conectar);
 *   3. redirect NUNCA é seguido — 302 para host interno é o bypass clássico.
 *
 * A allowlist de operador (`HM_WEBHOOK_HTTP_ALLOWLIST`) NÃO vale aqui: ela existe
 * para webhook de dev. O default é lista vazia; só teste injeta.
 */
import { Buffer } from 'node:buffer';
import type { IncomingMessage } from 'node:http';
import {
  checkWebhookUrlSyntax,
  createGuardedLookup,
  SsrfBlockedError,
  type DnsLookupAll,
} from '@hm/shared/net';

/** Por que a busca falhou. Curto, para metadado e log — nunca a URL. */
export type AttachmentFetchFailure =
  | 'unsafe_url'
  | 'redirect'
  | 'http_error'
  | 'too_large'
  | 'timeout'
  | 'network';

export type AttachmentFetchResult =
  | { readonly ok: true; readonly bytes: Buffer; readonly contentType: string | null }
  | { readonly ok: false; readonly reason: AttachmentFetchFailure; readonly status?: number };

export interface AttachmentFetchOptions {
  /** Teto do binário. Passou disso, a conexão é derrubada e o anexo recusado. */
  readonly maxBytes: number;
  /** Teto de tempo da busca inteira (conexão + corpo). */
  readonly timeoutMs: number;
  /** Cabeçalhos do provedor (ex.: autenticação para baixar o anexo). */
  readonly headers?: Readonly<Record<string, string>>;
  /** Resolver DNS injetável — é como o teste simula rebinding. */
  readonly lookupImpl?: DnsLookupAll;
  /**
   * Hosts liberados para `http:` e IP privado. **Só para teste.** Default: vazio,
   * e de propósito não lê o ambiente.
   */
  readonly allowHttpHosts?: readonly string[];
}

/** Assinatura da porta — o worker injeta, o teste troca. */
export type AttachmentFetcher = (
  url: string,
  options: AttachmentFetchOptions,
) => Promise<AttachmentFetchResult>;

/** Nome de uma palavra ou sufixo de rede interna: recusa antes de qualquer DNS. */
function hostObviamenteInterno(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (h.startsWith('[') || /^[\d.]+$/.test(h)) return false; // IP: a camada 1 já decidiu
  if (!h.includes('.')) return true;
  return ['.internal', '.local', '.localhost', '.lan', '.home.arpa', '.intranet', '.corp'].some(
    (s) => h.endsWith(s),
  );
}

function isSsrfError(err: unknown): boolean {
  if (err instanceof SsrfBlockedError) return true;
  if (typeof err !== 'object' || err === null) return false;
  return Reflect.get(err, 'code') === 'ERR_SSRF_BLOCKED';
}

/**
 * Busca o anexo. Nunca lança: toda falha vira `{ ok: false, reason }` — anexo que
 * não veio é registrado na mensagem, não derruba o e-mail inteiro.
 */
export const fetchEmailAttachment: AttachmentFetcher = async (url, options) => {
  const allowHttpHosts = options.allowHttpHosts ?? [];
  const syntax = checkWebhookUrlSyntax(url, { allowHttpHosts });
  if (!syntax.ok) return { ok: false, reason: 'unsafe_url' };
  const alvo = syntax.url;

  const host = alvo.hostname.toLowerCase().replace(/\.$/, '');
  const liberado = allowHttpHosts.includes(host);
  if (!liberado && hostObviamenteInterno(host)) return { ok: false, reason: 'unsafe_url' };

  const isHttps = alvo.protocol === 'https:';
  const [httpMod, httpsMod] = await Promise.all([import('node:http'), import('node:https')]);
  const hostname = host.startsWith('[') ? host.slice(1, -1) : host;
  const signal = AbortSignal.timeout(options.timeoutMs);

  return new Promise<AttachmentFetchResult>((resolve) => {
    let encerrado = false;
    const fim = (r: AttachmentFetchResult): void => {
      if (encerrado) return;
      encerrado = true;
      resolve(r);
    };

    const onResponse = (res: IncomingMessage): void => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        // Redirect NUNCA é seguido: é exatamente como se contorna a guarda.
        res.destroy();
        fim({ ok: false, reason: 'redirect', status });
        return;
      }
      if (status < 200 || status >= 300) {
        res.destroy();
        fim({ ok: false, reason: 'http_error', status });
        return;
      }
      const anunciado = Number(res.headers['content-length']);
      if (Number.isFinite(anunciado) && anunciado > options.maxBytes) {
        res.destroy();
        fim({ ok: false, reason: 'too_large' });
        return;
      }

      const partes: Buffer[] = [];
      let recebido = 0;
      res.on('data', (chunk: Buffer) => {
        recebido += chunk.length;
        if (recebido > options.maxBytes) {
          // Content-Length mentiu (ou não veio): corta na hora, sem acumular.
          res.destroy();
          fim({ ok: false, reason: 'too_large' });
          return;
        }
        partes.push(chunk);
      });
      res.on('end', () => {
        const tipo = res.headers['content-type'];
        fim({
          ok: true,
          bytes: Buffer.concat(partes),
          contentType: typeof tipo === 'string' ? tipo : null,
        });
      });
      res.on('error', () => fim({ ok: false, reason: signal.aborted ? 'timeout' : 'network' }));
    };

    const req = (isHttps ? httpsMod : httpMod).request(
      {
        hostname,
        port: alvo.port !== '' ? Number(alvo.port) : isHttps ? 443 : 80,
        path: `${alvo.pathname}${alvo.search}`,
        method: 'GET',
        headers: { ...(options.headers ?? {}), accept: '*/*' },
        signal,
        ...(liberado
          ? {}
          : {
              lookup: createGuardedLookup(
                options.lookupImpl !== undefined ? { lookupImpl: options.lookupImpl } : {},
              ),
            }),
      },
      onResponse,
    );
    req.on('error', (err: unknown) => {
      if (isSsrfError(err)) fim({ ok: false, reason: 'unsafe_url' });
      else fim({ ok: false, reason: signal.aborted ? 'timeout' : 'network' });
    });
    req.end();
  });
};
