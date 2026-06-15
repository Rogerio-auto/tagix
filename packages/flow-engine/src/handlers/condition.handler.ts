/**
 * Handler `condition` (FLOW_BUILDER.md secao 4.1). Avalia um operando binario e roteia por
 * `true`/`false`. HAS_TAG/IN_STAGE avaliam contact_tags/deals sob RLS (F5-S16). Os demais
 * (BUSINESS_HOURS/HAS_VALUE/MSG_CONTAINS/MSG_EQUALS) avaliam sobre `ctx.variables`.
 */
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { schema, withWorkspace } from '@hm/db';
import type { FlowExecutionContext } from '../types';
import type { FlowHandler } from '../types';

const { contactTags, deals } = schema;

/** HAS_TAG: o contato tem a tag? (contact_tags sob RLS). */
async function evalHasTag(ctx: FlowExecutionContext, tagId: string | undefined): Promise<boolean> {
  if (!ctx.contactId || !tagId) return false;
  return withWorkspace(ctx.workspaceId, async (tx) => {
    const [row] = await tx
      .select({ tagId: contactTags.tagId })
      .from(contactTags)
      .where(and(eq(contactTags.contactId, ctx.contactId!), eq(contactTags.tagId, tagId)))
      .limit(1);
    return Boolean(row);
  });
}

/** IN_STAGE: o contato tem um deal aberto no stage indicado? (deals sob RLS). */
async function evalInStage(ctx: FlowExecutionContext, stageId: string | undefined): Promise<boolean> {
  if (!ctx.contactId || !stageId) return false;
  return withWorkspace(ctx.workspaceId, async (tx) => {
    const [row] = await tx
      .select({ id: deals.id })
      .from(deals)
      .where(and(eq(deals.contactId, ctx.contactId!), eq(deals.stageId, stageId), isNull(deals.closedAt)))
      .limit(1);
    return Boolean(row);
  });
}

const OPERATORS = [
  'HAS_TAG',
  'IN_STAGE',
  'BUSINESS_HOURS',
  'HAS_VALUE',
  'MSG_CONTAINS',
  'MSG_EQUALS',
] as const;

const conditionSchema = z.object({
  operator: z.enum(OPERATORS),
  // operando configuravel: tag/stage id, variavel-alvo, texto a comparar, janela de horario.
  variable: z.string().optional(),
  value: z.string().optional(),
  tagId: z.string().optional(),
  stageId: z.string().optional(),
  businessHours: z
    .object({
      // Opcionais para tolerar configuracao parcial salva no editor; eval retorna false se incompletos.
      start: z.string().optional(), // "09:00"
      end: z.string().optional(), // "18:00" (se <= start, a janela cruza a meia-noite)
      // Preferencial: IANA timezone (respeita DST). `timezoneOffsetMinutes` e fallback legado.
      timezone: z.string().optional(),
      timezoneOffsetMinutes: z.number().optional(),
      days: z.array(z.number().min(0).max(6)).optional(),
    })
    .optional(),
});

function resolveVar(ctx: FlowExecutionContext, path: string | undefined): unknown {
  if (!path) return undefined;
  return path.split('.').reduce<unknown>((obj, key) => {
    if (obj && typeof obj === 'object' && key in obj) return (obj as Record<string, unknown>)[key];
    return undefined;
  }, ctx.variables);
}

const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Dia da semana (0=Dom) e minutos-do-dia para um instante numa IANA timezone (respeita DST). */
function zonedDayAndMinutes(date: Date, timezone: string): { day: number; minutes: number } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const weekday = parts.find((p) => p.type === 'weekday')?.value;
    const hourStr = parts.find((p) => p.type === 'hour')?.value;
    const minuteStr = parts.find((p) => p.type === 'minute')?.value;
    if (!weekday || hourStr === undefined || minuteStr === undefined) return null;
    const day = WEEKDAY_INDEX[weekday];
    if (day === undefined) return null;
    // hour12:false pode produzir "24" para meia-noite em alguns ambientes.
    const hour = Number(hourStr) % 24;
    return { day, minutes: hour * 60 + Number(minuteStr) };
  } catch {
    return null;
  }
}

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function evalBusinessHours(
  ctx: FlowExecutionContext,
  cfg: NonNullable<z.infer<typeof conditionSchema>['businessHours']>,
): boolean {
  // Configuracao incompleta nunca casa (evita parse-throw em runtime).
  const start = cfg.start ?? '';
  const end = cfg.end ?? '';
  if (!HHMM_RE.test(start) || !HHMM_RE.test(end)) return false;

  let day: number;
  let minutes: number;

  const zoned = cfg.timezone ? zonedDayAndMinutes(ctx.now(), cfg.timezone) : null;
  if (zoned) {
    day = zoned.day;
    minutes = zoned.minutes;
  } else {
    // Fallback legado: offset fixo em minutos (sem DST).
    const now = new Date(ctx.now().getTime() + (cfg.timezoneOffsetMinutes ?? 0) * 60_000);
    day = now.getUTCDay();
    minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  }

  if (cfg.days && cfg.days.length > 0 && !cfg.days.includes(day)) return false;

  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const startMin = (sh ?? 0) * 60 + (sm ?? 0);
  const endMin = (eh ?? 0) * 60 + (em ?? 0);

  // Janela que cruza a meia-noite (ex.: 22:00–06:00): dentro se >= inicio OU <= fim.
  if (endMin <= startMin) return minutes >= startMin || minutes <= endMin;
  return minutes >= startMin && minutes <= endMin;
}

export const conditionHandler: FlowHandler<z.infer<typeof conditionSchema>> = {
  schema: conditionSchema,
  async execute(node, ctx) {
    const data = conditionSchema.parse(node.data);
    let result = false;

    switch (data.operator) {
      case 'HAS_TAG':
        result = await evalHasTag(ctx, data.tagId);
        break;
      case 'IN_STAGE':
        result = await evalInStage(ctx, data.stageId);
        break;
      case 'BUSINESS_HOURS':
        result = data.businessHours ? evalBusinessHours(ctx, data.businessHours) : false;
        break;
      case 'HAS_VALUE': {
        const v = resolveVar(ctx, data.variable);
        result = v !== undefined && v !== null && v !== '';
        break;
      }
      case 'MSG_CONTAINS': {
        const v = String(resolveVar(ctx, data.variable ?? 'trigger.message') ?? '').toLowerCase();
        result = data.value ? v.includes(data.value.toLowerCase()) : false;
        break;
      }
      case 'MSG_EQUALS': {
        const v = String(resolveVar(ctx, data.variable ?? 'trigger.message') ?? '')
          .trim()
          .toLowerCase();
        result = data.value ? v === data.value.trim().toLowerCase() : false;
        break;
      }
    }

    return { status: 'SUCCESS', edgeHandle: result ? 'true' : 'false' };
  },
};
