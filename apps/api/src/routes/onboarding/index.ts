/**
 * API de onboarding & verticalização (F43-S04 / ONBOARDING.md §2.2, §3, §5).
 *
 * Substitui a antiga `POST /api/onboarding/niche` (que só criava pipeline+agente)
 * pelo fluxo completo baseado em Niche Blueprint:
 *
 *   POST /api/onboarding/apply     → aplica o blueprint do nicho (workspace.edit)
 *   GET  /api/onboarding/state     → onboarding + checklist + tour do membro (workspace.edit)
 *   PUT  /api/onboarding/survey    → grava a mini-pesquisa (workspace.edit)
 *   GET  /api/onboarding/checklist → checklist derivado do dado real (workspace.edit)
 *   PUT  /api/me/tour-state        → carimba um tour do próprio membro (qualquer auth)
 *   POST /api/onboarding/niche     → LEGADO: delega para `apply` (compat F5-S15)
 *
 * Aplicar blueprint / ler estado de onboarding = ação administrativa → gated por
 * `workspace.edit` (ADMIN/OWNER), coerente com `routes/audit.ts`. O `tour_state`
 * é por membro: qualquer autenticado escreve só o seu (sem `workspace.edit`).
 *
 * Tudo idempotente herda do instanciador (`instantiateNicheBlueprint`, F43-S02).
 * Toda input externa é validada por Zod (`unknown` + parse; zero `any`). Erros
 * seguem UX §2.11: `error` (código), `message` (o quê/por quê/o que fazer).
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { onboardingRepo, getBlueprint, isNicheKey, NICHE_KEYS } from './db-internal';
import type { WorkspaceOnboarding } from './db-internal';
import { instantiateNicheBlueprint } from './db-internal';
import { deriveChecklist } from './checklist';
import { surveyBodySchema, type SurveyAnswers } from './survey';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';

/** Body de POST /apply — nicho restrito às 7 chaves canônicas (registry S03). */
const applyBodySchema = z.object({
  niche: z.enum(NICHE_KEYS as [string, ...string[]]),
});

/**
 * Body de PUT /me/tour-state. Exige `completed` OU `dismissed` (pelo menos um) —
 * "marcar visto" e "dispensar" são as duas transições suportadas (§4.1).
 */
const tourStateBodySchema = z
  .object({
    tourId: z.string().trim().min(1).max(120),
    completed: z.boolean().optional(),
    dismissed: z.boolean().optional(),
  })
  .refine((b) => b.completed === true || b.dismissed === true, {
    message: 'Informe `completed: true` ou `dismissed: true` para registrar o tour.',
  });

/**
 * Body LEGADO de POST /niche (compat F5-S15): aceita `clinic` (chave antiga, hoje
 * mapeada para `health`) além das chaves novas. `createAgent` é ignorado — o
 * blueprint sempre instancia os agentes declarados.
 */
const legacyNicheBodySchema = z.object({
  niche: z.string().trim().min(1),
  createAgent: z.boolean().optional(),
});

/** Mapeia chaves de nicho legadas para a chave canônica do registry atual. */
const LEGACY_NICHE_ALIASES: Record<string, string> = {
  clinic: 'health',
};

/**
 * Núcleo de `apply`: resolve o blueprint, instancia sob RLS e carimba o estado de
 * onboarding (`niche_key` + `applied_at`). Compartilhado por `/apply` e `/niche`.
 * Retorna `null` se a chave não corresponder a um nicho conhecido.
 */
async function applyNiche(
  req: Request,
  nicheKey: string,
): Promise<{ pipelineId: string; agentIds: string[]; createdCounts: Record<string, number> } | null> {
  const blueprint = getBlueprint(nicheKey);
  if (!blueprint) return null;

  const workspaceId = req.auth!.workspace.id;

  return req.scoped!(async (tx) => {
    const result = await instantiateNicheBlueprint(tx, workspaceId, blueprint);
    const patch: Partial<WorkspaceOnboarding> = {
      niche_key: blueprint.key,
      applied_at: new Date().toISOString(),
    };
    await onboardingRepo.mergeWorkspaceOnboarding(tx, workspaceId, patch);
    return {
      pipelineId: result.pipelineId,
      agentIds: result.agentIds,
      createdCounts: result.createdCounts,
    };
  });
}

export function createOnboardingRouter(): Router {
  const router = Router();
  // Estado/aplicação de onboarding = ação administrativa.
  const adminGuard = [requireAuth, withRLS, requireRole('workspace.edit')] as const;
  // Tour é por membro: qualquer autenticado (precisa de req.scoped p/ gravar sob RLS).
  const memberGuard = [requireAuth, withRLS] as const;

  // ── POST /api/onboarding/apply ─────────────────────────────────────────────
  router.post('/api/onboarding/apply', ...adminGuard, async (req: Request, res: Response) => {
    const parsed = applyBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'invalid_payload',
        message: `Nicho inválido. Escolha um dos nichos suportados: ${NICHE_KEYS.join(', ')}.`,
        issues: parsed.error.issues,
      });
      return;
    }

    const result = await applyNiche(req, parsed.data.niche);
    if (!result) {
      res.status(404).json({
        error: 'niche_not_found',
        message: 'Não encontramos um pacote para esse nicho. Verifique a chave e tente de novo.',
      });
      return;
    }
    res.status(201).json(result);
  });

  // ── GET /api/onboarding/state ──────────────────────────────────────────────
  router.get('/api/onboarding/state', ...adminGuard, async (req: Request, res: Response) => {
    const memberId = req.auth!.member.id;
    const workspaceId = req.auth!.workspace.id;

    const { onboarding, checklist, tourState } = await req.scoped!(async (tx) => {
      const onboarding = await onboardingRepo.getWorkspaceOnboarding(tx, workspaceId);
      const tourState = await onboardingRepo.getMemberTourState(tx, memberId);
      const checklist = await deriveChecklist(tx);
      return { onboarding, checklist, tourState };
    });

    res.json({ onboarding, checklist, tourState });
  });

  // ── GET /api/onboarding/checklist ──────────────────────────────────────────
  router.get('/api/onboarding/checklist', ...adminGuard, async (req: Request, res: Response) => {
    const steps = await req.scoped!((tx) => deriveChecklist(tx));
    res.json({ steps });
  });

  // ── PUT /api/onboarding/survey ─────────────────────────────────────────────
  router.put('/api/onboarding/survey', ...adminGuard, async (req: Request, res: Response) => {
    const parsed = surveyBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'invalid_payload',
        message:
          'Não foi possível salvar a pesquisa: alguma resposta está em formato inválido. Revise os campos e envie de novo.',
        issues: parsed.error.issues,
      });
      return;
    }

    const survey: SurveyAnswers = parsed.data;
    const workspaceId = req.auth!.workspace.id;
    const onboarding = await req.scoped!((tx) =>
      onboardingRepo.mergeWorkspaceOnboarding(tx, workspaceId, { survey }),
    );

    res.json({ onboarding });
  });

  // ── PUT /api/me/tour-state ─────────────────────────────────────────────────
  router.put('/api/me/tour-state', ...memberGuard, async (req: Request, res: Response) => {
    const parsed = tourStateBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'invalid_payload',
        message:
          'Não foi possível registrar o tour: informe o `tourId` e marque como concluído ou dispensado.',
        issues: parsed.error.issues,
      });
      return;
    }

    const { tourId, completed, dismissed } = parsed.data;
    const memberId = req.auth!.member.id;

    const tourState = await req.scoped!((tx) =>
      onboardingRepo.markTour(tx, memberId, tourId, {
        ...(completed === true ? { completed_at: new Date().toISOString() } : {}),
        ...(dismissed === true ? { dismissed: true } : {}),
      }),
    );

    res.json({ tourState });
  });

  // ── POST /api/onboarding/niche (LEGADO) ────────────────────────────────────
  // Compat F5-S15: delega para a lógica de `apply`, mapeando aliases antigos.
  router.post('/api/onboarding/niche', ...adminGuard, async (req: Request, res: Response) => {
    const parsed = legacyNicheBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'invalid_payload',
        message: 'Nicho inválido. Informe a chave do nicho a aplicar.',
        issues: parsed.error.issues,
      });
      return;
    }

    const requested = parsed.data.niche;
    const resolved = LEGACY_NICHE_ALIASES[requested] ?? requested;
    if (!isNicheKey(resolved)) {
      res.status(404).json({
        error: 'niche_not_found',
        message: `Nicho desconhecido. Nichos suportados: ${NICHE_KEYS.join(', ')}.`,
      });
      return;
    }

    const result = await applyNiche(req, resolved);
    if (!result) {
      res.status(404).json({
        error: 'niche_not_found',
        message: 'Não encontramos um pacote para esse nicho.',
      });
      return;
    }
    res.status(201).json(result);
  });

  return router;
}
