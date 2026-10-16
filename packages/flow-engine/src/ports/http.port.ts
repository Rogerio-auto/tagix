/**
 * HTTP port real do no `http_request` (FLOW_BUILDER.md secao 6.1/12) — com guarda anti-SSRF
 * (F75-S16, politica F56-S07).
 *
 * A URL do no e montada por quem edita o flow (admin da empresa) e interpolada com variaveis
 * da conversa. Sem guarda, `http://169.254.169.254/latest/meta-data` entrega as credenciais
 * da maquina e `http://redis:6379` abre a rede interna. As pecas sao as mesmas dos webhooks
 * de saida, de `@hm/shared/net`:
 *
 *   1. checagem sintatica (sync): so `http:`/`https:`, sem credencial embutida na URL, sem
 *      `localhost`, IP literal interno (v4/v6, inclusive IPv4-mapped) recusado antes de
 *      qualquer conexao — o Node NAO chama `lookup` para IP literal, entao esta camada e a
 *      unica barreira para eles. Porta so 80, 443 ou 1024–65535 (sem varredura de servicos
 *      de sistema: SSH 22, SMTP 25, etc.);
 *   2. `createGuardedLookup` no socket: o IP e validado NA resolucao usada para conectar
 *      (anti-DNS-rebinding — nao existe janela entre "validei" e "conectei");
 *   3. redirect seguido MANUALMENTE so para 301/302/303/307/308 (o `fetch` seguia ate 20
 *      saltos; aqui no maximo `MAX_REDIRECTS`), e CADA salto passa de novo pelas camadas 1 e
 *      2 — o 302 para host interno e o bypass classico. Mudou de origem: so cabecalhos
 *      inofensivos sobrevivem (nenhuma credencial customizada vaza para o novo host).
 *
 * Cabecalhos do usuario: os de transporte/roteamento (`host`, `connection`, `transfer-
 * encoding`, `content-length`, `proxy-*`, `forwarded`, `x-forwarded-*`, `x-real-ip`, ...) sao
 * descartados ANTES de aplicar os nossos — o flow nao forja Host (virtual host interno atras
 * de proxy reverso) nem smuggling por `content-length`/`transfer-encoding` conflitantes.
 *
 * Por que nao o `ssrfSafeFetch` direto: (a) ele exige `https:` fora da allowlist, e o no
 * sempre aceitou `http:` para destino publico; (b) ele nunca segue redirect, e o no seguia;
 * (c) ele trunca o corpo em 64 KiB, e o no lia a resposta inteira para mapear JSONPath —
 * JSON truncado vira texto em silencio. Aqui o corpo e lido em streaming ate
 * `MAX_RESPONSE_BYTES` (1 MiB, medido DEPOIS da descompressao — anti zip-bomb); estourou,
 * a conexao cai e a chamada falha com erro explicito (nunca truncamento).
 *
 * Allowlist de dev: `HM_FLOW_HTTP_ALLOWLIST` (CSV de hostnames, opt-in do operador, nunca do
 * tenant), PROPRIA do flow — a dos webhooks (`HM_WEBHOOK_HTTP_ALLOWLIST`) nao vale aqui:
 * liberar um teste de webhook nao pode abrir a rede para todo flow. Lida a cada chamada.
 * Mesmo nela: entrada que seja IP literal de link-local/metadados (169.254.0.0/16,
 * fe80::/10, fd00:ec2::254, equivalentes IPv4-mapped/NAT64) ou hostname de metadados e
 * IGNORADA, e host liberado ainda resolve por um lookup que recusa esses enderecos. Lista
 * nao vazia emite um aviso de log uma vez por processo (allowlist em producao e incidente).
 *
 * Erros: bloqueio vira `FlowHttpBlockedError` (`code = 'ssrf_blocked'`, `reason` interna ou
 * porta) com mensagem fixa em PT-BR. O `SsrfBlockedError` original carrega host e IP
 * resolvido na mensagem — ele NUNCA atravessa este port. Todo o resto vira `FlowHttpError`
 * com codigo estavel e mensagem fixa de `FLOW_HTTP_ERROR_MESSAGES`; o erro cru (ENOTFOUND,
 * ECONNREFUSED, ...) fica so em `cause`, para log interno.
 *
 * Node-only em runtime, mas sem built-in no top-level (so `import type`): `node:http(s)`,
 * `node:dns` e `node:zlib` entram por import dinamico, como em `@hm/shared/net`.
 */
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';
import type { LookupFunction } from 'node:net';
import type { Readable, Transform } from 'node:stream';
import { createLogger } from '@hm/logger';
import { createGuardedLookup, isBlockedIpAddress, type DnsLookupAll } from '@hm/shared/net';
import type { FlowHttpPort } from '../deps';
import type { FlowHttpRequest, FlowHttpResponse } from '../types';

const DEFAULT_TIMEOUT_MS = 30_000;
/** Teto do corpo de resposta (descomprimido). Passou disso: recusa, nunca truncamento. */
export const MAX_RESPONSE_BYTES = 1024 * 1024;
/** Saltos de redirect seguidos (cada um revalidado). O 6o 3xx falha a chamada. */
export const MAX_REDIRECTS = 5;
/** Variavel de ambiente da allowlist de dev do no de flow (propria; nao a dos webhooks). */
export const FLOW_HTTP_ALLOWLIST_ENV = 'HM_FLOW_HTTP_ALLOWLIST';

/** Codigo estavel do bloqueio — o handler e o log da execucao dependem dele. */
export const SSRF_BLOCKED_CODE = 'ssrf_blocked';
/** Mensagem fixa, legivel, sem host nem IP. */
export const SSRF_BLOCKED_MESSAGE = 'Endereço bloqueado por segurança: rede interna';
/** Porta fora de 80/443/1024–65535 — mesmo codigo (`ssrf_blocked`), mensagem propria. */
export const SSRF_PORT_BLOCKED_MESSAGE = 'Endereço bloqueado por segurança: porta não permitida';

export type FlowHttpBlockedReason = 'internal_network' | 'port';

/** Destino recusado pela guarda. Mensagem fixa: nunca carrega host/IP resolvido. */
export class FlowHttpBlockedError extends Error {
  readonly code = SSRF_BLOCKED_CODE;
  readonly reason: FlowHttpBlockedReason;

  constructor(reason: FlowHttpBlockedReason = 'internal_network') {
    super(reason === 'port' ? SSRF_PORT_BLOCKED_MESSAGE : SSRF_BLOCKED_MESSAGE);
    this.name = 'FlowHttpBlockedError';
    this.reason = reason;
  }
}

/** Reconhece o bloqueio por `code` (o port e injetavel: nao dependa de `instanceof`). */
export function isFlowHttpBlockedError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  return Reflect.get(err, 'code') === SSRF_BLOCKED_CODE;
}

/** Mensagem publica de um bloqueio (fixa por `reason`; nunca a `message` do erro injetado). */
export function flowHttpBlockedMessage(err: unknown): string {
  const reason = typeof err === 'object' && err !== null ? Reflect.get(err, 'reason') : undefined;
  return reason === 'port' ? SSRF_PORT_BLOCKED_MESSAGE : SSRF_BLOCKED_MESSAGE;
}

/**
 * Mensagens publicas (PT-BR) por codigo. Sao as UNICAS que chegam a `webhook_error`: nenhuma
 * carrega host, IP, porta ou texto cru do sistema operacional.
 */
export const FLOW_HTTP_ERROR_MESSAGES = {
  timeout: 'Tempo limite da requisição HTTP excedido',
  response_too_large: 'Resposta HTTP excede o limite de 1 MiB',
  too_many_redirects: `Redirecionamentos demais (limite ${MAX_REDIRECTS})`,
  invalid_url: 'URL inválida no nó de requisição HTTP',
  invalid_redirect: 'Redirecionamento para URL inválida',
  invalid_header: 'Cabeçalho inválido na requisição HTTP',
  network_error: 'Falha de rede ao chamar o endereço',
} as const;

export type FlowHttpErrorCode = keyof typeof FLOW_HTTP_ERROR_MESSAGES;

/** Falha nao-SSRF do port: codigo estavel + mensagem fixa; detalhe cru so em `cause`. */
export class FlowHttpError extends Error {
  readonly code: FlowHttpErrorCode;

  constructor(code: FlowHttpErrorCode, cause?: unknown) {
    super(FLOW_HTTP_ERROR_MESSAGES[code], cause !== undefined ? { cause } : undefined);
    this.name = 'FlowHttpError';
    this.code = code;
  }
}

/** Codigo de `FlowHttpError` (por `code`, nao `instanceof`), ou `null`. */
export function flowHttpErrorCode(err: unknown): FlowHttpErrorCode | null {
  if (typeof err !== 'object' || err === null) return null;
  const code: unknown = Reflect.get(err, 'code');
  if (typeof code !== 'string' || !Object.hasOwn(FLOW_HTTP_ERROR_MESSAGES, code)) return null;
  return code as FlowHttpErrorCode;
}

/** Logger minimo do port (injetavel em teste). */
export interface FlowHttpPortLogger {
  warn(message: string, fields?: Record<string, unknown>): void;
}

export interface FlowHttpPortOptions {
  /**
   * Hostnames (match exato, case-insensitive) liberados a apontar para rede privada.
   * Default: `HM_FLOW_HTTP_ALLOWLIST` lido a cada chamada. Opt-in do operador, nunca do tenant.
   * Entradas de link-local/metadados sao ignoradas mesmo aqui.
   */
  readonly allowHttpHosts?: readonly string[];
  /** Resolver DNS injetavel (testes de rebinding). Default: `node:dns` real. */
  readonly lookupImpl?: DnsLookupAll;
  /** Destino do aviso de allowlist ativa. Default: `@hm/logger`. */
  readonly logger?: FlowHttpPortLogger;
}

// ─── Allowlist de dev ────────────────────────────────────────────────────────────

/** Hostnames de servico de metadados de nuvem: nunca liberaveis. */
const METADATA_HOSTNAMES = new Set([
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'instance-data.ec2.internal',
]);

function parseIpv4(value: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (!m) return null;
  let out = 0;
  for (let i = 1; i <= 4; i += 1) {
    const octet = Number(m[i]);
    if (!Number.isInteger(octet) || octet > 255) return null;
    out = out * 256 + octet;
  }
  return out;
}

/** IPv6 (com ou sem colchetes, zona, IPv4 embutido) → 8 hextets, ou null. */
function parseIpv6(value: string): number[] | null {
  let s = value.replace(/^\[/, '').replace(/\]$/, '');
  const zone = s.indexOf('%');
  if (zone !== -1) s = s.slice(0, zone);
  if (!s.includes(':')) return null;
  const lastColon = s.lastIndexOf(':');
  const lastPart = s.slice(lastColon + 1);
  if (lastPart.includes('.')) {
    const v4 = parseIpv4(lastPart);
    if (v4 === null) return null;
    s = `${s.slice(0, lastColon + 1)}${Math.floor(v4 / 65536).toString(16)}:${(v4 % 65536).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const groups = [...head, ...tail];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  if (halves.length === 1 && groups.length !== 8) return null;
  if (halves.length === 2 && groups.length > 7) return null;
  const fill = new Array<string>(8 - groups.length).fill('0');
  return [...head, ...fill, ...tail].map((g) => parseInt(g, 16));
}

const isLinkLocalV4 = (v4: number): boolean => Math.floor(v4 / 65536) === 0xa9fe; // 169.254/16

/**
 * Endereco de link-local / metadados de nuvem: 169.254.0.0/16, fe80::/10, fd00:ec2::254
 * (IMDS IPv6 da AWS) e 169.254/16 embutido (IPv4-mapped, IPv4-compatible, NAT64 64:ff9b::/96).
 */
export function isMetadataOrLinkLocalAddress(address: string): boolean {
  const v4 = parseIpv4(address);
  if (v4 !== null) return isLinkLocalV4(v4);
  const h = parseIpv6(address);
  if (h === null) return false;
  const [h0 = 0, h1 = 0, h2 = 0, h3 = 0, h4 = 0, h5 = 0, h6 = 0, h7 = 0] = h;
  if ((h0 & 0xffc0) === 0xfe80) return true;
  if (h0 === 0xfd00 && h1 === 0x0ec2 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) {
    if (h6 === 0 && h7 === 0x0254) return true;
  }
  const embeddedV4 = h6 * 65536 + h7;
  const zeros0to4 = h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0;
  const mapped = zeros0to4 && h5 === 0xffff;
  const compatible = zeros0to4 && h5 === 0;
  const nat64 = h0 === 0x64 && h1 === 0xff9b && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0;
  return (mapped || compatible || nat64) && isLinkLocalV4(embeddedV4);
}

/**
 * Normaliza uma entrada para a forma que `URL.hostname` produz (e contra a qual o match e
 * feito). Entrada que nao e um hostname/IP puro (porta, caminho, credencial) e invalida.
 */
function canonicalAllowlistEntry(raw: string): string | null {
  const entry = raw.trim().toLowerCase().replace(/\.$/, '');
  if (entry === '' || /[/@?#\s]/.test(entry)) return null;
  const colons = entry.split(':').length - 1;
  if (colons === 1) return null; // `host:porta` — a allowlist e por host
  const bracketed = colons >= 2 && !entry.startsWith('[') ? `[${entry}]` : entry;
  try {
    return normalizeHost(new URL(`http://${bracketed}/`).hostname);
  } catch {
    return null;
  }
}

interface ResolvedAllowlist {
  readonly hosts: readonly string[];
  readonly ignored: readonly string[];
}

function resolveAllowlist(entries: readonly string[]): ResolvedAllowlist {
  const hosts: string[] = [];
  const ignored: string[] = [];
  for (const raw of entries) {
    if (raw.trim() === '') continue;
    const host = canonicalAllowlistEntry(raw);
    if (host === null || METADATA_HOSTNAMES.has(host) || isMetadataOrLinkLocalAddress(host)) {
      ignored.push(raw.trim());
      continue;
    }
    if (!hosts.includes(host)) hosts.push(host);
  }
  return { hosts, ignored };
}

function allowlistFromEnv(): readonly string[] {
  const raw = typeof process !== 'undefined' ? process.env[FLOW_HTTP_ALLOWLIST_ENV] : undefined;
  return raw ? raw.split(',') : [];
}

let allowlistWarningEmitted = false;
let defaultLogger: FlowHttpPortLogger | undefined;

function portLogger(opts: FlowHttpPortOptions): FlowHttpPortLogger {
  if (opts.logger) return opts.logger;
  defaultLogger ??= createLogger('info', { pkg: '@hm/flow-engine', component: 'http.port' });
  return defaultLogger;
}

/** Aviso unico por processo: allowlist de dev ativa e (se houver) entradas descartadas. */
function warnAllowlistOnce(
  rawEntries: readonly string[],
  resolved: ResolvedAllowlist,
  opts: FlowHttpPortOptions,
): void {
  if (allowlistWarningEmitted || rawEntries.every((e) => e.trim() === '')) return;
  allowlistWarningEmitted = true;
  portLogger(opts).warn(
    'flow http_request: allowlist de dev ativa — hosts liberados a apontar para rede privada',
    {
      env: FLOW_HTTP_ALLOWLIST_ENV,
      allowedHosts: resolved.hosts,
      ignoredEntries: resolved.ignored,
    },
  );
}

// ─── Guarda ──────────────────────────────────────────────────────────────────────

/** Erro da guarda de `@hm/shared/net` (`SsrfBlockedError`), reconhecido pelo `code`. */
function isSharedSsrfError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  return Reflect.get(err, 'code') === 'ERR_SSRF_BLOCKED';
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, '');
}

function isAllowedPort(url: URL): boolean {
  if (url.port === '') return true; // porta padrao do esquema (80/443)
  const port = Number(url.port);
  return port === 80 || port === 443 || (port >= 1024 && port <= 65535);
}

/**
 * Camada 1 (sync). Devolve a URL validada ou lanca `FlowHttpBlockedError`. URL que nem
 * parseia nao e "rede interna": vira `FlowHttpError('invalid_url')` (nao ecoa a URL).
 */
function validateTarget(rawUrl: string, allowHttpHosts: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new FlowHttpError('invalid_url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FlowHttpBlockedError();
  if (url.username !== '' || url.password !== '') throw new FlowHttpBlockedError();

  const host = normalizeHost(url.hostname);
  if (host === '') throw new FlowHttpBlockedError();
  if (allowHttpHosts.includes(host)) return url;
  if (host === 'localhost' || host.endsWith('.localhost')) throw new FlowHttpBlockedError();
  if (METADATA_HOSTNAMES.has(host)) throw new FlowHttpBlockedError();

  // IP literal: o WHATWG URL ja canonicalizou (`2130706433`, `0x7f.1` → `127.0.0.1`;
  // IPv6 entre colchetes, `::ffff:127.0.0.1` → `::ffff:7f00:1`).
  const isV6Literal = host.startsWith('[');
  const isV4Literal = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  if ((isV6Literal || isV4Literal) && isBlockedIpAddress(host)) throw new FlowHttpBlockedError();
  if (!isAllowedPort(url)) throw new FlowHttpBlockedError('port');
  return url;
}

/** `node:dns` com `all: true` no formato `DnsLookupAll`. */
async function loadDnsLookup(): Promise<DnsLookupAll> {
  const dns = await import('node:dns');
  return (hostname, options, callback) => {
    dns.lookup(hostname, options, (err, addresses) => callback(err, addresses));
  };
}

/**
 * Lookup de host da allowlist: rede privada liberada (e o proposito da allowlist), mas
 * link-local/metadados continuam recusados — inclusive por DNS.
 */
function createMetadataGuardedLookup(lookupImpl: DnsLookupAll | undefined): LookupFunction {
  return (hostname, options, callback) => {
    const settle = (impl: DnsLookupAll): void => {
      impl(hostname, { all: true }, (err, addresses) => {
        if (err) {
          callback(err, []);
          return;
        }
        if (addresses.some((a) => isMetadataOrLinkLocalAddress(a.address))) {
          callback(
            Object.assign(new Error('blocked metadata address'), { code: 'ERR_SSRF_BLOCKED' }),
            [],
          );
          return;
        }
        if (options.all === true) {
          callback(
            null,
            addresses.map((a) => ({ address: a.address, family: a.family })),
          );
          return;
        }
        const first = addresses[0];
        if (!first) {
          callback(Object.assign(new Error('no address'), { code: 'ENOTFOUND' }), []);
          return;
        }
        callback(null, first.address, first.family);
      });
    };
    if (lookupImpl) {
      settle(lookupImpl);
      return;
    }
    loadDnsLookup().then(settle, (err: unknown) => {
      callback(err instanceof Error ? err : new Error(String(err)), []);
    });
  };
}

// ─── Cabecalhos ──────────────────────────────────────────────────────────────────

/** Cabecalhos de transporte/roteamento que o flow nunca define (comparacao minuscula). */
const FORBIDDEN_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'content-length',
  'expect',
  'forwarded',
  'x-real-ip',
]);
const FORBIDDEN_REQUEST_HEADER_PREFIXES = ['proxy-', 'x-forwarded-'];

function isForbiddenRequestHeader(name: string): boolean {
  const k = name.trim().toLowerCase();
  return (
    FORBIDDEN_REQUEST_HEADERS.has(k) ||
    FORBIDDEN_REQUEST_HEADER_PREFIXES.some((prefix) => k.startsWith(prefix))
  );
}

function sanitizeUserHeaders(
  raw: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (isForbiddenRequestHeader(key)) continue;
    out[key] = value;
  }
  return out;
}

/** Mesmo shape que `Headers.forEach` dava: chaves minusculas, multivalor unido por `, `. */
function flattenHeaders(raw: IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    out[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}

// ─── Transporte ──────────────────────────────────────────────────────────────────

interface RawResponse {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly bodyText: string;
}

interface HopRequest {
  readonly url: URL;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | undefined;
}

type HopResult =
  | { readonly kind: 'redirect'; readonly status: number; readonly location: string }
  | { readonly kind: 'final'; readonly response: RawResponse };

/** Unicos 3xx seguidos (semantica do `fetch`); 300/304/305/306 sao resposta final. */
const FOLLOWED_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Descomprime como o `fetch` fazia; o teto conta bytes JA descomprimidos. */
async function decodedStream(res: IncomingMessage): Promise<Readable> {
  const encoding = (res.headers['content-encoding'] ?? '').trim().toLowerCase();
  if (encoding === '' || encoding === 'identity') return res;
  const zlib = await import('node:zlib');
  let decoder: Transform;
  if (encoding === 'gzip' || encoding === 'x-gzip') decoder = zlib.createGunzip();
  else if (encoding === 'deflate') decoder = zlib.createInflate();
  else if (encoding === 'br') decoder = zlib.createBrotliDecompress();
  else return res; // codificacao desconhecida: corpo cru (o fetch tambem nao decodificava)
  res.on('error', (err) => decoder.destroy(err));
  res.pipe(decoder);
  return decoder;
}

function readCapped(stream: Readable, res: IncomingMessage): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const parts: Buffer[] = [];
    let received = 0;
    let settled = false;
    const fail = (err: Error): void => {
      if (settled) return;
      settled = true;
      res.destroy();
      stream.destroy();
      reject(err);
    };
    stream.on('data', (chunk: Buffer) => {
      if (settled) return;
      received += chunk.length;
      if (received > MAX_RESPONSE_BYTES) {
        fail(new FlowHttpError('response_too_large'));
        return;
      }
      parts.push(chunk);
    });
    stream.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(parts));
    });
    stream.on('error', (err: Error) => fail(err));
    res.on('aborted', () => fail(new Error('Conexão HTTP encerrada antes do fim da resposta')));
  });
}

/** Um salto: conecta com o lookup guardado, devolve redirect (sem ler corpo) ou resposta. */
async function performHop(
  hop: HopRequest,
  allowHttpHosts: readonly string[],
  opts: FlowHttpPortOptions,
  signal: AbortSignal,
): Promise<HopResult> {
  const host = normalizeHost(hop.url.hostname);
  const isHttps = hop.url.protocol === 'https:';
  const allowlisted = allowHttpHosts.includes(host);
  const [httpMod, httpsMod] = await Promise.all([import('node:http'), import('node:https')]);

  const requestOptions: RequestOptions = {
    hostname: host.startsWith('[') ? host.slice(1, -1) : host,
    port: hop.url.port !== '' ? Number(hop.url.port) : isHttps ? 443 : 80,
    path: `${hop.url.pathname}${hop.url.search}`,
    method: hop.method,
    headers: hop.headers,
    signal,
    // Sem pool compartilhado: um socket aberto por outro caminho (sem guarda) nunca e
    // reaproveitado aqui, e todo connect passa pelo lookup abaixo.
    agent: false,
    lookup: allowlisted
      ? createMetadataGuardedLookup(opts.lookupImpl)
      : createGuardedLookup(opts.lookupImpl !== undefined ? { lookupImpl: opts.lookupImpl } : {}),
  };

  return new Promise<HopResult>((resolve, reject) => {
    const onResponse = (res: IncomingMessage): void => {
      const status = res.statusCode ?? 502;
      const location = res.headers.location;
      if (
        FOLLOWED_REDIRECT_STATUSES.has(status) &&
        typeof location === 'string' &&
        location !== ''
      ) {
        res.resume();
        res.destroy();
        resolve({ kind: 'redirect', status, location });
        return;
      }
      decodedStream(res)
        .then((stream) => readCapped(stream, res))
        .then((buf) => {
          let text = buf.toString('utf8');
          if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM, como `res.text()`
          resolve({ kind: 'final', response: { status, headers: res.headers, bodyText: text } });
        })
        .catch((err: unknown) => reject(err instanceof Error ? err : new Error(String(err))));
    };

    let req: ReturnType<typeof httpMod.request>;
    try {
      req = (isHttps ? httpsMod : httpMod).request(requestOptions, onResponse);
    } catch (err) {
      // Header invalido etc. (o `fetch` tambem lancava TypeError sincrono).
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    req.on('error', (err: unknown) => {
      if (isSharedSsrfError(err)) reject(new FlowHttpBlockedError());
      else reject(err instanceof Error ? err : new Error(String(err)));
    });
    if (hop.body !== undefined) req.write(hop.body);
    req.end();
  });
}

/** Cabecalhos que sobrevivem a redirect para OUTRA origem (o resto pode ser credencial). */
const CROSS_ORIGIN_SAFE_HEADERS = new Set([
  'accept',
  'accept-language',
  'accept-encoding',
  'user-agent',
]);
const BODY_HEADERS = new Set(['content-type', 'content-length', 'content-encoding']);

/**
 * Proximo salto conforme a semantica do `fetch` (303 → GET; 301/302 de POST → GET). Mesma
 * origem: cabecalhos preservados (menos os de corpo, se o corpo caiu). Outra origem: so os
 * inofensivos + `content-type`/`content-length` quando o corpo e mantido (307/308) —
 * `authorization`, `x-api-key`, `api-key`, `x-auth-token` e qualquer customizado caem.
 */
function nextHop(prev: HopRequest, status: number, nextUrl: URL): HopRequest {
  const toGet = status === 303 || ((status === 301 || status === 302) && prev.method === 'POST');
  const crossOrigin = nextUrl.origin !== prev.url.origin;
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(prev.headers)) {
    const k = key.toLowerCase();
    if (isForbiddenRequestHeader(k) && k !== 'content-length') continue;
    if (toGet && BODY_HEADERS.has(k)) continue;
    if (crossOrigin) {
      const keptBodyHeader = !toGet && (k === 'content-type' || k === 'content-length');
      if (!CROSS_ORIGIN_SAFE_HEADERS.has(k) && !keptBodyHeader) continue;
    }
    headers[key] = value;
  }
  return {
    url: nextUrl,
    method: toGet ? 'GET' : prev.method,
    headers,
    body: toGet ? undefined : prev.body,
  };
}

/** Erro de cabecalho invalido do Node (`ERR_INVALID_HTTP_TOKEN`, `ERR_INVALID_CHAR`, ...). */
function isInvalidHeaderError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code: unknown = Reflect.get(err, 'code');
  return (
    code === 'ERR_INVALID_HTTP_TOKEN' ||
    code === 'ERR_INVALID_CHAR' ||
    code === 'ERR_HTTP_INVALID_HEADER_VALUE'
  );
}

/** Fabrica o port (o default le a allowlist do ambiente; testes injetam allowlist/DNS). */
export function createFlowHttpPort(opts: FlowHttpPortOptions = {}): FlowHttpPort {
  return {
    async request(input: FlowHttpRequest): Promise<FlowHttpResponse> {
      const rawAllowlist = opts.allowHttpHosts ?? allowlistFromEnv();
      const resolved = resolveAllowlist(rawAllowlist);
      warnAllowlistOnce(rawAllowlist, resolved, opts);
      const allowHttpHosts = resolved.hosts;
      // Validacao sincrona antes de qualquer timer/socket.
      const target = validateTarget(input.url, allowHttpHosts);

      const body = input.body !== undefined ? JSON.stringify(input.body) : undefined;
      const headers: Record<string, string> = {
        'accept-encoding': 'gzip, deflate, br',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...sanitizeUserHeaders(input.headers),
      };
      if (body !== undefined) headers['content-length'] = String(Buffer.byteLength(body));

      let hop: HopRequest = { url: target, method: input.method, headers, body };
      const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const controller = new AbortController();
      // Um unico teto para a chamada inteira: todos os saltos + leitura do corpo.
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        for (let redirects = 0; ; redirects += 1) {
          const result = await performHop(hop, allowHttpHosts, opts, controller.signal);
          if (result.kind === 'final') {
            const { status, headers: rawHeaders, bodyText } = result.response;
            let parsed: unknown = bodyText;
            try {
              parsed = bodyText.length > 0 ? JSON.parse(bodyText) : null;
            } catch {
              parsed = bodyText;
            }
            return {
              status,
              ok: status >= 200 && status < 300,
              body: parsed,
              headers: flattenHeaders(rawHeaders),
            };
          }
          if (redirects >= MAX_REDIRECTS) throw new FlowHttpError('too_many_redirects');
          let nextUrl: URL;
          try {
            nextUrl = new URL(result.location, hop.url);
          } catch {
            throw new FlowHttpError('invalid_redirect');
          }
          // Cada salto revalida esquema/credencial/IP literal/porta; o lookup faz o resto.
          let validated: URL;
          try {
            validated = validateTarget(nextUrl.toString(), allowHttpHosts);
          } catch (err) {
            if (flowHttpErrorCode(err) === 'invalid_url')
              throw new FlowHttpError('invalid_redirect');
            throw err;
          }
          hop = nextHop(hop, result.status, validated);
        }
      } catch (err) {
        if (isFlowHttpBlockedError(err)) throw err;
        if (controller.signal.aborted) throw new FlowHttpError('timeout', err);
        if (flowHttpErrorCode(err) !== null) throw err;
        if (isInvalidHeaderError(err)) throw new FlowHttpError('invalid_header', err);
        // ENOTFOUND, ECONNREFUSED, ECONNRESET, TLS...: mensagem fixa; o cru vai em `cause`.
        throw new FlowHttpError('network_error', err);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export const flowHttpPort: FlowHttpPort = createFlowHttpPort();
