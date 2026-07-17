import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Drawer } from './Drawer';

describe('Drawer — overlay acessível (UX §2.3)', () => {
  it('não renderiza nada quando fechado', () => {
    render(
      <Drawer open={false} onClose={() => {}} title="Detalhe">
        conteúdo
      </Drawer>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renderiza como dialog modal rotulado pelo título', () => {
    render(
      <Drawer open onClose={() => {}} title="Detalhe do negócio">
        conteúdo
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Detalhe do negócio');
  });

  it('usa ariaLabel quando não há título visível', () => {
    render(
      <Drawer open onClose={() => {}} ariaLabel="Ações rápidas" showClose={false}>
        conteúdo
      </Drawer>,
    );
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Ações rápidas');
  });

  it('fecha ao pressionar Esc', () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose} title="X">
        conteúdo
      </Drawer>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('fecha ao clicar no backdrop quando dismissible', () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose} title="X">
        conteúdo
      </Drawer>,
    );
    const backdrop = document.querySelector('div[aria-hidden="true"]');
    expect(backdrop).not.toBeNull();
    fireEvent.mouseDown(backdrop as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('não fecha pelo backdrop quando não dismissible', () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose} dismissible={false} title="X">
        conteúdo
      </Drawer>,
    );
    const backdrop = document.querySelector('div[aria-hidden="true"]');
    fireEvent.mouseDown(backdrop as Element);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('move o foco para dentro do painel ao abrir (WCAG 2.4.3)', () => {
    render(
      <Drawer open onClose={() => {}} title="Detalhe">
        conteúdo
      </Drawer>,
    );
    const closeBtn = screen.getByRole('button', { name: 'Fechar' });
    expect(document.activeElement).toBe(closeBtn);
  });
});
