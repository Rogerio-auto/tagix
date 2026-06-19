/**
 * Mini-pesquisa de first-run (ONBOARDING.md §3.2): tipo de negócio, tamanho do
 * time e objetivo principal. Persistida em `workspaces.onboarding.survey`.
 *
 * O schema é estrito (zero `any`): campos conhecidos com enums fechados onde faz
 * sentido + um campo livre opcional para detalhe. Toda input externa passa por
 * Zod antes de tocar o banco.
 */
import { z } from 'zod';

/** Tamanho do time declarado (faixas). */
export const TEAM_SIZES = ['solo', '2-5', '6-20', '21-50', '50+'] as const;

/** Objetivo principal ao entrar na Leadium. */
export const SURVEY_GOALS = [
  'sell_more',
  'support_faster',
  'automate',
  'organize_pipeline',
  'other',
] as const;

/**
 * Schema da pesquisa. `businessType` é texto livre curto (o nicho é capturado
 * à parte, no `apply`). Todos os campos são opcionais para permitir submissão
 * incremental, mas pelo menos um precisa estar presente (ver `surveyBodySchema`).
 */
export const surveySchema = z
  .object({
    businessType: z.string().trim().min(1).max(120).optional(),
    teamSize: z.enum(TEAM_SIZES).optional(),
    goal: z.enum(SURVEY_GOALS).optional(),
    goalDetail: z.string().trim().max(500).optional(),
  })
  .strict();

export type SurveyAnswers = z.infer<typeof surveySchema>;

/** Body do PUT /survey: a pesquisa com pelo menos uma resposta significativa. */
export const surveyBodySchema = surveySchema.refine(
  (s) => s.businessType != null || s.teamSize != null || s.goal != null,
  { message: 'Informe ao menos uma resposta da pesquisa (tipo de negócio, tamanho ou objetivo).' },
);
