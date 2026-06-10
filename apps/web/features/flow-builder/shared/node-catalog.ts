/**
 * Catalogo dos 15 tipos de node do Flow Builder (FLOW_BUILDER.md secao 4.1). Fonte unica de
 * label/categoria/icon/edges para palette, registry e inspector. O `nodeTypes` registry
 * (canvas) e dono de S10; S11 preenche a UI rica de cada node em `nodes/<tipo>/`.
 */
import {
  Bot,
  Clock,
  GitBranch,
  Globe,
  ListChecks,
  MessageSquare,
  MousePointerClick,
  Play,
  Send,
  Split,
  Tag,
  Tags,
  ToggleLeft,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

export type FlowNodeKind =
  | 'trigger'
  | 'message'
  | 'interactive'
  | 'meta_flow'
  | 'wait'
  | 'wait_for_response'
  | 'condition'
  | 'switch'
  | 'ai_action'
  | 'add_tag'
  | 'remove_tag'
  | 'move_stage'
  | 'change_status'
  | 'http_request'
  | 'external_notify';

export type NodeCategory = 'start' | 'output' | 'timing' | 'logic' | 'system' | 'external';

export interface NodeMeta {
  kind: FlowNodeKind;
  label: string;
  category: NodeCategory;
  icon: LucideIcon;
  /** handles de saida (sourceHandle das edges). `default` = unica saida. */
  edges: readonly string[];
  /** stub-ate-F5 (Pipeline): node aparece com aviso, handler e no-op. */
  deferred?: boolean;
}

export const NODE_CATALOG: Record<FlowNodeKind, NodeMeta> = {
  trigger: { kind: 'trigger', label: 'Gatilho', category: 'start', icon: Play, edges: ['default'] },
  message: {
    kind: 'message',
    label: 'Mensagem',
    category: 'output',
    icon: MessageSquare,
    edges: ['default'],
  },
  interactive: {
    kind: 'interactive',
    label: 'Botoes / Lista',
    category: 'output',
    icon: ListChecks,
    edges: ['default'],
  },
  meta_flow: {
    kind: 'meta_flow',
    label: 'WhatsApp Flow',
    category: 'output',
    icon: Send,
    edges: ['default'],
  },
  wait: { kind: 'wait', label: 'Esperar', category: 'timing', icon: Clock, edges: ['default'] },
  wait_for_response: {
    kind: 'wait_for_response',
    label: 'Aguardar resposta',
    category: 'timing',
    icon: MousePointerClick,
    edges: ['response', 'timeout'],
  },
  condition: {
    kind: 'condition',
    label: 'Condicao',
    category: 'logic',
    icon: GitBranch,
    edges: ['true', 'false'],
  },
  switch: {
    kind: 'switch',
    label: 'Roteamento',
    category: 'logic',
    icon: Split,
    edges: ['default'],
  },
  ai_action: {
    kind: 'ai_action',
    label: 'Acao de IA',
    category: 'system',
    icon: Bot,
    edges: ['default'],
  },
  change_status: {
    kind: 'change_status',
    label: 'Mudar status',
    category: 'system',
    icon: ToggleLeft,
    edges: ['default'],
  },
  http_request: {
    kind: 'http_request',
    label: 'Requisicao HTTP',
    category: 'external',
    icon: Globe,
    edges: ['success', 'error'],
  },
  external_notify: {
    kind: 'external_notify',
    label: 'Notificar externo',
    category: 'external',
    icon: Workflow,
    edges: ['default'],
  },
  add_tag: {
    kind: 'add_tag',
    label: 'Adicionar tag',
    category: 'system',
    icon: Tag,
    edges: ['default'],
    deferred: true,
  },
  remove_tag: {
    kind: 'remove_tag',
    label: 'Remover tag',
    category: 'system',
    icon: Tags,
    edges: ['default'],
    deferred: true,
  },
  move_stage: {
    kind: 'move_stage',
    label: 'Mover etapa',
    category: 'system',
    icon: GitBranch,
    edges: ['default'],
    deferred: true,
  },
};

export const NODE_KINDS = Object.keys(NODE_CATALOG) as FlowNodeKind[];

export const CATEGORY_LABEL: Record<NodeCategory, string> = {
  start: 'Inicio',
  output: 'Saida',
  timing: 'Tempo',
  logic: 'Logica',
  system: 'Sistema',
  external: 'Externo',
};
