import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HelpHint, HelpPanel } from './HelpHint';

const content = { title: 'Como funciona', body: <p>Explicação completa.</p> };

/** O container do portal é o ancestral do diálogo que leva `inert`/`aria-hidden`. */
function portalRoot(): HTMLElement {
  const dialog = screen.getByRole('dialog', { hidden: true });
  const root = dialog.closest('.fixed.inset-0');
  if (!(root instanceof HTMLElement)) throw new Error('container do painel não encontrado');
  return root;
}

describe('HelpPanel — fechado fora do foco e da acessibilidade (F70-S32)', () => {
  it('fechado: segue montado para a transição, mas inert e aria-hidden', () => {
    render(<HelpPanel open={false} onClose={() => {}} {...content} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    const root = portalRoot();
    expect(root).toHaveAttribute('inert');
    expect(root).toHaveAttribute('aria-hidden', 'true');
  });

  it('aberto: diálogo acessível pelo título, sem inert nem aria-hidden', () => {
    render(<HelpPanel open onClose={() => {}} {...content} />);
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Como funciona');
    const root = portalRoot();
    expect(root).not.toHaveAttribute('inert');
    expect(root).not.toHaveAttribute('aria-hidden');
  });

  it('HelpHint: o gatilho abre o painel e o devolve à árvore de acessibilidade', () => {
    render(<HelpHint {...content} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ajuda: Como funciona' }));
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Como funciona');
  });
});
