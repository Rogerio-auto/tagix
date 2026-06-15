/**
 * Validacao de flow pre-publicacao (FLOW_BUILDER.md secao 9.3/12). Funcao PURA (sem I/O):
 * roda identica no servidor (publish, F4-S08) e no browser (banner, F4-S10). Nao importa
 * @hm/db.
 *
 * Regras:
 *  - exatamente 1 node `trigger`;
 *  - nenhum node inalcancavel a partir do trigger (BFS pelas edges);
 *  - sem ciclos no grafo dirigido (DFS com cores);
 *  - sem referencia a variavel desconhecida em `{{var.path}}` (escopo conhecido do secao 8).
 */
import { extractVarReferences } from './utils/interpolate';
import type { FlowEdge, FlowNode } from './types';

export type FlowValidationSeverity = 'error' | 'warning';

export interface FlowValidationIssue {
  readonly severity: FlowValidationSeverity;
  readonly message: string;
  readonly nodeId?: string;
  readonly code: string;
}

export interface FlowValidationResult {
  readonly valid: boolean;
  readonly issues: readonly FlowValidationIssue[];
}

export interface FlowValidationInput {
  readonly nodes: readonly FlowNode[];
  readonly edges: readonly FlowEdge[];
}

/** Prefixos de variavel reconhecidos (secao 8). `*` significa qualquer path abaixo. */
const KNOWN_VAR_ROOTS = new Set([
  'trigger',
  'contact',
  'conversation',
  'deal',
  'webhook_response',
  'last_response',
  'last_response_type',
  'responded',
  'response_edge',
  'waiting_for_response',
  'customer_phone',
  'responsible_phone',
  // F31-S08: raizes dos novos nodes (set_variable -> `vars.*`; input -> `input.*`;
  // ab_split -> `ab_variant`). S09/S11 firmam os shapes; aqui evitam falso-positivo.
  'vars',
  'input',
  'ab_variant',
]);

/** Conjunto alcancavel a partir do node inicial (BFS pelas edges dirigidas). */
export function computeReachable(
  nodes: readonly FlowNode[],
  edges: readonly FlowEdge[],
  startId: string,
): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.source) ?? [];
    list.push(e.target);
    adj.set(e.source, list);
  }
  const seen = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    for (const next of adj.get(cur) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/** Detecta ciclo num grafo dirigido (DFS 3-cores). */
export function hasCycle(nodes: readonly FlowNode[], edges: readonly FlowEdge[]): boolean {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.source) ?? [];
    list.push(e.target);
    adj.set(e.source, list);
  }
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const n of nodes) color.set(n.id, WHITE);

  const visit = (id: string): boolean => {
    color.set(id, GRAY);
    for (const next of adj.get(id) ?? []) {
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) return true;
      if (c === WHITE && visit(next)) return true;
    }
    color.set(id, BLACK);
    return false;
  };

  for (const n of nodes) {
    if ((color.get(n.id) ?? WHITE) === WHITE && visit(n.id)) return true;
  }
  return false;
}

/** Uma referencia e conhecida se a raiz do path esta no escopo do secao 8. */
export function isKnownVar(ref: string): boolean {
  const root = ref.split('.')[0] ?? ref;
  return KNOWN_VAR_ROOTS.has(root);
}

/** Coleta as referencias `{{...}}` de um node (varre strings no node.data recursivamente). */
function collectRefs(value: unknown, acc: string[]): void {
  if (typeof value === 'string') {
    acc.push(...extractVarReferences(value));
  } else if (Array.isArray(value)) {
    for (const v of value) collectRefs(v, acc);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectRefs(v, acc);
  }
}

/**
 * Valida um flow (secao 9.3). Determinismo total — mesma entrada, mesma saida. `valid` e
 * false se houver QUALQUER issue de severidade `error`.
 */
export function validateFlow(input: FlowValidationInput): FlowValidationResult {
  const { nodes, edges } = input;
  const issues: FlowValidationIssue[] = [];

  if (nodes.length === 0) {
    issues.push({ severity: 'error', code: 'empty', message: 'Flow sem nodes' });
    return { valid: false, issues };
  }

  // 1) Exatamente 1 trigger.
  const triggers = nodes.filter((n) => n.type === 'trigger');
  if (triggers.length !== 1) {
    issues.push({
      severity: 'error',
      code: 'trigger_count',
      message: `Exatamente 1 trigger node necessario (encontrados ${triggers.length})`,
    });
  }

  // 2) Nodes inalcancaveis (BFS a partir do trigger).
  const trigger = triggers[0];
  if (trigger) {
    const reachable = computeReachable(nodes, edges, trigger.id);
    for (const n of nodes) {
      if (!reachable.has(n.id)) {
        issues.push({
          severity: 'error',
          code: 'unreachable',
          nodeId: n.id,
          message: `Node inalcancavel a partir do trigger`,
        });
      }
    }
  }

  // 3) Ciclos.
  if (hasCycle(nodes, edges)) {
    issues.push({ severity: 'error', code: 'cycle', message: 'Ciclo detectado no grafo' });
  }

  // 4) Variaveis desconhecidas.
  for (const node of nodes) {
    const refs: string[] = [];
    collectRefs(node.data, refs);
    for (const ref of refs) {
      if (!isKnownVar(ref)) {
        issues.push({
          severity: 'warning',
          code: 'unknown_var',
          nodeId: node.id,
          message: `Variavel desconhecida: {{${ref}}}`,
        });
      }
    }
  }

  const valid = !issues.some((i) => i.severity === 'error');
  return { valid, issues };
}
