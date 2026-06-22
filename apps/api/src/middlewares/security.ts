import cors, { type CorsOptions, type CorsRequest } from 'cors';
import type { RequestHandler } from 'express';
import helmet from 'helmet';

/**
 * Hardening de borda HTTP da @hm/api (F10-S07 — OWASP top 10).
 *
 * Consolida e endurece os security headers (antes `app.use(helmet())` inline) e
 * a política de CORS (antes `cors({ origin: config.corsOrigin, credentials })`
 * inline) num único ponto auditável. Tudo é seguro por default e configurável
 * por env — sem `*`, sem reflexão cega de Origin, sem `unsafe-*` em produção.
 *
 * O orchestrator substitui em `app.ts`:
 *   app.use(helmet());
 *   app.use(cors({ origin: config.corsOrigin, credentials: true }));
 * por:
 *   for (const mw of securityMiddlewares()) app.use(mw);
 * mantendo a posição (logo após `app.disable('x-powered-by')`, antes de
 * `compression()` / rotas).
 *
 * Envs:
 *   - CORS_ORIGIN — allowlist de origens (CSV). Aceita uma ou várias, ex.:
 *       `https://app.tagix.com,https://admin.tagix.com`. Default dev:
 *       `http://localhost:3000`.
 *   - CSP_CONNECT_SRC — origens extra para `connect-src` (CSV), ex. endpoint de
 *       telemetria/Sentry browser. Opcional.
 *   - NODE_ENV — `production` ativa HSTS e nega Origin desconhecida;
 *       fora de produção HSTS fica desligado (TLS local raramente existe).
 */

const DEFAULT_DEV_ORIGIN = 'http://localhost:3000';

/** Parseia uma env CSV em lista limpa (trim, sem vazios, sem duplicatas). */
function parseCsvEnv(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw.trim() === '') return [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const value = part.trim();
    if (value !== '') seen.add(value);
  }
  return [...seen];
}

/** Allowlist efetiva de origens CORS (env CORS_ORIGIN, CSV). */
export function corsAllowlist(): readonly string[] {
  const configured = parseCsvEnv(process.env['CORS_ORIGIN']);
  return configured.length > 0 ? configured : [DEFAULT_DEV_ORIGIN];
}

/**
 * Política de origem CORS estrita: só ecoa o header `Access-Control-Allow-Origin`
 * quando a Origin está na allowlist. Requests sem Origin (curl, server-to-server,
 * health checks) passam — não são cross-site e não carregam cookies de browser.
 */
function originPolicy(allowlist: readonly string[]): CorsOptions['origin'] {
  return (origin, callback) => {
    if (origin === undefined || allowlist.includes(origin)) {
      callback(null, true);
      return;
    }
    // Não lançar erro (evita 500 ruidoso): apenas omite o header de origem,
    // o browser bloqueia a resposta como esperado.
    callback(null, false);
  };
}

/** Opções de CORS endurecidas (allowlist + credentials + métodos explícitos). */
function corsOptions(): CorsOptions {
  return {
    origin: originPolicy(corsAllowlist()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Api-Key', 'X-Requested-With'],
    // Cacheia o preflight por 10min (reduz OPTIONS sem afrouxar a política).
    maxAge: 600,
    optionsSuccessStatus: 204,
  };
}

/**
 * Content-Security-Policy coerente com um consumidor Next.js + a própria API
 * (Swagger UI em `/api/v1/docs`). Sem `unsafe-eval`. `connect-src` inclui a
 * allowlist de CORS (o web fala com a API) e extras opcionais (telemetria).
 */
const DEFAULT_CAPTCHA_SRC = 'https://challenges.cloudflare.com';

/**
 * Origens do provedor de captcha (Cloudflare Turnstile, F44-S03). Liberadas SÓ em
 * script-src/frame-src/connect-src — sem `unsafe-*`. Configurável por env
 * `CSP_CAPTCHA_SRC` (CSV); default no domínio oficial do Turnstile.
 */
function captchaSources(): readonly string[] {
  const configured = parseCsvEnv(process.env['CSP_CAPTCHA_SRC']);
  return configured.length > 0 ? configured : [DEFAULT_CAPTCHA_SRC];
}

function cspDirectives(): Record<string, readonly string[]> {
  const captcha = captchaSources();
  const connect = [
    "'self'",
    ...corsAllowlist(),
    ...parseCsvEnv(process.env['CSP_CONNECT_SRC']),
    ...captcha,
  ];
  return {
    'default-src': ["'self'"],
    'base-uri': ["'self'"],
    'font-src': ["'self'", 'https:', 'data:'],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    // Widget do captcha é embutido via <iframe> da Cloudflare.
    'frame-src': [...captcha],
    'img-src': ["'self'", 'data:', 'https:'],
    'object-src': ["'none'"],
    // Swagger UI injeta estilos inline; sem isso a página de docs quebra.
    'style-src': ["'self'", "'unsafe-inline'", 'https:'],
    // Script do Turnstile carregado do domínio da Cloudflare (sem unsafe-*).
    'script-src': ["'self'", ...captcha],
    'connect-src': [...new Set(connect)],
    'upgrade-insecure-requests': [],
  };
}

/** Helmet endurecido: CSP explícita, HSTS só em prod, frame-guard DENY, no-sniff. */
function helmetMiddleware(): RequestHandler {
  const isProd = process.env['NODE_ENV'] === 'production';
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: cspDirectives() as Record<string, Iterable<string>>,
    },
    // HSTS só faz sentido sob TLS (produção). 1 ano + subdomínios + preload.
    hsts: isProd ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
    // A API serve JSON/Swagger, nunca é embutida → nega framing por completo.
    frameguard: { action: 'deny' },
    // X-Content-Type-Options: nosniff (anti MIME-sniffing / drive-by).
    noSniff: true,
    // Não vaza a URL completa como Referer cross-origin.
    referrerPolicy: { policy: 'no-referrer' },
    // Desliga features sensíveis de browser por padrão (resposta JSON da API).
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-site' },
    // x-powered-by já é desligado no app; helmet reforça.
    hidePoweredBy: true,
  });
}

/**
 * Cadeia de middlewares de segurança, na ordem de montagem. O orchestrator
 * espalha esta lista no `app.use(...)` no lugar do helmet()/cors() inline.
 */
export function securityMiddlewares(): readonly RequestHandler[] {
  return [helmetMiddleware(), cors(corsOptions()) as RequestHandler];
}

/** Alias single-handler para quem preferir montar um middleware composto. */
export function securityHeaders(): RequestHandler {
  const chain = securityMiddlewares();
  return (req, res, next): void => {
    let i = 0;
    const run = (): void => {
      const mw = chain[i];
      i += 1;
      if (mw === undefined) {
        next();
        return;
      }
      mw(req as CorsRequest as never, res, (err?: unknown) => {
        if (err !== undefined) {
          next(err);
          return;
        }
        run();
      });
    };
    run();
  };
}
