/**
 * Entrada validada das rotas da Home (F72-S04). Separado do router para ser testável
 * sem subir app, auth nem banco.
 */
import { z } from 'zod';
import { ROLES, type Role } from '@hm/shared';
import { HOME_PERIOD_DAYS, type HomePeriodDays } from '../../services/dashboard/home-model';

/**
 * Query da Home: `?period=7d|30d|90d` (padrão 30d). Valor fora da lista (ou repetido)
 * é 400, não "cai no padrão" em silêncio. Chaves desconhecidas são ignoradas.
 */
const HOME_PERIOD_BY_KEY: Record<'7d' | '30d' | '90d', HomePeriodDays> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};
export const homeQuerySchema = z
  .object({ period: z.enum(['7d', '30d', '90d']).optional() })
  .transform(({ period }): { periodDays: HomePeriodDays } => ({
    periodDays: period ? HOME_PERIOD_BY_KEY[period] : HOME_PERIOD_DAYS,
  }));

/**
 * Papel do membro autenticado, validado (fail-closed). Um papel fora da matriz não
 * ganha visão nenhuma por omissão: a rota responde 403.
 */
const roleSchema = z.enum(ROLES);
export function parseRole(raw: unknown): Role | null {
  const parsed = roleSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
