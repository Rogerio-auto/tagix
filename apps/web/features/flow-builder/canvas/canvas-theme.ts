import type { CSSProperties } from 'react';
import type { AriaLabelConfig } from '@xyflow/react';

/**
 * Pele do React Flow no DS 3.0 (F72-S07). O `@xyflow/react/dist/style.css` pinta
 * aresta, handle, fundo, controles e minimapa com variáveis `--xy-*`; aqui cada uma
 * aponta para um token semântico de `@hm/design-tokens`. Como os tokens trocam com
 * `data-theme`, o canvas acompanha o tema sem nenhum hex e sem CSS global novo.
 *
 * Arestas em `text-low` (lidas como estrutura, não como dado); a selecionada e a linha
 * de conexão em andamento acendem em `brand-text` (a marca legível nos dois temas).
 */
export const CANVAS_THEME = {
  '--xy-background-color': 'var(--bg)',
  '--xy-background-pattern-color': 'var(--border-2)',

  '--xy-edge-stroke': 'var(--text-low)',
  '--xy-edge-stroke-width': '1.5',
  '--xy-edge-stroke-selected': 'var(--brand-text)',
  '--xy-connectionline-stroke': 'var(--brand-text)',
  '--xy-connectionline-stroke-width': '1.5',
  '--xy-edge-label-background-color': 'var(--surface-2)',
  '--xy-edge-label-color': 'var(--text-mid)',

  '--xy-handle-background-color': 'var(--surface)',
  '--xy-handle-border-color': 'var(--text-low)',

  '--xy-selection-background-color': 'color-mix(in srgb, var(--brand-text) 8%, transparent)',
  '--xy-selection-border': '1px dashed var(--brand-text)',

  '--xy-controls-button-background-color': 'var(--surface)',
  '--xy-controls-button-background-color-hover': 'var(--surface-2)',
  '--xy-controls-button-color': 'var(--text-mid)',
  '--xy-controls-button-color-hover': 'var(--text)',
  '--xy-controls-button-border-color': 'var(--border)',
  '--xy-controls-box-shadow': 'var(--shadow-1)',

  '--xy-minimap-background-color': 'var(--surface)',
  '--xy-minimap-mask-background-color': 'color-mix(in srgb, var(--bg) 72%, transparent)',
  '--xy-minimap-mask-stroke-color': 'var(--border-2)',
  '--xy-minimap-mask-stroke-width': '1',
  '--xy-minimap-node-background-color': 'var(--surface-3)',
  '--xy-minimap-node-stroke-color': 'var(--border-2)',
  '--xy-minimap-node-stroke-width': '1',

  '--xy-attribution-background-color': 'transparent',
} as CSSProperties;

/**
 * Rótulos acessíveis do React Flow em português (os padrões vêm em inglês). Lidos por
 * leitor de tela nos nós, arestas, controles e minimapa.
 */
export const CANVAS_ARIA_LABELS: Partial<AriaLabelConfig> = {
  'node.a11yDescription.default':
    'Enter ou Espaço seleciona o nó e abre o painel de edição. Esc limpa a seleção. Com o nó selecionado, as setas o movem.',
  'node.a11yDescription.keyboardDisabled':
    'Enter ou Espaço seleciona o nó e abre o painel de propriedades. Esc limpa a seleção.',
  'node.a11yDescription.ariaLiveMessage': ({ direction, x, y }) =>
    `Nó movido para ${direction === 'up' ? 'cima' : direction === 'down' ? 'baixo' : direction === 'left' ? 'a esquerda' : 'a direita'}. Posição ${Math.round(x)}, ${Math.round(y)}.`,
  'edge.a11yDescription.default': 'Conexão entre dois nós. Enter ou Espaço seleciona; Delete remove.',
  'controls.ariaLabel': 'Controles do canvas',
  'controls.zoomIn.ariaLabel': 'Aproximar',
  'controls.zoomOut.ariaLabel': 'Afastar',
  'controls.fitView.ariaLabel': 'Enquadrar o flow',
  'controls.interactive.ariaLabel': 'Travar ou destravar a edição',
  'minimap.ariaLabel': 'Minimapa do flow',
  'handle.ariaLabel': 'Ponto de conexão',
};
