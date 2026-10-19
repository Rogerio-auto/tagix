import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RigInline40 } from './rig-inline-40';
import { RigMd48 } from './rig-md-48';
import { RIG } from './rig';
import type { RigLod } from './rig';

// O esbuild do vitest compila JSX no runtime clássico (tsconfig `jsx: preserve`; mesmo
// contorno de features/auth/components/auth-screens.test.tsx).
Object.assign(globalThis, { React });

const ART: Record<RigLod, typeof RigMd48> = { 'md-48': RigMd48, 'inline-40': RigInline40 };
const LAYERS = [
  'shadow',
  'fig',
  'halo',
  'body',
  'head',
  'visor',
  'eyes',
  'eyes-open',
  'eyes-closed',
  'eyes-happy',
  'eyes-squint',
  'antenna',
  'antenna-tip',
  'arm-l',
  'arm-r',
  'hand-r',
];
const HEX = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;

describe('arte do companheiro', () => {
  it.each(Object.keys(ART) as RigLod[])(
    '%s tem todas as camadas do contrato, uma vez cada',
    (lod) => {
      const html = renderToStaticMarkup(createElement(ART[lod]));
      for (const layer of LAYERS) {
        expect(html.split(`data-layer="${layer}"`).length - 1, layer).toBe(1);
      }
      expect(html).toContain('aria-hidden="true"');
      expect(html).not.toMatch(HEX);
    },
  );

  it('aplica a pose do rig.json em estilo inline e respeita o pivô', () => {
    const html = renderToStaticMarkup(createElement(RigMd48, { pose: 'avert' }));
    expect(html).toContain('data-eyes="closed"');
    expect(html).toContain('data-look="right"');
    expect(html).toContain('transform-origin:24px 30.5px;transform:translateX(1.5px) rotate(8deg)');
  });

  it('props explícitas vencem a pose', () => {
    const html = renderToStaticMarkup(createElement(RigInline40, { pose: 'confused', tip: 'off' }));
    expect(html).toContain('data-eyes="squint"');
    expect(html).toContain('data-tip="off"');
  });

  it('o 40 não tem poses de voo (não voa)', () => {
    for (const p of ['anticipate', 'stretch', 'apex', 'squash'] as const) {
      expect(RIG['inline-40'].poses[p]).toBeUndefined();
      expect(RIG['md-48'].poses[p]).toBeDefined();
    }
  });

  it('nenhum hex nos arquivos do módulo (CSS e TSX)', () => {
    const dir = join(__dirname);
    for (const f of readdirSync(dir).filter((n) => /\.(css|tsx)$/.test(n))) {
      expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(HEX);
    }
  });

  it('o contrato não tem onde receber valor de campo', () => {
    const src = readFileSync(join(__dirname, '..', 'contract.ts'), 'utf8');
    expect(src).not.toMatch(/\b(value|password|key|text)\s*[?:]/);
  });
});
