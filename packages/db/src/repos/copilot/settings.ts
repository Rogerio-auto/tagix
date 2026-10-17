/**
 * Configuração do Copiloto por workspace e preferências por membro (F73-S01).
 *
 * Sem linha = defaults (spec §4): o workspace nunca precisa de backfill para ter o Copiloto.
 * Todas as funções rodam sob o `tx` de `withWorkspace` (RLS por workspace).
 */
import { and, eq, sql } from 'drizzle-orm';
import type { DbTx } from '../../client';
import {
  copilotMemberPrefs,
  copilotSettings,
  type CopilotAutoOpenMode,
  type CopilotBudgetMode,
  type CopilotCapabilityMatrix,
  type CopilotHistoryRetentionMonths,
  type CopilotMemberPrefsRow,
  type CopilotSurface,
} from '../../schema/copilot';

/** Defaults de `copilot_settings` quando o workspace não tem linha (contrato do F73-S01). */
export const COPILOT_SETTINGS_DEFAULTS = {
  enabled: true,
  capabilityMatrix: {},
  monthlyBudgetUsd: '30.00',
  budgetMode: 'queries_only',
  budgetAlertPct: 80,
  historyRetentionMonths: 12,
  defaultAutoOpen: 'daily',
  partnerAccess: false,
  model: null,
} as const satisfies CopilotSettingsValues;

/** Campos editáveis da configuração. */
export interface CopilotSettingsValues {
  enabled: boolean;
  capabilityMatrix: CopilotCapabilityMatrix;
  /** USD como string decimal (numeric). */
  monthlyBudgetUsd: string;
  budgetMode: CopilotBudgetMode;
  budgetAlertPct: number;
  historyRetentionMonths: CopilotHistoryRetentionMonths;
  defaultAutoOpen: CopilotAutoOpenMode;
  partnerAccess: boolean;
  model: string | null;
}

/** Configuração efetiva (linha gravada ou defaults). `persisted=false` = defaults. */
export interface CopilotSettingsView extends CopilotSettingsValues {
  readonly workspaceId: string;
  readonly persisted: boolean;
  readonly updatedBy: string | null;
  readonly updatedAt: Date | null;
}

export async function getSettings(tx: DbTx, workspaceId: string): Promise<CopilotSettingsView> {
  const [row] = await tx
    .select()
    .from(copilotSettings)
    .where(eq(copilotSettings.workspaceId, workspaceId));
  if (!row) {
    return {
      ...COPILOT_SETTINGS_DEFAULTS,
      capabilityMatrix: {},
      workspaceId,
      persisted: false,
      updatedBy: null,
      updatedAt: null,
    };
  }
  return {
    workspaceId: row.workspaceId,
    enabled: row.enabled,
    capabilityMatrix: row.capabilityMatrix,
    monthlyBudgetUsd: row.monthlyBudgetUsd,
    budgetMode: row.budgetMode,
    budgetAlertPct: row.budgetAlertPct,
    historyRetentionMonths: row.historyRetentionMonths,
    defaultAutoOpen: row.defaultAutoOpen,
    partnerAccess: row.partnerAccess,
    model: row.model,
    persisted: true,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt,
  };
}

/**
 * Grava (parcialmente) a configuração. Campos ausentes de `patch` mantêm o valor atual (ou o
 * default, na primeira gravação).
 */
export async function upsertSettings(
  tx: DbTx,
  input: { workspaceId: string; updatedBy: string | null; patch: Partial<CopilotSettingsValues> },
): Promise<CopilotSettingsView> {
  const { patch } = input;
  const values = { ...COPILOT_SETTINGS_DEFAULTS, capabilityMatrix: {}, ...patch };
  await tx
    .insert(copilotSettings)
    .values({ workspaceId: input.workspaceId, updatedBy: input.updatedBy, ...values })
    .onConflictDoUpdate({
      target: copilotSettings.workspaceId,
      set: { ...patch, updatedBy: input.updatedBy, updatedAt: sql`now()` },
    });
  return getSettings(tx, input.workspaceId);
}

export const copilotSettingsRepo = { get: getSettings, upsert: upsertSettings } as const;

// ─── Preferências do membro ──────────────────────────────────────────────────────

export interface CopilotMemberPrefsValues {
  /** null = herda `copilot_settings.default_auto_open`. */
  autoOpen: CopilotAutoOpenMode | null;
  /** `YYYY-MM-DD` (data local do membro). */
  briefingLastSeenOn: string | null;
  surface: CopilotSurface;
  firstUseHintSeenAt: Date | null;
}

export const COPILOT_MEMBER_PREFS_DEFAULTS = {
  autoOpen: null,
  briefingLastSeenOn: null,
  surface: 'bubble',
  firstUseHintSeenAt: null,
} as const satisfies CopilotMemberPrefsValues;

export interface CopilotMemberPrefsView extends CopilotMemberPrefsValues {
  readonly workspaceId: string;
  readonly memberId: string;
  readonly persisted: boolean;
}

function prefsView(row: CopilotMemberPrefsRow): CopilotMemberPrefsView {
  return {
    workspaceId: row.workspaceId,
    memberId: row.memberId,
    autoOpen: row.autoOpen,
    briefingLastSeenOn: row.briefingLastSeenOn,
    surface: row.surface,
    firstUseHintSeenAt: row.firstUseHintSeenAt,
    persisted: true,
  };
}

export async function getMemberPrefs(
  tx: DbTx,
  workspaceId: string,
  memberId: string,
): Promise<CopilotMemberPrefsView> {
  const [row] = await tx
    .select()
    .from(copilotMemberPrefs)
    .where(
      and(eq(copilotMemberPrefs.workspaceId, workspaceId), eq(copilotMemberPrefs.memberId, memberId)),
    );
  if (!row) return { ...COPILOT_MEMBER_PREFS_DEFAULTS, workspaceId, memberId, persisted: false };
  return prefsView(row);
}

export async function upsertMemberPrefs(
  tx: DbTx,
  input: { workspaceId: string; memberId: string; patch: Partial<CopilotMemberPrefsValues> },
): Promise<CopilotMemberPrefsView> {
  const { patch } = input;
  const [row] = await tx
    .insert(copilotMemberPrefs)
    .values({
      workspaceId: input.workspaceId,
      memberId: input.memberId,
      ...COPILOT_MEMBER_PREFS_DEFAULTS,
      ...patch,
    })
    .onConflictDoUpdate({
      target: [copilotMemberPrefs.workspaceId, copilotMemberPrefs.memberId],
      set: { ...patch, updatedAt: sql`now()` },
    })
    .returning();
  if (!row) throw new Error('copilot: preferências não materializaram após upsert.');
  return prefsView(row);
}

export const copilotMemberPrefsRepo = { get: getMemberPrefs, upsert: upsertMemberPrefs } as const;
