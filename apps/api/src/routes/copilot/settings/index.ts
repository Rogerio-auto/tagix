/**
 * Configurações do Copiloto por empresa (F73-S03; COPILOTO.md §5.2, §7 A11).
 *
 *   GET /api/copilot/settings   (`copilot.manage`)
 *   PUT /api/copilot/settings   (`copilot.manage`, parcial: só os campos enviados mudam)
 *
 * Montadas por `createCopilotRouter`, DEPOIS da porta `requireAuth → withRLS →
 * copilotAvailable`. A porta deixa `/settings` passar com o Copiloto desligado (ou desligado
 * para o papel): quem desliga precisa da tela para religar.
 *
 * Auditoria: toda mudança efetiva grava `audit_logs` (`copilot.settings.updated`) na MESMA
 * transação do upsert, com a linha travada (`FOR UPDATE`) para que o "antes" seja o que a
 * mudança de fato substituiu. O diff leva só nomes de campo e valores de configuração
 * (booleanos, enums, números, células da matriz); nada de pessoa ou de cliente. Pedido que
 * não muda nada não grava auditoria.
 *
 * Fora do PUT (contrato `CopilotSettingsUpdateSchema`): `model` (escolha da plataforma) e
 * `partner_access: true` (v1.1).
 */
import { isIP } from 'node:net';
import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import {
  copilotSettingsRepo,
  schema,
  type CopilotSettingsValues,
  type CopilotSettingsView,
  type DbTx,
} from '@hm/db';
import {
  CopilotSettingsSchema,
  CopilotSettingsUpdateSchema,
  type CapabilityMatrix,
  type CopilotSettings,
  type CopilotSettingsUpdate,
} from '@hm/shared';
import { requireRole } from '../../../middlewares/auth';
import { clientIp } from '../../../middlewares/rate-limit';
import { sanitizeCapabilityMatrix } from '../../../services/copilot/identity/principal';

export const COPILOT_SETTINGS_AUDIT_ACTION = 'copilot.settings.updated';

/** Nome exibido de quem alterou por último. Nunca o e-mail. */
const UNNAMED_MEMBER = 'Membro da equipe';

async function loadSettingsDto(tx: DbTx, view: CopilotSettingsView): Promise<CopilotSettings> {
  let updatedBy: CopilotSettings['updated_by'] = null;
  if (view.updatedBy) {
    const [member] = await tx
      .select({ id: schema.members.id, name: schema.members.name })
      .from(schema.members)
      .where(eq(schema.members.id, view.updatedBy))
      .limit(1);
    if (member) {
      const name = (member.name ?? '').trim();
      updatedBy = { member_id: member.id, name: (name || UNNAMED_MEMBER).slice(0, 120) };
    }
  }
  const dto: CopilotSettings = {
    enabled: view.enabled,
    capability_matrix: sanitizeCapabilityMatrix(view.capabilityMatrix),
    monthly_budget_usd: Number(view.monthlyBudgetUsd),
    budget_mode: view.budgetMode,
    budget_alert_pct: view.budgetAlertPct,
    history_retention_months: view.historyRetentionMonths,
    default_auto_open: view.defaultAutoOpen,
    partner_access: view.partnerAccess,
    model: view.model,
    updated_by: updatedBy,
    updated_at: view.updatedAt ? view.updatedAt.toISOString() : null,
  };
  return CopilotSettingsSchema.parse(dto);
}

/** Patch do repo a partir do corpo validado. A matriz é substituída inteira. */
function toPatch(input: CopilotSettingsUpdate): Partial<CopilotSettingsValues> {
  return {
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.capability_matrix !== undefined
      ? { capabilityMatrix: sanitizeCapabilityMatrix(input.capability_matrix) }
      : {}),
    ...(input.monthly_budget_usd !== undefined
      ? { monthlyBudgetUsd: input.monthly_budget_usd.toFixed(2) }
      : {}),
    ...(input.budget_mode !== undefined ? { budgetMode: input.budget_mode } : {}),
    ...(input.budget_alert_pct !== undefined ? { budgetAlertPct: input.budget_alert_pct } : {}),
    ...(input.history_retention_months !== undefined
      ? { historyRetentionMonths: input.history_retention_months }
      : {}),
    ...(input.default_auto_open !== undefined ? { defaultAutoOpen: input.default_auto_open } : {}),
    ...(input.partner_access !== undefined ? { partnerAccess: input.partner_access } : {}),
  };
}

type Scalar = string | number | boolean | null;
type Change = { readonly from: Scalar; readonly to: Scalar };

/** Células da matriz que mudaram: `{ 'AGENT.deal.move': { from: null, to: false } }`. */
function matrixChanges(before: CapabilityMatrix, after: CapabilityMatrix): Record<string, Change> {
  const out: Record<string, Change> = {};
  const roles = new Set([...Object.keys(before), ...Object.keys(after)]) as Set<
    keyof CapabilityMatrix
  >;
  for (const role of roles) {
    const b = before[role] ?? {};
    const a = after[role] ?? {};
    const keys = new Set([...Object.keys(b), ...Object.keys(a)]) as Set<keyof typeof a>;
    for (const key of keys) {
      const from = b[key] ?? null;
      const to = a[key] ?? null;
      if (from !== to) out[`${role}.${key}`] = { from, to };
    }
  }
  return out;
}

/** Diff campo a campo entre a configuração anterior e a nova. */
function diffSettings(
  before: CopilotSettingsView,
  after: CopilotSettingsView,
): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  const scalar = (name: string, from: Scalar, to: Scalar): void => {
    if (from !== to) changes[name] = { from, to };
  };
  scalar('enabled', before.enabled, after.enabled);
  scalar('monthly_budget_usd', Number(before.monthlyBudgetUsd), Number(after.monthlyBudgetUsd));
  scalar('budget_mode', before.budgetMode, after.budgetMode);
  scalar('budget_alert_pct', before.budgetAlertPct, after.budgetAlertPct);
  scalar('history_retention_months', before.historyRetentionMonths, after.historyRetentionMonths);
  scalar('default_auto_open', before.defaultAutoOpen, after.defaultAutoOpen);
  scalar('partner_access', before.partnerAccess, after.partnerAccess);
  const matrix = matrixChanges(
    sanitizeCapabilityMatrix(before.capabilityMatrix),
    sanitizeCapabilityMatrix(after.capabilityMatrix),
  );
  if (Object.keys(matrix).length > 0) changes['capability_matrix'] = matrix;
  return changes;
}

export function createCopilotSettingsRouter(): Router {
  const router = Router();
  const guard = requireRole('copilot.manage');

  router.get('/api/copilot/settings', guard, async (req: Request, res: Response) => {
    const workspaceId = req.auth!.workspace.id;
    const dto = await req.scoped!(async (tx) =>
      loadSettingsDto(tx, await copilotSettingsRepo.get(tx, workspaceId)),
    );
    res.json(dto);
  });

  router.put('/api/copilot/settings', guard, async (req: Request, res: Response) => {
    const parsed = CopilotSettingsUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const workspaceId = req.auth!.workspace.id;
    const memberId = req.auth!.member.id;
    // `audit_logs.ip_address` é `inet`: um valor que não é IP derrubaria a transação.
    const ip = clientIp(req);
    const ipAddress = isIP(ip) === 0 ? null : ip;
    const userAgent = req.headers['user-agent']?.slice(0, 500) ?? null;

    const dto = await req.scoped!(async (tx) => {
      // Trava a linha (se existir) para o "antes" do diff ser o que a mudança substitui.
      await tx
        .select({ id: schema.copilotSettings.workspaceId })
        .from(schema.copilotSettings)
        .where(eq(schema.copilotSettings.workspaceId, workspaceId))
        .for('update');
      const before = await copilotSettingsRepo.get(tx, workspaceId);
      const after = await copilotSettingsRepo.upsert(tx, {
        workspaceId,
        updatedBy: memberId,
        patch: toPatch(parsed.data),
      });
      const changes = diffSettings(before, after);
      if (Object.keys(changes).length > 0) {
        await tx.insert(schema.auditLogs).values({
          workspaceId,
          actorMemberId: memberId,
          actorType: 'member',
          action: COPILOT_SETTINGS_AUDIT_ACTION,
          resourceType: 'copilot_settings',
          resourceId: workspaceId,
          metadata: { changes },
          ipAddress,
          userAgent,
        });
      }
      return loadSettingsDto(tx, after);
    });
    res.json(dto);
  });

  return router;
}
