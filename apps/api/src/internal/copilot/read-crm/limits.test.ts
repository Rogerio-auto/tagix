/**
 * F73-S06 · limites do `model_view`: 24 KB em bytes UTF-8, corte por prefixo e aviso.
 */
import { describe, expect, it } from 'vitest';
import {
  clampLimit,
  fitModelView,
  MODEL_VIEW_MAX_BYTES,
  modelViewBytes,
  READ_MAX_ROWS,
} from './limits';

describe('limites das consultas', () => {
  it('constantes do contrato: 50 linhas e 24 KB', () => {
    expect(READ_MAX_ROWS).toBe(50);
    expect(MODEL_VIEW_MAX_BYTES).toBe(24_576);
  });

  it('cabendo tudo, não corta nada', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: i, name: `n${i}` }));
    const fitted = fitModelView(rows, (shown, omitted) => ({ rows: shown, omitted }));
    expect(fitted.shown).toBe(10);
    expect(fitted.omitted).toBe(0);
    expect(fitted.view).toEqual({ rows, omitted: 0 });
  });

  it('acima de 24 KB corta linhas do fim, avisa e o resultado cabe', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ id: i, text: 'x'.repeat(1000) }));
    const fitted = fitModelView(rows, (shown, omitted) => ({
      truncated: omitted > 0,
      omitted,
      rows: shown,
    }));
    expect(fitted.omitted).toBeGreaterThan(0);
    expect(fitted.shown + fitted.omitted).toBe(50);
    expect(fitted.view['truncated']).toBe(true);
    expect(modelViewBytes(fitted.view)).toBeLessThanOrEqual(MODEL_VIEW_MAX_BYTES);
    // É o maior prefixo possível: uma linha a mais estouraria.
    const next = fitModelView(
      rows,
      (shown, omitted) => ({ truncated: omitted > 0, omitted, rows: shown }),
      Infinity,
    );
    expect(next.shown).toBe(50);
    const oneMore = {
      truncated: true,
      omitted: 50 - fitted.shown - 1,
      rows: rows.slice(0, fitted.shown + 1),
    };
    expect(modelViewBytes(oneMore)).toBeGreaterThan(MODEL_VIEW_MAX_BYTES);
  });

  it('mede bytes UTF-8, não caracteres', () => {
    const rows = Array.from({ length: 40 }, () => ({ t: 'ç'.repeat(400) }));
    const fitted = fitModelView(rows, (shown) => ({ rows: shown }));
    expect(modelViewBytes(fitted.view)).toBeLessThanOrEqual(MODEL_VIEW_MAX_BYTES);
    expect(fitted.omitted).toBeGreaterThan(0);
  });

  it('clampLimit respeita o teto e o padrão', () => {
    expect(clampLimit(undefined, 25)).toBe(25);
    expect(clampLimit(500, 25)).toBe(50);
    expect(clampLimit(0, 25)).toBe(1);
    expect(clampLimit(30, 25, 20)).toBe(20);
  });
});
