/**
 * Guarda anti-SSRF para URLs outbound controladas por tenant (F56-S07 / SEC-01).
 *
 * Webhooks outbound aceitam URL arbitrária de quem tem `webhook.edit` — sem guarda,
 * isso é um proxy SSRF para dentro da infra (metadata 169.254.169.254, localhost,
 * RFC1918). A defesa aqui tem TRÊS camadas, da mais barata à mais dura:
 *
 *   1. `checkWebhookUrlSyntax` (sync)  — esquema (`https:`; `http:` só para hosts na
 *      allowlist explícita), credenciais embutidas, `localhost`, IP literal bloqueado.
 *      Usável em `.superRefine` de Zod (boundary da API).
 *   2. `assertSafeWebhookUrl` (async)  — resolve o hostname via DNS e rejeita se
 *      QUALQUER endereço retornado for privado/loopback/link-local/metadata.
 *      Erro de resolução (NXDOMAIN etc.) NÃO bloqueia no boundary — DNS pode ainda
 *      não ter propagado; a garantia dura é a camada 3.
 *   3. `ssrfSafeFetch` (connect-time)  — o POST real usa um `lookup` custom no
 *      `http(s).request`: o IP é validado NA resolução usada para conectar
 *      (anti-DNS-rebinding — não há janela entre "validei" e "conectei") e
 *      redirects NUNCA são seguidos (bypass clássico: 302 → host interno).
 *
 * Browser-safe por construção: nenhum built-in do Node é importado no top-level
 * (só `import type`, apagado na compilação); `node:dns`/`node:http(s)` entram por
 * import dinâmico dentro das funções — o barrel de `@hm/shared` continua bundlável
 * no cliente (Next `transpilePackages`).
 */
import type { LookupFunction } from 'node:net';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import type { RequestOptions as HttpsRequestOptions } from 'node:https';

/** Motivo de bloqueio — nunca vaze isso para o cliente final; é para logs/testes. */
export type SsrfBlockedReason =
  | 'invalid_url'
  | 'credentials'
  | 'scheme'
  | 'blocked_host'
  | 'blocked_ip';

/** Erro terminal de guarda. `code` segue o shape de `NodeJS.ErrnoException`. */
export class SsrfBlockedError extends Error {
  readonly code = 'ERR_SSRF_BLOCKED';
  readonly reason: SsrfBlockedReason;

  constructor(reason: SsrfBlockedReason, target?: string) {
    super(`Destino de webhook bloqueado (${reason})${target ? `: ${target}` : ''}`);
    this.name = 'SsrfBlockedError';
    this.reason = reason;
  }
}

/** Resultado da validação sintática (camada 1). */
export type WebhookUrlCheck =
  | { readonly ok: true; readonly url: URL }
  | { readonly ok: false; readonly reason: SsrfBlockedReason };

export interface WebhookUrlOptions {
  /**
   * Hostnames (match exato, case-insensitive) autorizados a usar `http:` E a apontar
   * para IPs privados — opt-in explícito do operador (dev/self-hosted), nunca do
   * tenant. Default: `HM_WEBHOOK_HTTP_ALLOWLIST` (CSV) do ambiente.
   */
  readonly allowHttpHosts?: readonly string[];
}

/** Assinatura mínima do `dns.lookup` com `all: true` — injetável para teste. */
export type DnsLookupAll = (
  hostname: string,
  options: { all: true; family?: number; hints?: number },
  callback: (
    err: NodeJS.ErrnoException | null,
    addresses: ReadonlyArray<{ address: string; family: number }>,
  ) => void,
) => void;

export interface SsrfSafeFetchOptions extends WebhookUrlOptions {
  /** Resolver DNS injetável (testes de rebinding). Default: `node:dns` real. */
  readonly lookupImpl?: DnsLookupAll;
}

/** Lê a allowlist de `http:` do ambiente (CSV de hostnames). Browser-safe. */
export function httpAllowlistFromEnv(): readonly string[] {
  const raw =
    typeof process !== 'undefined' ? process.env?.['HM_WEBHOOK_HTTP_ALLOWLIST'] : undefined;
  if (!raw) return [];
  return raw
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h.length > 0);
}

// ─── Parsing/classificação de IP (puro, sem I/O) ────────────────────────────────

/** IPv4 dotted-decimal → uint32, ou null. (URL/DNS já entregam a forma canônica.) */
function parseIpv4(value: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  const d = Number(m[4]);
  if (a > 255 || b > 255 || c > 255 || d > 255) return null;
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

/** IPv6 (com/sem colchetes, com zone-id) → bigint de 128 bits, ou null. */
function parseIpv6(value: string): bigint | null {
  let s = value;
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  const zone = s.indexOf('%');
  if (zone !== -1) s = s.slice(0, zone);
  if (!s.includes(':')) return null;

  // Cauda IPv4 embutida (::ffff:10.0.0.1) → substitui por dois grupos hex.
  const lastColon = s.lastIndexOf(':');
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIpv4(tail);
    if (v4 === null) return null;
    s = `${s.slice(0, lastColon + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }

  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] === '' ? [] : (halves[0]?.split(':') ?? []);
  const rest = halves.length === 2 && halves[1] !== '' ? halves[1]!.split(':') : [];
  let groups: string[];
  if (halves.length === 2) {
    const missing = 8 - head.length - rest.length;
    if (missing < 1) return null;
    groups = [...head, ...new Array<string>(missing).fill('0'), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  let out = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    out = (out << 16n) | BigInt(parseInt(g, 16));
  }
  return out;
}

/** Faixas IPv4 não-roteáveis/perigosas: [base, bits do prefixo]. */
const BLOCKED_V4_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 8], // 0.0.0.0/8 — "this network"
  [0x0a000000, 8], // 10.0.0.0/8 — RFC1918
  [0x64400000, 10], // 100.64.0.0/10 — CGNAT
  [0x7f000000, 8], // 127.0.0.0/8 — loopback
  [0xa9fe0000, 16], // 169.254.0.0/16 — link-local (inclui metadata 169.254.169.254)
  [0xac100000, 12], // 172.16.0.0/12 — RFC1918
  [0xc0000000, 24], // 192.0.0.0/24 — IETF protocol assignments
  [0xc0000200, 24], // 192.0.2.0/24 — TEST-NET-1
  [0xc0a80000, 16], // 192.168.0.0/16 — RFC1918
  [0xc6120000, 15], // 198.18.0.0/15 — benchmarking
  [0xc6336400, 24], // 198.51.100.0/24 — TEST-NET-2
  [0xcb007100, 24], // 203.0.113.0/24 — TEST-NET-3
  [0xe0000000, 4], // 224.0.0.0/4 — multicast
  [0xf0000000, 4], // 240.0.0.0/4 — reservado + broadcast
];

function isBlockedV4(ip: number): boolean {
  return BLOCKED_V4_RANGES.some(([base, bits]) => ip >>> (32 - bits) === base >>> (32 - bits));
}

function isBlockedV6(ip: bigint): boolean {
  if (ip === 0n || ip === 1n) return true; // :: (unspecified) e ::1 (loopback)
  const top32 = ip >> 96n;
  if (ip >> 32n === 0xffffn) return isBlockedV4(Number(ip & 0xffffffffn)); // ::ffff:v4 (mapped)
  if (ip >> 32n === 0n) return true; // ::/96 "IPv4-compatible" (obsoleto — fail-closed)
  if (ip >> 32n === 0x0064ff9bn << 64n) return isBlockedV4(Number(ip & 0xffffffffn)); // 64:ff9b::/96 NAT64
  if (ip >> 121n === 0x7en) return true; // fc00::/7 — unique-local (inclui fd00::/8)
  if (ip >> 118n === 0b1111111010n) return true; // fe80::/10 — link-local
  if (ip >> 120n === 0xffn) return true; // ff00::/8 — multicast
  if (top32 === 0x20010db8n) return true; // 2001:db8::/32 — documentação
  return false;
}

/**
 * Um endereço IP (string) alcança rede interna/reservada? Fail-closed: o que não
 * parseia como IPv4/IPv6 é tratado como bloqueado.
 */
export function isBlockedIpAddress(address: string): boolean {
  const v4 = parseIpv4(address);
  if (v4 !== null) return isBlockedV4(v4);
  const v6 = parseIpv6(address);
  if (v6 !== null) return isBlockedV6(v6);
  return true;
}

// ─── Camada 1: validação sintática (sync — boundary Zod) ────────────────────────

function isAllowlisted(hostname: string, allowHttpHosts: readonly string[]): boolean {
  return allowHttpHosts.includes(hostname);
}

/**
 * Validação SÍNCRONA de URL de webhook: esquema, credenciais, host literal.
 * Não faz DNS — combine com `assertSafeWebhookUrl` (boundary) e `ssrfSafeFetch`
 * (connect) para a garantia completa.
 */
export function checkWebhookUrlSyntax(rawUrl: string, opts: WebhookUrlOptions = {}): WebhookUrlCheck {
  const allowHttpHosts = opts.allowHttpHosts ?? httpAllowlistFromEnv();
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (url.username !== '' || url.password !== '') return { ok: false, reason: 'credentials' };

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host === '') return { ok: false, reason: 'invalid_url' };

  // Opt-in explícito do operador (dev/self-hosted): libera http E destino privado.
  if (isAllowlisted(host, allowHttpHosts)) {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return { ok: false, reason: 'scheme' };
    }
    return { ok: true, url };
  }

  if (url.protocol !== 'https:') return { ok: false, reason: 'scheme' };
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return { ok: false, reason: 'blocked_host' };
  }

  // IP literal (v4 ou v6 entre colchetes) — decide agora, sem DNS.
  const v4 = parseIpv4(host);
  if (v4 !== null) return isBlockedV4(v4) ? { ok: false, reason: 'blocked_ip' } : { ok: true, url };
  if (host.startsWith('[') || host.includes(':')) {
    const v6 = parseIpv6(host);
    // Colchetes sem IPv6 válido = URL quebrada → fail-closed.
    if (v6 === null) return { ok: false, reason: 'invalid_url' };
    return isBlockedV6(v6) ? { ok: false, reason: 'blocked_ip' } : { ok: true, url };
  }
  return { ok: true, url };
}

// ─── Camada 2: validação com DNS (async — create/update na API) ─────────────────

async function loadDnsLookup(): Promise<DnsLookupAll> {
  const dns = await import('node:dns');
  return (hostname, options, callback) => {
    dns.lookup(hostname, options, callback);
  };
}

/**
 * Valida sintaxe E resolve o hostname, rejeitando se qualquer endereço for interno.
 * Erro de resolução NÃO bloqueia (DNS pode não ter propagado no create); a barreira
 * dura contra rebinding é o `lookup` guardado do `ssrfSafeFetch` no momento do POST.
 *
 * @throws SsrfBlockedError quando a URL é rejeitada.
 */
export async function assertSafeWebhookUrl(
  rawUrl: string,
  opts: SsrfSafeFetchOptions = {},
): Promise<URL> {
  const syntax = checkWebhookUrlSyntax(rawUrl, opts);
  if (!syntax.ok) throw new SsrfBlockedError(syntax.reason, rawUrl);
  const url = syntax.url;

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const allowHttpHosts = opts.allowHttpHosts ?? httpAllowlistFromEnv();
  // Allowlist e IP literal já foram decididos na camada sintática.
  if (isAllowlisted(host, allowHttpHosts) || parseIpv4(host) !== null || host.includes(':')) {
    return url;
  }

  const lookup = opts.lookupImpl ?? (await loadDnsLookup());
  const addresses = await new Promise<ReadonlyArray<{ address: string }>>((resolve) => {
    lookup(host, { all: true }, (err, addrs) => {
      resolve(err ? [] : addrs);
    });
  });
  for (const addr of addresses) {
    if (isBlockedIpAddress(addr.address)) {
      throw new SsrfBlockedError('blocked_ip', rawUrl);
    }
  }
  return url;
}

// ─── Camada 3: lookup guardado + fetch seguro (connect-time, anti-rebinding) ─────

/**
 * `lookup` compatível com `http(s).request` que valida CADA endereço resolvido na
 * hora do connect. É isso que fecha DNS-rebinding: não existe janela entre a
 * resolução validada e a conexão — é a mesma resolução.
 */
export function createGuardedLookup(opts: SsrfSafeFetchOptions = {}): LookupFunction {
  return (hostname, options, callback) => {
    const settle = (impl: DnsLookupAll): void => {
      impl(hostname, { all: true }, (err, addresses) => {
        if (err) {
          callback(err, []);
          return;
        }
        const blocked = addresses.find((a) => isBlockedIpAddress(a.address));
        if (blocked) {
          callback(new SsrfBlockedError('blocked_ip', `${hostname} → ${blocked.address}`), []);
          return;
        }
        if (options.all === true) {
          callback(null, addresses.map((a) => ({ address: a.address, family: a.family })));
        } else {
          const first = addresses[0];
          if (!first) {
            callback(new SsrfBlockedError('blocked_host', hostname), []);
            return;
          }
          callback(null, first.address, first.family);
        }
      });
    };
    if (opts.lookupImpl) {
      settle(opts.lookupImpl);
      return;
    }
    loadDnsLookup().then(settle, (err: unknown) => {
      callback(err instanceof Error ? err : new Error(String(err)), []);
    });
  };
}

/** Teto do corpo de resposta lido (o dispatcher persiste no máx. 2000 chars). */
const MAX_RESPONSE_BYTES = 64 * 1024;

function toWebResponse(status: number, raw: IncomingHttpHeaders, body: Buffer): Response {
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }
  headers.delete('content-length'); // corpo pode ter sido truncado no teto
  const canHaveBody = status >= 200 && status !== 204 && status !== 205 && status !== 304;
  return new Response(canHaveBody && body.length > 0 ? new Uint8Array(body) : null, {
    status,
    headers,
  });
}

/**
 * Substituto do `fetch` global para destinos controlados por tenant (webhooks):
 *
 *   - valida a URL (camada 1) e conecta com `lookup` guardado (camada 3);
 *   - NUNCA segue redirects — 3xx volta como resposta não-ok (bypass clássico de
 *     SSRF é 302 para host interno);
 *   - corpo de resposta limitado a 64 KiB (endpoint hostil não infla memória).
 *
 * Assinatura compatível com o uso de `fetch(url, { method, headers, body, signal })`.
 */
export async function ssrfSafeFetch(
  input: string | URL,
  init?: RequestInit,
  opts: SsrfSafeFetchOptions = {},
): Promise<Response> {
  const rawUrl = typeof input === 'string' ? input : input.toString();
  const allowHttpHosts = opts.allowHttpHosts ?? httpAllowlistFromEnv();
  const syntax = checkWebhookUrlSyntax(rawUrl, { allowHttpHosts });
  if (!syntax.ok) throw new SsrfBlockedError(syntax.reason, rawUrl);
  const url = syntax.url;
  const isHttps = url.protocol === 'https:';

  const body = init?.body ?? null;
  if (body !== null && typeof body !== 'string' && !(body instanceof Uint8Array)) {
    throw new TypeError('ssrfSafeFetch: body deve ser string ou Uint8Array');
  }

  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, key) => {
    headers[key] = value;
  });

  const [httpMod, httpsMod] = await Promise.all([import('node:http'), import('node:https')]);
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const hostname = host.startsWith('[') ? host.slice(1, -1) : host;
  const allowlisted = isAllowlisted(host, allowHttpHosts);

  const requestOptions: HttpsRequestOptions = {
    hostname,
    port: url.port !== '' ? Number(url.port) : isHttps ? 443 : 80,
    path: `${url.pathname}${url.search}`,
    method: init?.method ?? 'GET',
    headers,
    // Allowlist = opt-in do operador; fora dela, todo connect passa pelo guarda.
    ...(allowlisted ? {} : { lookup: createGuardedLookup(opts) }),
    ...(init?.signal ? { signal: init.signal } : {}),
  };

  return new Promise<Response>((resolve, reject) => {
    const onResponse = (res: IncomingMessage): void => {
      const chunks: Buffer[] = [];
      let received = 0;
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        try {
          resolve(toWebResponse(res.statusCode ?? 502, res.headers, Buffer.concat(chunks)));
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      };
      res.on('data', (chunk: Buffer) => {
        if (received >= MAX_RESPONSE_BYTES) return;
        received += chunk.length;
        chunks.push(
          received > MAX_RESPONSE_BYTES
            ? chunk.subarray(0, chunk.length - (received - MAX_RESPONSE_BYTES))
            : chunk,
        );
        if (received >= MAX_RESPONSE_BYTES) res.destroy(); // teto → 'close' resolve truncado
      });
      res.on('end', finish);
      res.on('close', finish);
      res.on('error', (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
    };
    const req = isHttps
      ? httpsMod.request(requestOptions, onResponse)
      : httpMod.request(requestOptions, onResponse);
    req.on('error', reject);
    if (body !== null) req.write(body);
    req.end();
  });
}
