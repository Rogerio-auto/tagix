/**
 * Catalogo dos 22 tipos de node do Flow Builder (FLOW_BUILDER.md secao 4.1). Fonte unica de
 * label/categoria/icon/edges para palette, registry e inspector. O `nodeTypes` registry
 * (canvas) e dono de S10; as pastas `nodes/<tipo>/` trazem a UI rica de cada node.
 *
 * F31-S08 (ESPINHA): adiciona register_conversion + 6 kinds novos
 * (set_variable/input/assign/template/ab_split/go_to_flow) como stubs; S09/S10/S11 preenchem.
 */
import {
  ArrowRightCircle,
  Bot,
  Clock,
  FileText,
  GitBranch,
  Globe,
  Keyboard,
  ListChecks,
  MessageSquare,
  MousePointerClick,
  Play,
  Send,
  Shuffle,
  Split,
  Tag,
  Tags,
  Target,
  ToggleLeft,
  UserPlus,
  Variable,
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
  | 'external_notify'
  | 'register_conversion'
  | 'set_variable'
  | 'input'
  | 'assign'
  | 'template'
  | 'ab_split'
  | 'go_to_flow';

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
  },
  remove_tag: {
    kind: 'remove_tag',
    label: 'Remover tag',
    category: 'system',
    icon: Tags,
    edges: ['default'],
  },
  move_stage: {
    kind: 'move_stage',
    label: 'Mover etapa',
    category: 'system',
    icon: GitBranch,
    edges: ['default'],
  },
  register_conversion: {
    kind: 'register_conversion',
    label: 'Registrar conversao',
    category: 'system',
    icon: Target,
    edges: ['default'],
  },
  set_variable: {
    kind: 'set_variable',
    label: 'Definir variavel',
    category: 'system',
    icon: Variable,
    edges: ['default'],
  },
  input: {
    kind: 'input',
    label: 'Capturar resposta',
    category: 'timing',
    icon: Keyboard,
    edges: ['response', 'timeout'],
  },
  assign: {
    kind: 'assign',
    label: 'Atribuir conversa',
    category: 'system',
    icon: UserPlus,
    edges: ['default'],
  },
  template: {
    kind: 'template',
    label: 'Template / HSM',
    category: 'output',
    icon: FileText,
    edges: ['default'],
  },
  ab_split: {
    kind: 'ab_split',
    label: 'Teste A/B',
    category: 'logic',
    icon: Shuffle,
    edges: ['a', 'b'],
  },
  go_to_flow: {
    kind: 'go_to_flow',
    label: 'Ir para flow',
    category: 'logic',
    icon: ArrowRightCircle,
    edges: ['default'],
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
