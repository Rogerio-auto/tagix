/**
 * F72-S07 (absorve F71-S17) — primitiva de botão de escrita em empresa só leitura.
 * Ambiente `node`: o markup vem de `react-dom/server`; o bloqueio do clique é provado
 * pela função pura `readOnlyActionProps` (a mesma que o `ReadOnlyGuard` aplica).
 */
import * as React from 'react';
import type { MouseEvent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

Reflect.set(globalThis, 'React', React);

const state = { readOnly: false };
vi.mock('./useIsReadOnly', () => ({
  useIsReadOnly: () => state.readOnly,
  READ_ONLY_TOOLTIP: 'Modo só leitura: escolha um plano para voltar a editar.',
}));

const { ReadOnlyGuard, readOnlyActionProps } = await import('./ReadOnlyGuard');
const { READ_ONLY_TOOLTIP } = await import('./useIsReadOnly');

function fakeClick(): { event: MouseEvent<HTMLElement>; prevented: () => boolean } {
  let prevented = false;
  const event = {
    preventDefault: () => {
      prevented = true;
    },
    stopPropagation: () => undefined,
  } as unknown as MouseEvent<HTMLElement>;
  return { event, prevented: () => prevented };
}

describe('readOnlyActionProps', () => {
  it('só leitura: aria-disabled, descrição e clique bloqueado', () => {
    const onClick = vi.fn();
    const props = readOnlyActionProps({ readOnly: true, descriptionId: 'ro-1', onClick });
    expect(props['aria-disabled']).toBe(true);
    expect(props['aria-describedby']).toBe('ro-1');
    const { event, prevented } = fakeClick();
    props.onClick(event);
    expect(onClick).not.toHaveBeenCalled();
    expect(prevented()).toBe(true);
  });

  it('só leitura preserva a descrição que o botão já tinha', () => {
    const props = readOnlyActionProps({ readOnly: true, descriptionId: 'ro-1', describedBy: 'hint' });
    expect(props['aria-describedby']).toBe('hint ro-1');
  });

  it('empresa ativa: sem aria-disabled e o clique passa', () => {
    const onClick = vi.fn();
    const props = readOnlyActionProps({ readOnly: false, descriptionId: 'ro-1', onClick });
    expect(props['aria-disabled']).toBeUndefined();
    expect(props['aria-describedby']).toBeUndefined();
    const { event, prevented } = fakeClick();
    props.onClick(event);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(prevented()).toBe(false);
  });
});

describe('<ReadOnlyGuard>', () => {
  const button = (
    <button type="button" className="btn" onClick={() => undefined}>
      Novo contato
    </button>
  );

  it('só leitura (hook): botão focável com aria-disabled e descrição real ligada', () => {
    state.readOnly = true;
    const html = renderToStaticMarkup(<ReadOnlyGuard>{button}</ReadOnlyGuard>);
    expect(html).toContain('aria-disabled="true"');
    // Continua focável: nada de `disabled` nem tabindex negativo.
    expect(html).not.toMatch(/\sdisabled(=|\s|>)/);
    expect(html).not.toContain('tabindex="-1"');
    const describedBy = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(describedBy).toBeTruthy();
    expect(html).toContain(`id="${describedBy}"`);
    expect(html).toContain('role="tooltip"');
    expect(html).toContain(READ_ONLY_TOOLTIP);
    // Visível ao hover e ao foco (não só para leitor de tela).
    expect(html).toContain('group-hover/ro:opacity-100');
    expect(html).toContain('group-focus-within/ro:opacity-100');
    // A classe original do botão é preservada, somada ao estilo de indisponível.
    expect(html).toMatch(/class="btn [^"]*aria-disabled:opacity-50/);
  });

  it('empresa ativa: devolve o botão intacto', () => {
    state.readOnly = false;
    const html = renderToStaticMarkup(<ReadOnlyGuard>{button}</ReadOnlyGuard>);
    expect(html).toBe('<button type="button" class="btn">Novo contato</button>');
  });

  it('a prop `readOnly` vence o hook', () => {
    state.readOnly = false;
    expect(renderToStaticMarkup(<ReadOnlyGuard readOnly>{button}</ReadOnlyGuard>)).toContain(
      'aria-disabled="true"',
    );
    state.readOnly = true;
    expect(
      renderToStaticMarkup(<ReadOnlyGuard readOnly={false}>{button}</ReadOnlyGuard>),
    ).not.toContain('aria-disabled');
  });
});
