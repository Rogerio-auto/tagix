/**
 * `/api/copilot/me` e `/api/copilot/me/prefs` (F73-S03; COPILOTO.md §5.2).
 *
 *   GET   /api/copilot/me         capacidades efetivas, preferências resolvidas, só leitura,
 *                                 estado do orçamento (US$ só com `copilot.view_costs`)
 *   PATCH /api/copilot/me/prefs   `auto_open`, `surface`, `first_use_hint_seen`
 *
 * Montadas por `createCopilotRouter`, DEPOIS da porta `requireAuth → withRLS →
 * copilotAvailable` (view-as, `copilot.use`, Copiloto desligado). Não montar fora dela.
 *
 * `GET /me` é o primeiro request do cliente (F74-S01): 3 queries indexadas por PK/índice
 * (configuração, lida pela porta; preferências; gasto do mês) e nenhuma outra.
 *
 * Animação e atenção NÃO entram em `/me/prefs`: são da F76 (`members.notification_prefs.copilot`,
 * ADR-006), sem chave repetida entre as duas.
 */
import { Router, type Request, type Response } from 'express';
import {
  copilotMemberPrefsRepo,
  type CopilotMemberPrefsView,
  type CopilotSettingsView,
} from '@hm/db';
import {
  CopilotMeSchema,
  CopilotPrefsUpdateSchema,
  ROLES,
  can,
  effectiveCapabilities,
  copilotAccessFor,
  type CopilotMe,
  type Role,
} from '@hm/shared';
import { isSubscriptionInactive } from '../../../middlewares/subscription-guard';
import { loadCopilotBudget } from '../../../services/copilot/identity/budget';
import { sanitizeCapabilityMatrix } from '../../../services/copilot/identity/principal';

/** "Age com as suas permissões: Supervisor" (mesmos rótulos da tela de membros). */
export const COPILOT_ROLE_LABELS_PT = {
  OWNER: 'Proprietário',
  ADMIN: 'Administrador',
  SUPERVISOR: 'Supervisor',
  AGENT: 'Atendente',
  READONLY: 'Somente leitura',
} as const satisfies Record<Role, string>;

const ROLE_SET: ReadonlySet<string> = new Set(ROLES);

type ResolvedPrefs = CopilotMe['prefs'];

function resolvePrefs(prefs: CopilotMemberPrefsView, settings: CopilotSettingsView): ResolvedPrefs {
  return {
    auto_open: prefs.autoOpen ?? settings.defaultAutoOpen,
    auto_open_source: prefs.autoOpen === null ? 'workspace' : 'member',
    surface: prefs.surface,
    briefing_last_seen_on: prefs.briefingLastSeenOn,
    first_use_hint_seen: prefs.firstUseHintSeenAt !== null,
  };
}

/** Papel e configuração já validados pela porta; sem eles o request não chega aqui. */
function context(req: Request): {
  workspaceId: string;
  memberId: string;
  role: Role;
  settings: CopilotSettingsView;
} | null {
  const auth = req.auth;
  const settings = req.copilot?.settings;
  if (!auth || !settings || !ROLE_SET.has(auth.member.role)) return null;
  return {
    workspaceId: auth.workspace.id,
    memberId: auth.member.id,
    role: auth.member.role as Role,
    settings,
  };
}

export function createCopilotMeRouter(): Router {
  const router = Router();

  router.get('/api/copilot/me', async (req: Request, res: Response) => {
    const ctx = context(req);
    if (!ctx || !req.auth) {
      res.status(403).json({ message: 'Sem permissão para esta ação.' });
      return;
    }
    const { role, settings } = ctx;
    const workspace = req.auth.workspace;

    const { prefs, budget } = await req.scoped!(async (tx) => ({
      prefs: await copilotMemberPrefsRepo.get(tx, ctx.workspaceId, ctx.memberId),
      budget: await loadCopilotBudget(tx, settings),
    }));

    const matrix = sanitizeCapabilityMatrix(settings.capabilityMatrix);
    const access = copilotAccessFor(role, matrix);
    const viewCosts = can(role, 'copilot.view_costs');

    const me: CopilotMe = {
      available: access.allowed,
      unavailable_reason: access.allowed
        ? null
        : access.reason === 'disabled_by_owner'
          ? 'disabled_for_role'
          : 'role',
      role,
      role_label: COPILOT_ROLE_LABELS_PT[role],
      capabilities: effectiveCapabilities(role, matrix),
      permissions: {
        manage: can(role, 'copilot.manage'),
        view_costs: viewCosts,
        memory_edit: can(role, 'copilot.memory.edit'),
        activity_view_all: can(role, 'copilot.activity.view_all'),
        autopilot_manage: can(role, 'copilot.autopilot.manage'),
      },
      read_only: isSubscriptionInactive(workspace.subscriptionStatus, workspace.trialEndsAt),
      prefs: resolvePrefs(prefs, settings),
      budget: {
        state: budget.state,
        resets_on: budget.resetsOn,
        // Valor em US$ só para quem pode agir sobre ele (P7/P8).
        ...(viewCosts
          ? { spent_usd: roundUsd(budget.spentUsd), cap_usd: roundUsd(budget.capUsd) }
          : {}),
      },
    };
    // O contrato é `.strict()`: um campo a mais aqui é deriva, e deriva é 500, não "compatível".
    res.json(CopilotMeSchema.parse(me));
  });

  router.patch('/api/copilot/me/prefs', async (req: Request, res: Response) => {
    const ctx = context(req);
    if (!ctx) {
      res.status(403).json({ message: 'Sem permissão para esta ação.' });
      return;
    }
    const parsed = CopilotPrefsUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const input = parsed.data;
    const prefs = await req.scoped!(async (tx) => {
      const current = await copilotMemberPrefsRepo.get(tx, ctx.workspaceId, ctx.memberId);
      return copilotMemberPrefsRepo.upsert(tx, {
        workspaceId: ctx.workspaceId,
        memberId: ctx.memberId,
        patch: {
          ...(input.auto_open !== undefined ? { autoOpen: input.auto_open } : {}),
          ...(input.surface !== undefined ? { surface: input.surface } : {}),
          // A primeira vez vale: repetir não move a data.
          ...(input.first_use_hint_seen === true && current.firstUseHintSeenAt === null
            ? { firstUseHintSeenAt: new Date() }
            : {}),
        },
      });
    });
    res.json({ prefs: resolvePrefs(prefs, ctx.settings) });
  });

  return router;
}

/** Centavos de dólar: o suficiente para a tela, sem ruído de `numeric(12,8)`. */
function roundUsd(value: number): number {
  return Math.max(0, Math.round(value * 100) / 100);
}
