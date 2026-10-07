/**
 * Guarda de alvo dos seeds de UM workspace (F70-S18, generalizada na F69-S10).
 *
 * Seed que escreve num workspace real (Arcada, demonstração do App Review) não pode cair
 * em produção por engano. A regra, igual para todos:
 *
 * 1. `NODE_ENV=production` → recusa SEMPRE (sem escape: seed não é passo de deploy).
 * 2. `DATABASE_URL` ausente, ilegível ou sem nome de banco → recusa (não dá para confirmar).
 * 3. Banco local E nome que não é de produção → roda.
 * 4. Qualquer outro caso (host remoto, OU nome de produção mesmo em `localhost`) exige as
 *    DUAS confirmações: `<PREFIXO>_SEED_ALLOW_REMOTE=1` e `<PREFIXO>_SEED_CONFIRM_DATABASE=<nome
 *    exato do banco>`. Digitar o nome do banco é a prova de que se sabe onde se está.
 */

export interface SeedTarget {
  readonly host: string;
  readonly database: string;
}

export interface SeedGuardOptions {
  /** Prefixo das variáveis de confirmação: `ARCADA` → `ARCADA_SEED_ALLOW_REMOTE`. */
  readonly envPrefix: string;
  /** Nome do seed nas mensagens: "o seed da Arcada". */
  readonly label: string;
}

const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Nomes de banco de produção. `leadium` é o `PG_DB` de `.env.production.example`; qualquer
 * nome com `prod` também conta. Hostname sozinho não basta: um túnel SSH para a VPS aparece
 * como `localhost`, e é o nome do banco que denuncia o alvo.
 */
const PRODUCTION_DATABASE_NAMES: ReadonlySet<string> = new Set(['leadium']);
const PRODUCTION_DATABASE_RE = /prod/i;

export function isProductionDatabaseName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return PRODUCTION_DATABASE_NAMES.has(n) || PRODUCTION_DATABASE_RE.test(n);
}

/** Lança com a razão; devolve o alvo quando pode rodar. */
export function assertSeedTarget(
  env: Readonly<Record<string, string | undefined>>,
  options: SeedGuardOptions,
): SeedTarget {
  const allowVar = `${options.envPrefix}_SEED_ALLOW_REMOTE`;
  const confirmVar = `${options.envPrefix}_SEED_CONFIRM_DATABASE`;

  if ((env['NODE_ENV'] ?? '').trim().toLowerCase() === 'production') {
    throw new Error(`NODE_ENV=production: ${options.label} não roda em ambiente de produção.`);
  }
  const raw = env['DATABASE_URL']?.trim();
  if (!raw) throw new Error('DATABASE_URL ausente.');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('DATABASE_URL ilegível.');
  }
  const host = url.hostname.toLowerCase();
  let database: string;
  try {
    database = decodeURIComponent(url.pathname.replace(/^\/+/, '')).trim();
  } catch {
    throw new Error('DATABASE_URL com nome de banco ilegível.');
  }
  if (database === '') {
    throw new Error('DATABASE_URL sem nome de banco: não dá para confirmar o alvo.');
  }

  const local = LOCAL_HOSTS.has(host);
  const productionName = isProductionDatabaseName(database);
  if (local && !productionName) return { host, database };

  const why = productionName
    ? `Banco "${database}" tem nome de produção`
    : `Banco não-local (${host})`;
  const allowed = env[allowVar] === '1';
  const confirmed = env[confirmVar] === database;
  if (!allowed || !confirmed) {
    throw new Error(
      `${why}. Para rodar mesmo assim, defina ${allowVar}=1 e ` +
        `${confirmVar}=<nome exato do banco>, conscientemente.`,
    );
  }
  return { host, database };
}
