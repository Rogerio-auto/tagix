import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { DataTable, type DataTableColumn } from './DataTable';

interface Lead {
  id: string;
  name: string;
  value: number | null;
}

const rows: Lead[] = [
  { id: 'a', name: 'Maria Santos', value: 18400 },
  { id: 'b', name: 'John Lewis', value: 12800 },
  { id: 'c', name: 'Robert Brown', value: null },
];

const columns: DataTableColumn<Lead>[] = [
  { id: 'name', header: 'Contato', cell: (r) => r.name, sortable: true },
  {
    id: 'value',
    header: 'Valor',
    numeric: true,
    cell: (r) => (r.value === null ? '—' : String(r.value)),
    sortable: true,
  },
];

const getId = (r: Lead): string => r.id;

describe('DataTable — contrato', () => {
  it('é uma região rolável focável com tabela rotulada e cabeçalhos de coluna', () => {
    render(<DataTable caption="Leads" columns={columns} rows={rows} getRowId={getId} maxHeight="200px" />);
    const region = screen.getByRole('group', { name: 'Leads' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('table', { name: 'Leads' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(2);
    expect(screen.getAllByRole('row')).toHaveLength(4);
  });

  it('coluna numérica: mono, tabular e à direita (cabeçalho e célula)', () => {
    render(<DataTable caption="Leads" columns={columns} rows={rows} getRowId={getId} />);
    const cell = screen.getByText('18400');
    expect(cell).toHaveClass('font-price', 'tabular-nums', 'text-right');
    expect(screen.getByRole('columnheader', { name: /valor/i })).toHaveClass('text-right');
  });

  it('cabeçalho fica fixo (sticky) e densidade altera o padding', () => {
    const { rerender } = render(
      <DataTable caption="Leads" columns={columns} rows={rows} getRowId={getId} density="compact" />,
    );
    const th = screen.getByRole('columnheader', { name: /contato/i });
    expect(th).toHaveClass('sticky', 'top-0', 'py-2');
    rerender(
      <DataTable caption="Leads" columns={columns} rows={rows} getRowId={getId} density="comfortable" />,
    );
    expect(screen.getByRole('columnheader', { name: /contato/i })).toHaveClass('py-3.5');
  });

  it('loading: skeleton no formato da tabela, aria-busy e anúncio de status', () => {
    render(
      <DataTable caption="Leads" columns={columns} rows={[]} getRowId={getId} loading loadingRows={3} />,
    );
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getAllByRole('row')).toHaveLength(4);
    expect(screen.getByRole('status')).toHaveTextContent('Carregando Leads');
  });

  it('vazio e erro ocupam a tabela inteira; erro vence o vazio', () => {
    const { rerender } = render(
      <DataTable caption="Leads" columns={columns} rows={[]} getRowId={getId} empty={<p>Nada aqui</p>} />,
    );
    expect(screen.getByText('Nada aqui').closest('td')).toHaveAttribute('colspan', '2');
    rerender(
      <DataTable
        caption="Leads"
        columns={columns}
        rows={[]}
        getRowId={getId}
        empty={<p>Nada aqui</p>}
        error={<p>Falhou</p>}
      />,
    );
    expect(screen.queryByText('Nada aqui')).toBeNull();
    expect(screen.getByText('Falhou')).toBeInTheDocument();
  });

  it('clique na linha é a ação primária; Enter e Espaço também', () => {
    const onRowClick = vi.fn();
    render(
      <DataTable
        caption="Leads"
        columns={columns}
        rows={rows}
        getRowId={getId}
        onRowClick={onRowClick}
        getRowLabel={(r) => `Abrir ${r.name}`}
      />,
    );
    const row = screen.getByRole('row', { name: 'Abrir Maria Santos' });
    expect(row).toHaveAttribute('tabindex', '0');
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: ' ' });
    expect(onRowClick).toHaveBeenCalledTimes(3);
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });

  it('setas movem o foco entre linhas', () => {
    render(
      <DataTable
        caption="Leads"
        columns={columns}
        rows={rows}
        getRowId={getId}
        onRowClick={() => undefined}
        getRowLabel={(r) => r.name}
      />,
    );
    const first = screen.getByRole('row', { name: 'Maria Santos' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('row', { name: 'John Lewis' }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(first);
  });

  it('tecla dentro de controle interno da linha não dispara a ação da linha', () => {
    const onRowClick = vi.fn();
    const first = rows[0] as Lead;
    render(
      <DataTable
        caption="Leads"
        columns={[{ id: 'x', header: 'Ação', cell: () => <button type="button">Mais</button> }]}
        rows={[first]}
        getRowId={getId}
        onRowClick={onRowClick}
      />,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'Mais' }), { key: 'Enter' });
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('estado de linha: selected marca aria-current; attention e muted viram data-state', () => {
    render(
      <DataTable
        caption="Leads"
        columns={columns}
        rows={rows}
        getRowId={getId}
        getRowState={(r) => (r.id === 'a' ? 'selected' : r.id === 'b' ? 'attention' : 'muted')}
      />,
    );
    const body = screen.getAllByRole('row').slice(1);
    expect(body[0]).toHaveAttribute('aria-current', 'true');
    expect(body[1]).toHaveAttribute('data-state', 'attention');
    expect(body[2]).toHaveAttribute('data-state', 'muted');
  });

  it('ordenação: aria-sort acompanha o estado e o botão cicla asc, desc, nenhum', () => {
    const onSortChange = vi.fn();
    const props = { caption: 'Leads', columns, rows, getRowId: getId, onSortChange };
    const th = () => screen.getByRole('columnheader', { name: /valor/i });
    const { rerender } = render(<DataTable {...props} sort={null} />);
    expect(th()).toHaveAttribute('aria-sort', 'none');
    fireEvent.click(within(th()).getByRole('button'));
    expect(onSortChange).toHaveBeenLastCalledWith({ columnId: 'value', direction: 'asc' });
    rerender(<DataTable {...props} sort={{ columnId: 'value', direction: 'asc' }} />);
    expect(th()).toHaveAttribute('aria-sort', 'ascending');
    fireEvent.click(within(th()).getByRole('button'));
    expect(onSortChange).toHaveBeenLastCalledWith({ columnId: 'value', direction: 'desc' });
    rerender(<DataTable {...props} sort={{ columnId: 'value', direction: 'desc' }} />);
    expect(th()).toHaveAttribute('aria-sort', 'descending');
    fireEvent.click(within(th()).getByRole('button'));
    expect(onSortChange).toHaveBeenLastCalledWith(null);
  });
});
