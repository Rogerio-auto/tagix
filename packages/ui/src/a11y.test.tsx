import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from './Button/Button';
import { Input } from './Input/Input';
import { Modal } from './Modal/Modal';
import { ToastProvider, useToast } from './Toast/Toast';
import { HelpHint } from './HelpHint/HelpHint';
import { Badge, StatusPill } from './Badge/Badge';
import { Switch } from './Switch/Switch';
import { DataTable } from './DataTable/DataTable';
import { Card } from './Card/Card';
import { Avatar } from './Avatar/Avatar';

/**
 * Contratos de acessibilidade do @hm/ui (F10-S05). Cada teste trava uma garantia
 * de a11y para que regressões quebrem o CI, não a experiência do usuário.
 */

describe('Button — a11y', () => {
  it('expõe aria-busy e bloqueia clique quando loading (§2.7)', () => {
    let clicks = 0;
    render(
      <Button loading onClick={() => { clicks += 1; }}>
        Salvar
      </Button>,
    );
    const btn = screen.getByRole('button', { name: /salvar/i });
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(clicks).toBe(0);
  });
});

describe('Input — a11y', () => {
  it('associa label, marca aria-invalid e anuncia erro via role=alert', () => {
    render(<Input label="Nome" error="Nome muito curto" />);
    const input = screen.getByLabelText('Nome');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Nome muito curto');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(input).toHaveAttribute('aria-describedby', alert.id);
  });

  it('hint comum não vira alert', () => {
    render(<Input label="Apelido" hint="Aparece nas conversas" />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('Modal — a11y', () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          abrir
        </button>
        <Modal open={open} onClose={() => setOpen(false)} title="Confirmar">
          <button type="button">interno</button>
        </Modal>
      </>
    );
  }

  it('é dialog modal rotulado e fecha no Esc devolvendo o foco ao gatilho', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'abrir' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Confirmar');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe('Toast — a11y', () => {
  function Emit({ variant }: { variant: 'success' | 'error' }) {
    const { toast } = useToast();
    return (
      <button type="button" onClick={() => toast({ variant, title: 'Feito', duration: 0 })}>
        emitir
      </button>
    );
  }

  it('erro usa role=alert/assertive; sucesso usa status/polite', () => {
    const { unmount } = render(
      <ToastProvider>
        <Emit variant="error" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'emitir' }));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
    unmount();

    render(
      <ToastProvider>
        <Emit variant="success" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'emitir' }));
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });
});

describe('HelpHint — a11y', () => {
  it('gatilho é botão com aria-haspopup e abre dialog rotulado', () => {
    render(<HelpHint title="Como funciona" body={<p>texto de ajuda</p>} />);
    const trigger = screen.getByRole('button', { name: /ajuda: como funciona/i });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Como funciona');
  });
});

describe('Input — sucesso (DS 3.0)', () => {
  it('sucesso não vira alert, é descrito pelo campo e não depende só de cor (ícone)', () => {
    const { container } = render(<Input label="Domínio" success="Domínio verificado" />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('Domínio')).toHaveAccessibleDescription('Domínio verificado');
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('erro tem precedência sobre sucesso e hint', () => {
    render(<Input label="X" error="Ruim" success="Bom" hint="Dica" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Ruim');
    expect(screen.queryByText('Bom')).toBeNull();
  });
});

describe('Badge / Switch / DataTable — contratos de a11y', () => {
  it('StatusPill comunica por texto, não só por cor', () => {
    render(<StatusPill tone="warning">Revisão</StatusPill>);
    expect(screen.getByText('Revisão')).toBeVisible();
  });

  it('Badge live é decorativo para leitor de tela (ponto aria-hidden)', () => {
    const { container } = render(<Badge live>Ao vivo</Badge>);
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('Switch tem nome acessível e estado exposto', () => {
    render(<Switch label="Agente ativo" />);
    const sw = screen.getByRole('switch', { name: 'Agente ativo' });
    fireEvent.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  it('DataTable expõe região rotulada e focável (rolagem por teclado)', () => {
    render(
      <DataTable
        caption="Leads"
        columns={[{ id: 'n', header: 'Nome', cell: (r: { n: string }) => r.n }]}
        rows={[{ n: 'Ana' }]}
        getRowId={(r) => r.n}
        maxHeight="200px"
      />,
    );
    expect(screen.getByRole('group', { name: 'Leads' })).toHaveAttribute('tabindex', '0');
  });
});

describe('Card interativo / Avatar', () => {
  it('Card interactive ganha foco visível por teclado', () => {
    render(<Card interactive tabIndex={0} role="button" aria-label="Abrir" />);
    expect(screen.getByRole('button', { name: 'Abrir' })).toHaveClass('focus-visible:focus-ring');
  });

  it('Avatar com nome expõe role img rotulado; forma circle troca o raio', () => {
    render(<Avatar name="Ana Lima" shape="circle" />);
    expect(screen.getByRole('img', { name: 'Ana Lima' })).toHaveClass('rounded-pill');
  });
});
