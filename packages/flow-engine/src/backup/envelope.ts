/**
 * Contrato do arquivo de backup de Flows (F50). Schema Zod ESTRITO do envelope + tipos
 * derivados, isomórfico (sem DB) — espelha o perfil puro de `validation.ts`.
 *
 * O envelope carrega o grafo DRAFT de cada flow + metadata + um ÍNDICE de referências
 * (descritores legíveis de cada UUID workspace-específico) para permitir re-vinculação por
 * nome/chave no ambiente destino. O checksum (sha256) é calculado na camada da API
 * (`apps/api/src/services/flow-backup`) sobre a serialização canônica (`canonicalize`).
 */
import { z } from 'zod';
import { TRIGGER_TYPES } from '../handlers/trigger.handler';

/** Versão do formato do arquivo. Bump = mudança incompatível de shape. */
export const BACKUP_FORMAT_VERSION = 1;
/** Marca do produto — guarda contra importar arquivo de outra origem. */
export const BACKUP_APP = 'leadium';

/** Limites de segurança (anti-DoS de memória no import). */
export const MAX_FLOWS = 200;
export const MAX_NODES_PER_FLOW = 500;
export const MAX_EDGES_PER_FLOW = 2000;

/** Kinds de referência. UUID kinds são resolvidos+reescritos; conversionType é por key
 *  (portável, não reescrito); media é só-aviso (chave de storage não migra). */
export const REFERENCE_KINDS = [
  'tag',
  'stage',
  'pipeline',
  'agent',
  'channel',
  'member',
  'flow',
  'conversionType',
  'media',
] as const;
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

/** Kinds cujo valor é UUID e que são resolvidos→remapeados no import. */
export const UUID_REFERENCE_KINDS = [
  'tag',
  'stage',
  'pipeline',
  'agent',
  'channel',
  'member',
  'flow',
] as const;
export type UuidReferenceKind = (typeof UUID_REFERENCE_KINDS)[number];

// ── Grafo (passthrough: tolera campos novos de versões futuras) ───────────────
export const flowNodeSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    data: z.unknown().optional(),
    position: z.object({ x: z.number(), y: z.number() }).partial().optional(),
  })
  .passthrough();
export const flowEdgeSchema = z
  .object({
    id: z.string().min(1),
    source: z.string().min(1),
    target: z.string().min(1),
    sourceHandle: z.string().nullish(),
    targetHandle: z.string().nullish(),
  })
  .passthrough();
export type BackupFlowNode = z.infer<typeof flowNodeSchema>;
export type BackupFlowEdge = z.infer<typeof flowEdgeSchema>;

// ── Índice de referências (descritores legíveis por kind) ─────────────────────
const tagRefSchema = z.object({ id: z.string().uuid(), name: z.string() }).strict();
const stageRefSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    pipelineId: z.string().uuid().nullable(),
    pipelineName: z.string().nullable(),
  })
  .strict();
const pipelineRefSchema = z.object({ id: z.string().uuid(), name: z.string() }).strict();
const agentRefSchema = z.object({ id: z.string().uuid(), name: z.string() }).strict();
const channelRefSchema = z.object({ id: z.string().uuid(), label: z.string(), type: z.string() }).strict();
const memberRefSchema = z
  .object({ id: z.string().uuid(), name: z.string().nullable(), email: z.string() })
  .strict();
const flowRefSchema = z.object({ id: z.string().uuid(), name: z.string() }).strict();
const conversionTypeRefSchema = z
  .object({ id: z.string().uuid(), key: z.string(), name: z.string() })
  .strict();

export const referenceIndexSchema = z
  .object({
    tags: z.array(tagRefSchema).default([]),
    stages: z.array(stageRefSchema).default([]),
    pipelines: z.array(pipelineRefSchema).default([]),
    agents: z.array(agentRefSchema).default([]),
    channels: z.array(channelRefSchema).default([]),
    members: z.array(memberRefSchema).default([]),
    flows: z.array(flowRefSchema).default([]),
    conversionTypes: z.array(conversionTypeRefSchema).default([]),
  })
  .strict();
export type ReferenceIndex = z.infer<typeof referenceIndexSchema>;
export type TagRef = z.infer<typeof tagRefSchema>;
export type StageRef = z.infer<typeof stageRefSchema>;
export type ChannelRef = z.infer<typeof channelRefSchema>;
export type MemberRef = z.infer<typeof memberRefSchema>;
export type ConversionTypeRef = z.infer<typeof conversionTypeRefSchema>;

// ── Entry de flow (grafo DRAFT + metadata) ────────────────────────────────────
export const flowBackupEntrySchema = z
  .object({
    sourceId: z.string().uuid(),
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    triggerType: z.enum(TRIGGER_TYPES),
    triggerConfig: z.record(z.unknown()).default({}),
    filterStatus: z.array(z.string()).nullable().optional(),
    filterStageIds: z.array(z.string().uuid()).nullable().optional(),
    filterTagIds: z.array(z.string().uuid()).nullable().optional(),
    channelIds: z.array(z.string().uuid()).nullable().optional(),
    nodes: z.array(flowNodeSchema).max(MAX_NODES_PER_FLOW),
    edges: z.array(flowEdgeSchema).max(MAX_EDGES_PER_FLOW),
    schemaVersion: z.number().int().nonnegative().default(1),
  })
  .strict();
export type FlowBackupEntry = z.infer<typeof flowBackupEntrySchema>;

export const checksumSchema = z
  .object({ algo: z.literal('sha256'), value: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
export type BackupChecksum = z.infer<typeof checksumSchema>;

export const backupEnvelopeSchema = z
  .object({
    formatVersion: z.literal(BACKUP_FORMAT_VERSION),
    app: z.literal(BACKUP_APP),
    exportedAt: z.string().datetime(),
    schemaVersion: z.number().int().nonnegative(),
    checksum: checksumSchema,
    flows: z.array(flowBackupEntrySchema).min(1).max(MAX_FLOWS),
    references: referenceIndexSchema,
  })
  .strict();
export type BackupEnvelope = z.infer<typeof backupEnvelopeSchema>;

// ── Shapes de resultado (preview/import) — construídos pelo serviço (S03), consumidos
//    pela UI (S05). Não são Zod: são contratos de resposta. ─────────────────────
export interface ReferenceResolution {
  readonly kind: ReferenceKind;
  /** valor original no arquivo (UUID ou key). */
  readonly sourceValue: string;
  /** rótulo legível vindo do índice (nome/email/key). */
  readonly label: string;
  /** novo id no workspace destino, ou null se não resolveu (será limpo). */
  readonly resolvedId: string | null;
}

export interface FlowPreviewEntry {
  readonly sourceId: string;
  readonly name: string;
  /** nome já existe no workspace destino → será sufixado. */
  readonly nameCollision: boolean;
  /** nome final que será usado (com sufixo se houve colisão). */
  readonly finalName: string;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly validation: { readonly valid: boolean; readonly errors: number; readonly warnings: number };
  readonly resolvedReferences: number;
  /** referências que NÃO resolveram no destino (serão limpas; reconfigurar antes de publicar). */
  readonly unresolvedReferences: readonly ReferenceResolution[];
  /** mídias (mediaStorageKey) que não migram entre ambientes. */
  readonly mediaWarnings: number;
  /** avisos de versão (tipo de nó desconhecido, schemaVersion divergente). */
  readonly versionWarnings: readonly string[];
}

export interface PreviewResult {
  readonly checksumValid: boolean;
  readonly formatVersion: number;
  readonly flowCount: number;
  readonly flows: readonly FlowPreviewEntry[];
}

export interface ImportedFlow {
  readonly sourceId: string;
  readonly newId: string;
  readonly finalName: string;
}

export interface ImportResult {
  readonly created: readonly ImportedFlow[];
  readonly skipped: readonly { readonly sourceId: string; readonly reason: string }[];
  readonly unresolvedReferencesCleared: number;
  readonly warnings: readonly string[];
}
