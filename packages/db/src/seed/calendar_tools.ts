/**
 * Seed idempotente do catálogo GLOBAL de tools de calendar (F7-S04).
 *
 * Registra as 3 tools categoria `calendar` (`list_calendars`,
 * `get_available_slots`, `schedule_event`) como tools globais da plataforma
 * (`workspace_id = NULL`, `is_global = true`) — para que qualquer workspace possa
 * habilitá-las num agente (via `agent_tools`). A execução é callback Node
 * (calendar-handlers.ts); o `schema` aqui é o function-spec OpenAI/OpenRouter.
 *
 * Idempotência: como `tools.workspace_id` é NULL para tools globais e o UNIQUE
 * `(workspace_id, key)` trata NULLs como distintos, não usamos onConflict — em vez
 * disso fazemos upsert manual por `key` (entre as globais). Re-rodar sincroniza
 * nome/descrição/schema sem duplicar.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { DB } from '../client';
import { tools } from '../schema';

type ToolSeed = {
  key: string;
  name: string;
  description: string;
  schema: Record<string, unknown>;
};

function fn(
  key: string,
  description: string,
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  return { type: 'function', function: { name: key, description, parameters } };
}

const CALENDAR_TOOLS: readonly ToolSeed[] = [
  {
    key: 'list_calendars',
    name: 'Listar calendários',
    description:
      'Lista os calendários disponíveis no workspace, com seus IDs, nomes e tipos.',
    schema: fn('list_calendars', 'Lista calendários do workspace.', {
      type: 'object',
      properties: {
        owner_member_id: { type: ['string', 'null'], description: 'Filtra por dono (member).' },
        type: {
          type: ['string', 'null'],
          enum: ['personal', 'team', 'workspace', null],
          description: 'Filtra por tipo de calendário.',
        },
      },
      additionalProperties: false,
    }),
  },
  {
    key: 'get_available_slots',
    name: 'Buscar horários disponíveis',
    description:
      'Retorna horários livres numa data, respeitando disponibilidade, bloqueios e conflitos.',
    schema: fn(
      'get_available_slots',
      'Retorna horários disponíveis numa data (compute_available_slots).',
      {
        type: 'object',
        required: ['date'],
        properties: {
          date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          member_id: { type: ['string', 'null'] },
          calendar_id: { type: ['string', 'null'] },
          interval_minutes: { type: 'integer', minimum: 15, maximum: 240, default: 60 },
          min_notice_minutes: { type: 'integer', minimum: 0, default: 30 },
          buffer_minutes: { type: 'integer', minimum: 0, maximum: 240, default: 15 },
          max_slots: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
        },
        additionalProperties: false,
      },
    ),
  },
  {
    key: 'schedule_event',
    name: 'Agendar evento',
    description:
      'Cria um evento/reunião na agenda com início, fim e participantes. Chame get_available_slots antes.',
    schema: fn('schedule_event', 'Cria um evento na agenda (reusa createEvent).', {
      type: 'object',
      required: ['title', 'start_at', 'end_at'],
      properties: {
        title: { type: 'string', minLength: 2, maxLength: 300 },
        start_at: { type: 'string', description: 'ISO-8601 com fuso.' },
        end_at: { type: 'string', description: 'ISO-8601 com fuso.' },
        calendar_id: { type: ['string', 'null'] },
        type: {
          type: ['string', 'null'],
          enum: ['meeting', 'demo', 'follow_up', 'task', 'reminder', 'other', null],
        },
        description: { type: ['string', 'null'] },
        location: { type: ['string', 'null'] },
        meeting_url: { type: ['string', 'null'] },
        contact_id: { type: ['string', 'null'] },
      },
      additionalProperties: false,
    }),
  },
];

/** Seeda (upsert por key, entre as globais) as tools de calendar. */
export async function seedCalendarTools(db: DB): Promise<void> {
  for (const t of CALENDAR_TOOLS) {
    const [existing] = await db
      .select({ id: tools.id })
      .from(tools)
      .where(and(eq(tools.key, t.key), isNull(tools.workspaceId)))
      .limit(1);

    if (existing) {
      await db
        .update(tools)
        .set({
          name: t.name,
          description: t.description,
          category: 'calendar',
          schema: t.schema,
          isGlobal: true,
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(tools.id, existing.id));
    } else {
      await db.insert(tools).values({
        workspaceId: null,
        key: t.key,
        name: t.name,
        description: t.description,
        category: 'calendar',
        schema: t.schema,
        isGlobal: true,
        isActive: true,
      });
    }
  }
}
