'use client';

import type { ReactNode } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { CATEGORY_LABEL, NODE_CATALOG, type FlowNodeKind } from '../shared/node-catalog';

/**
 * Nós do canvas no DS 3.0 (F72-S07). Um único casco (`NodeShell`) para os 22 tipos:
 * superfície silenciosa, hairline, título em head, categoria em mono caixa-alta e portas
 * de saída rotuladas. A marca (`brand-text`) só aparece no gatilho (o ponto de entrada)
 * e na seleção; o resto é neutro, para o grafo ler como estrutura e não como enfeite.
 *
 * Cores 100% de token: handles, bordas e foco vêm de classes do tema ou das variáveis
 * `--xy-*` que o `FlowCanvas` liga aos tokens (nenhum hex aqui).
 *
 * Foco por teclado: o React Flow foca o invólucro `.react-flow__node` (que recebe a
 * classe `group/node` no `FlowCanvas`); o casco pinta o anel com `group-focus-visible/node`.
 */

/** Rótulo legível de cada saída (o id da porta continua o contrato do motor). */
const PORT_LABEL: Readonly<Record<string, string>> = {
  default: 'padrão',
  true: 'sim',
  false: 'não',
  success: 'sucesso',
  error: 'erro',
  response: 'resposta',
  timeout: 'sem resposta',
  a: 'A',
  b: 'B',
};

export type PortTone = 'neutral' | 'success' | 'danger' | 'brand';

const PORT_TONE: Readonly<Record<string, PortTone>> = {
  success: 'success',
  error: 'danger',
};

const portToneClass: Record<PortTone, string> = {
  neutral: 'text-text-mid',
  success: 'text-success',
  danger: 'text-danger',
  brand: 'text-brand-text',
};

export interface NodePort {
  /** `sourceHandle` da aresta (contrato do motor). */
  id: string;
  /** Texto exibido; padrão: tradução de `PORT_LABEL` ou o próprio id. */
  label?: string;
  tone?: PortTone;
}

/** Classes do handle: anel em `text-low` sobre a superfície; acende na marca ao mirar. */
const HANDLE_CLASS = cn(
  '!size-2.5 !border-[1.5px] !border-text-low !bg-surface',
  'transition-colors duration-(--dur-fast) ease-ds hover:!border-brand-text hover:!bg-brand-text motion-reduce:transition-none',
);

/** Texto da porta para a interface (`true` → "sim"). */
export function portLabel(id: string): string {
  return PORT_LABEL[id] ?? id;
}

/** Linha de portas de saída rotuladas, distribuídas na base do nó. */
export function OutputPorts({ ports }: { ports: readonly NodePort[] }) {
  if (ports.length <= 1) {
    return <Handle type="source" position={Position.Bottom} className={HANDLE_CLASS} />;
  }
  return (
    <div className="mt-3 flex justify-between gap-1 border-t border-border pt-2">
      {ports.map((port, i) => (
        <div key={port.id} className="relative min-w-0 flex-1 text-center">
          <span
            className={cn(
              'block truncate font-mono text-[11px] leading-4',
              portToneClass[port.tone ?? PORT_TONE[port.id] ?? 'neutral'],
            )}
          >
            {port.label ?? portLabel(port.id)}
          </span>
          <Handle
            type="source"
            id={port.id}
            position={Position.Bottom}
            // Posição horizontal calculada: o único estilo inline (geometria, não cor).
            style={{ left: `${((i + 0.5) / ports.length) * 100}%` }}
            className={HANDLE_CLASS}
          />
        </div>
      ))}
    </div>
  );
}

export interface NodeShellProps {
  kind: FlowNodeKind;
  selected?: boolean;
  /** Título no lugar do rótulo do catálogo (ex.: tipo de gatilho escolhido). */
  title?: string;
  /** Sobrescreve a linha de categoria (ex.: "Gatilho"). */
  eyebrow?: string;
  /** Saídas; padrão: as do catálogo. */
  ports?: readonly NodePort[];
  /** Sem porta de entrada (o gatilho é o início do grafo). */
  noTarget?: boolean;
  className?: string;
  children?: ReactNode;
}

/** Casco comum de todo nó do canvas. */
export function NodeShell({
  kind,
  selected = false,
  title,
  eyebrow,
  ports,
  noTarget = false,
  className,
  children,
}: NodeShellProps) {
  const meta = NODE_CATALOG[kind];
  const Icon = meta.icon;
  const isStart = meta.category === 'start';
  const outputs = ports ?? meta.edges.map((id) => ({ id }));

  return (
    <div
      className={cn(
        'relative w-[224px] rounded-md border bg-surface px-3 py-2.5 shadow-ds-1',
        'transition-[border-color,box-shadow] duration-(--dur-fast) ease-ds motion-reduce:transition-none',
        selected ? 'border-brand-text/70 shadow-glow-sm' : 'border-border hover:border-border-2',
        'group-focus-visible/node:focus-ring',
        className,
      )}
    >
      {!noTarget && <Handle type="target" position={Position.Top} className={HANDLE_CLASS} />}

      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-xs border',
            isStart
              ? 'border-brand-text/25 bg-brand-text/10 text-brand-text'
              : 'border-border bg-surface-2 text-text-mid',
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate font-mono text-[11px] uppercase leading-4 tracking-[0.08em] text-text-low">
            {eyebrow ?? CATEGORY_LABEL[meta.category]}
          </p>
          <p className="truncate font-head text-sm font-semibold leading-5 text-text">{title ?? meta.label}</p>
        </div>
      </div>

      {meta.deferred && (
        <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-warn">
          <AlertTriangle className="size-3" aria-hidden />
          Ainda não executa
        </p>
      )}

      {children}

      <OutputPorts ports={outputs} />
    </div>
  );
}

/** Nó sem corpo próprio: só o casco com o rótulo e as saídas do catálogo. */
export function BaseNode({ kind, selected }: { kind: FlowNodeKind; selected?: boolean }) {
  return <NodeShell kind={kind} selected={selected} />;
}

/** Cria o componente de node ligado a um kind (consumido pelo nodeTypes registry). */
export function makeNodeComponent(kind: FlowNodeKind) {
  function NodeComponent(props: NodeProps) {
    return <BaseNode kind={kind} selected={props.selected} />;
  }
  NodeComponent.displayName = `FlowNode_${kind}`;
  return NodeComponent;
}
