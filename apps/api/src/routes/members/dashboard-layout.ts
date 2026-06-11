/**
 * Customização do dashboard (F8-S04, DASHBOARD.md §6/§7).
 *
 *   PATCH /api/members/me/dashboard-layout   layout pessoal (hide/order/period)
 *   GET   /api/dashboard/config              config do workspace (obrigatórios + limites)
 *   PUT   /api/dashboard/config              ADMIN define obrigatórios + SLA/alerta
 *
 * Regras (§6): o member só pode esconder/reordenar cards que o seu role vê
 * (`visibleMetricKeys`), e NUNCA pode esconder um card marcado como obrigatório pelo
 * ADMIN para o seu role. Métrica fora do role é rejeitada (não existe para ele).
 *
 * A config de workspace (obrigatórios por role + limites de SLA/alerta que alimentam
 * os alertas do dashboard) vive em `workspaces.settings.dashboard`.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { schema } from '@hm/db';
import { ROLES, type Role } from '@hm/shared';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import { visibleMetricKeys } from '../../services/dashboard/load-dashboard';

const { members, workspaces } = schema;

const layoutSchema = z
  .object({
    hidden: z.array(z.string().trim().min(1).max(80)).max(200).optional(),
    order: z.array(z.string().trim().min(1).max(80)).max(200).optional(),
    period: z.enum(['today', '7d', '30d', '90d', 'mtd', 'qtd', 'ytd']).nullish(),
  })
  .strict();

const roleEnum = z.enum(ROLES);
const dashboardConfigSchema = z
  .object({
    requiredByRole: z.record(roleEnum, z.array(z.string().trim().min(1).max(80)).max(200)).optional(),
    alertLimits: z
      .object({
        slaViolationCount: z.number().int().min(0).nullish(),
        llmCostUsdDaily: z.number().min(0).nullish(),
      })
      .optional(),
  })
  .strict();

interface DashboardConfig {
  requiredByRole: Partial<Record<Role, string[]>>;
  alertLimits: { slaViolationCount: number | null; llmCostUsdDaily: number | null };
}

function readConfig(settings: Record<string, unknown>): DashboardConfig {
  const raw = settings['dashboard'];
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const requiredRaw = o['requiredByRole'];
  const requiredByRole: Partial<Record<Role, string[]>> = {};
  if (requiredRaw && typeof requiredRaw === 'object') {
    for (const role of ROLES) {
      const list = (requiredRaw as Record<string, unknown>)[role];
      if (Array.isArray(list)) {
        requiredByRole[role] = list.filter((x): x is string => typeof x === 'string');
      }
    }
  }
  const limitsRaw = o['alertLimits'];
  const lo = limitsRaw && typeof limitsRaw === 'object' ? (limitsRaw as Record<string, unknown>) : {};
  return {
    requiredByRole,
    alertLimits: {
      slaViolationCount: typeof lo['slaViolationCount'] === 'number' ? (lo['slaViolationCount'] as number) : null,
      llmCostUsdDaily: typeof lo['llmCostUsdDaily'] === 'number' ? (lo['llmCostUsdDaily'] as number) : null,
    },
  };
}

export function createDashboardLayoutRouter(): Router {
  const router = Router();
  const authGuard = [requireAuth, withRLS] as const;
  const adminGuard = [requireAuth, withRLS, requireRole('workspace.edit')] as const;

  // ─── PATCH /api/members/me/dashboard-layout ─────────────────────────────────
  router.patch('/api/members/me/dashboard-layout', ...authGuard, async (req: Request, res: Response) => {
    const parsed = layoutSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const memberId = req.auth!.member.id;
    const role = req.auth!.member.role as Role;
    const allowed = new Set(visibleMetricKeys(role));

    const { hidden = [], order = [], period } = parsed.data;

    // Toda key referenciada precisa pertencer ao role (não inventa métrica fora).
    const unknownKey = [...hidden, ...order].find((k) => !allowed.has(k));
    if (unknownKey) {
      res.status(400).json({ error: 'unknown_metric', message: `Métrica fora do seu perfil: ${unknownKey}.` });
      return;
    }

    const outcome = await req.scoped!(async (tx) => {
      const [ws] = await tx.select({ settings: workspaces.settings }).from(workspaces).limit(1);
      const config = readConfig((ws?.settings ?? {}) as Record<string, unknown>);
      const required = new Set(config.requiredByRole[role] ?? []);

      // Não pode esconder um card obrigatório do seu role.
      const blocked = hidden.find((k) => required.has(k));
      if (blocked) return { kind: 'required' as const, blocked };

      const [current] = await tx
        .select({ layout: members.dashboardLayout })
        .from(members)
        .where(eq(members.id, memberId))
        .limit(1);
      const prev = (current?.layout ?? {}) as Record<string, unknown>;
      const nextLayout: Record<string, unknown> = { ...prev, hidden, order };
      if (period !== undefined) nextLayout['period'] = period;

      const [updated] = await tx
        .update(members)
        .set({ dashboardLayout: nextLayout, updatedAt: new Date() })
        .where(eq(members.id, memberId))
        .returning({ layout: members.dashboardLayout });
      return { kind: 'ok' as const, layout: updated?.layout ?? nextLayout };
    });

    if (outcome.kind === 'required') {
      res.status(409).json({ error: 'required_card', message: `Card obrigatório não pode ser escondido: ${outcome.blocked}.` });
      return;
    }
    res.json({ layout: outcome.layout });
  });

  // ─── GET /api/dashboard/config ──────────────────────────────────────────────
  router.get('/api/dashboard/config', ...adminGuard, async (req: Request, res: Response) => {
    const [ws] = await req.scoped!((tx) => tx.select({ settings: workspaces.settings }).from(workspaces).limit(1));
    const config = readConfig((ws?.settings ?? {}) as Record<string, unknown>);
    // Catálogo de métricas por role (p/ a UI montar os checkboxes).
    const catalog: Record<string, string[]> = {};
    for (const role of ROLES) catalog[role] = visibleMetricKeys(role);
    res.json({ config, catalog });
  });

  // ─── PUT /api/dashboard/config ──────────────────────────────────────────────
  router.put('/api/dashboard/config', ...adminGuard, async (req: Request, res: Response) => {
    const parsed = dashboardConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }

    // Cada obrigatório precisa ser visível para aquele role.
    if (parsed.data.requiredByRole) {
      for (const [role, keys] of Object.entries(parsed.data.requiredByRole)) {
        const allowed = new Set(visibleMetricKeys(role as Role));
        const bad = (keys ?? []).find((k) => !allowed.has(k));
        if (bad) {
          res.status(400).json({ error: 'invalid_required', message: `Métrica ${bad} não é visível para ${role}.` });
          return;
        }
      }
    }

    const result = await req.scoped!(async (tx) => {
      const [ws] = await tx.select().from(workspaces).limit(1);
      if (!ws) return null;
      const existing = readConfig((ws.settings ?? {}) as Record<string, unknown>);
      const nextConfig: DashboardConfig = {
        requiredByRole: parsed.data.requiredByRole
          ? { ...existing.requiredByRole, ...parsed.data.requiredByRole }
          : existing.requiredByRole,
        alertLimits: parsed.data.alertLimits
          ? {
              slaViolationCount: parsed.data.alertLimits.slaViolationCount ?? null,
              llmCostUsdDaily: parsed.data.alertLimits.llmCostUsdDaily ?? null,
            }
          : existing.alertLimits,
      };
      const nextSettings = { ...((ws.settings ?? {}) as Record<string, unknown>), dashboard: nextConfig };
      await tx.update(workspaces).set({ settings: nextSettings, updatedAt: new Date() }).where(eq(workspaces.id, ws.id));
      return nextConfig;
    });

    if (!result) {
      res.sendStatus(404);
      return;
    }
    res.json({ config: result });
  });

  return router;
}
