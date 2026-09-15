/**
 * Permissões da Meta por caso de uso — a decisão pura (F69-S02).
 *
 * ## Por que por caso de uso
 *
 * O cliente não pensa em `pages_read_engagement`; pensa em "quero receber os leads
 * dos meus anúncios". A conexão pede as permissões **dos casos de uso que ele
 * escolheu**, e quando falta alguma a tela diz qual caso de uso parou e o que
 * reconectar — em vez de uma ação falhar no meio com um erro da Graph.
 *
 * ## Fonte única
 *
 * Os nomes abaixo vêm de `META_INTEGRACAO_PLAN.md` §3, verificados em 2026-09-14.
 * A Meta renomeia permissões com frequência: **antes de submeter ao App Review,
 * conferir cada nome no painel do app** (F69-S08 e F69-S10). Mudar aqui muda o
 * login, a checagem de saúde e o kit de review ao mesmo tempo — que é o motivo de
 * existir uma lista só.
 *
 * O WhatsApp fica fora de propósito: ele conecta pelo Embedded Signup, que tem o
 * próprio fluxo de permissões e já está em produção.
 */

export const META_USE_CASES = [
  'leads',
  'ads_read',
  'ads_manage',
  'instagram',
  'instagram_publish',
  'ads_mcp',
] as const;
export type MetaUseCase = (typeof META_USE_CASES)[number];

export const USE_CASE_PERMISSIONS: Readonly<Record<MetaUseCase, readonly string[]>> = {
  leads: [
    'leads_retrieval',
    'pages_manage_ads',
    'pages_manage_metadata',
    'pages_show_list',
    'pages_read_engagement',
    'ads_management',
  ],
  ads_read: ['ads_read', 'business_management'],
  ads_manage: ['ads_management', 'ads_read', 'business_management'],
  instagram: [
    'pages_show_list',
    'pages_manage_metadata',
    'instagram_basic',
    'instagram_manage_messages',
    'instagram_manage_comments',
    'business_management',
  ],
  instagram_publish: ['instagram_basic', 'instagram_content_publish', 'pages_show_list'],
  ads_mcp: ['ads_mcp_management', 'ads_read', 'business_management'],
};

/** Rótulo do caso de uso na tela, em linguagem de dono. */
export const USE_CASE_LABEL: Readonly<Record<MetaUseCase, string>> = {
  leads: 'Leads dos anúncios',
  ads_read: 'Resultado dos anúncios',
  ads_manage: 'Gerenciar anúncios',
  instagram: 'Mensagens e comentários do Instagram',
  instagram_publish: 'Publicar no Instagram',
  ads_mcp: 'Assistente de anúncios com IA',
};

export function isMetaUseCase(v: unknown): v is MetaUseCase {
  return typeof v === 'string' && (META_USE_CASES as readonly string[]).includes(v);
}

/** União sem repetição das permissões de vários casos de uso, em ordem estável. */
export function permissionsFor(useCases: readonly MetaUseCase[]): string[] {
  const vistas = new Set<string>();
  for (const uc of useCases) {
    for (const p of USE_CASE_PERMISSIONS[uc]) vistas.add(p);
  }
  return [...vistas];
}

export interface PermissionSnapshot {
  readonly granted: string[];
  readonly declined: string[];
}

/**
 * Lê a resposta de `GET /me/permissions`.
 *
 * `expired` conta como negada: para o produto, permissão expirada e permissão
 * recusada têm a mesma consequência — a ação não funciona até reconectar.
 * Item malformado é ignorado, não derruba a leitura.
 */
export function parsePermissions(body: unknown): PermissionSnapshot {
  const granted: string[] = [];
  const declined: string[] = [];
  const data =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['data'] : null;
  if (!Array.isArray(data)) return { granted, declined };
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    const nome = r['permission'];
    const status = r['status'];
    if (typeof nome !== 'string' || nome === '') continue;
    if (status === 'granted') granted.push(nome);
    else if (status === 'declined' || status === 'expired') declined.push(nome);
  }
  return { granted, declined };
}

/** Permissões que faltam para cada caso de uso escolhido. Caso de uso completo não aparece. */
export function missingByUseCase(
  useCases: readonly MetaUseCase[],
  granted: readonly string[],
): Partial<Record<MetaUseCase, string[]>> {
  const tem = new Set(granted);
  const faltas: Partial<Record<MetaUseCase, string[]>> = {};
  for (const uc of useCases) {
    const falta = USE_CASE_PERMISSIONS[uc].filter((p) => !tem.has(p));
    if (falta.length > 0) faltas[uc] = falta;
  }
  return faltas;
}

export type ConnectionHealth = 'ok' | 'expiring' | 'missing_permissions' | 'expired' | 'revoked';

/** Com menos que isso até expirar, avisamos. Token de longa duração da Meta dura ~60 dias. */
export const EXPIRING_WINDOW_DAYS = 7;

/**
 * Saúde da conexão, na ordem em que o problema impede mais coisa:
 * revogada → expirada → falta permissão → perto de expirar → ok.
 *
 * `expiresAt` nulo é token sem expiração (usuário de sistema) — não é problema.
 */
export function connectionHealth(input: {
  readonly now: Date;
  readonly status: 'active' | 'revoked';
  readonly expiresAt: Date | null;
  readonly useCases: readonly MetaUseCase[];
  readonly granted: readonly string[];
}): ConnectionHealth {
  if (input.status === 'revoked') return 'revoked';
  if (input.expiresAt !== null && input.expiresAt.getTime() <= input.now.getTime()) {
    return 'expired';
  }
  if (Object.keys(missingByUseCase(input.useCases, input.granted)).length > 0) {
    return 'missing_permissions';
  }
  if (
    input.expiresAt !== null &&
    input.expiresAt.getTime() - input.now.getTime() < EXPIRING_WINDOW_DAYS * 86_400_000
  ) {
    return 'expiring';
  }
  return 'ok';
}
