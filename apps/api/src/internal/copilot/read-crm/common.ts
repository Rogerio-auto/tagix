/**
 * Peças comuns das consultas de CRM do Copiloto (F73-S06).
 *
 * - formato do workspace (moeda do mercado, idioma e fuso): números e datas de texto saem de
 *   `Intl` com o locale do workspace, nunca de um literal (F59-S08);
 * - recorte seguro de texto para o contrato do cartão (um campo acima do máximo do schema
 *   derrubaria a ferramenta inteira);
 * - mascaramento de telefone (o cartão nunca mostra o número inteiro; o `model_view` nunca o
 *   leva);
 * - resposta `not_found` única para "não existe" e "existe e você não vê" (sem oráculo).
 */
import { eq } from 'drizzle-orm';
import { schema, type DbTx } from '@hm/db';
import {
  formatPhoneForDisplay,
  getMarketPack,
  isMarketCode,
  type CopilotToolEnvelope,
} from '@hm/shared';

export interface WorkspaceFormat {
  readonly currency: 'BRL' | 'USD';
  readonly locale: string;
  readonly timezone: string;
}

/** Moeda do mercado + idioma e fuso do workspace. Uma query por PK. */
export async function loadWorkspaceFormat(tx: DbTx, workspaceId: string): Promise<WorkspaceFormat> {
  const [row] = await tx
    .select({
      market: schema.workspaces.market,
      locale: schema.workspaces.locale,
      timezone: schema.workspaces.timezone,
    })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  const pack = getMarketPack(row && isMarketCode(row.market) ? row.market : 'BR');
  return {
    currency: pack.currency,
    locale: row?.locale ?? pack.defaultLocale,
    timezone: row?.timezone ?? pack.defaultTimezone,
  };
}

export interface Formatters {
  money(units: number): string;
  percent(fraction: number): string;
  count(n: number): string;
}

/** Formatadores `Intl` do workspace. Locale inválido no banco cai no padrão do mercado. */
export function makeFormatters(fmt: WorkspaceFormat): Formatters {
  const build = (locale: string): Formatters => ({
    money: (n) =>
      new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: fmt.currency,
        maximumFractionDigits: 0,
      }).format(n),
    percent: (f) =>
      new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(f),
    count: (n) => new Intl.NumberFormat(locale).format(n),
  });
  try {
    return build(fmt.locale);
  } catch {
    return build(getMarketPack(fmt.currency === 'USD' ? 'US' : 'BR').defaultLocale);
  }
}

/** Centavos (bigint do banco) → unidades da moeda, o formato do contrato. */
export function centsToUnits(cents: number | string | null | undefined): number {
  const n = typeof cents === 'string' ? Number(cents) : (cents ?? 0);
  return Number.isFinite(n) ? n / 100 : 0;
}

/** Arredonda para 2 casas (média/razão em unidades da moeda). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Recorta ao máximo do contrato; vazio vira `fallback`. */
export function clip(value: string | null | undefined, max: number, fallback: string): string {
  const trimmed = (value ?? '').trim();
  const base = trimmed.length > 0 ? trimmed : fallback;
  return base.length > max ? `${base.slice(0, max - 1)}…` : base;
}

/** Como `clip`, mas `null` quando vazio. */
export function clipOrNull(value: string | null | undefined, max: number): string | null {
  const trimmed = (value ?? '').trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/**
 * Telefone mascarado para exibição: só os 4 últimos dígitos, `(••) •••••-2444`.
 * Nunca o número inteiro (contrato `phone_masked`).
 */
export function maskPhone(raw: string | null | undefined): string | null {
  const formatted = formatPhoneForDisplay(raw);
  if (formatted === null) return null;
  const digits = formatted.replace(/\D/g, '');
  if (digits.length <= 4) return '••••';
  let remaining = digits.length - 4;
  let out = '';
  for (const ch of formatted) {
    if (/\d/.test(ch)) {
      out += remaining > 0 ? '•' : ch;
      remaining -= 1;
    } else {
      out += ch;
    }
  }
  return out.slice(0, 40);
}

const PHONE_LIKE = /^\+?[\d\s().-]{8,}$/;

/**
 * Título/nome que é só um telefone (negócio criado sem nome de contato usa o telefone como
 * título): o modelo recebe o telefone mascarado, nunca o número.
 */
export function guardPhoneLike(text: string): string {
  return PHONE_LIKE.test(text.trim()) ? (maskPhone(text) ?? '••••') : text;
}

/**
 * Resposta única para id inexistente, de outro workspace ou fora do escopo do membro.
 * `decision: 'executed'` porque a ferramenta rodou e não achou; não há "sem permissão".
 */
export function notFound(what: string): CopilotToolEnvelope {
  return {
    ok: false,
    decision: 'executed',
    model_view: {
      error: 'not_found',
      message: `${what} não encontrado ou fora do seu acesso. Não tente adivinhar outro id.`,
    },
  };
}

/** Rótulos dos papéis (nome de papel, não dado de contato). */
export const ROLE_LABELS: Readonly<Record<string, string>> = {
  OWNER: 'Proprietário',
  ADMIN: 'Administrador',
  SUPERVISOR: 'Supervisor',
  AGENT: 'Atendente',
  READONLY: 'Somente leitura',
};

/** Escapa `%`, `_` e `\` para uso em `ilike ... escape '\'`. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}
