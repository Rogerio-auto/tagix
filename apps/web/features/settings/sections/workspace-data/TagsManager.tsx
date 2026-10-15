'use client';

import { useState } from 'react';
import { Pencil, Plus, Tag as TagIcon, Trash2 } from 'lucide-react';
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  useToast,
  type DataTableColumn,
} from '@hm/ui';
import { ReadOnlyGuard, useIsReadOnly } from '@/shared/components/account-banner';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { cn } from '@/shared/lib/cn';
import { formatNumber } from '@/shared/lib/locale';
import { ColorSwatchInput } from '../../lib/ColorField';
import { isHexColor } from '../../lib/token-color';
import { SectionLoading } from '../personal/components';
import { useCreateTag, useDeleteTag, useTags, useUpdateTag, type Tag } from './queries';

/**
 * Pastilha da cor da tag. A cor é DADO do cliente (`#RRGGBB` validado pela API), não estilo
 * do DS — e só vira `style` se passar no formato aqui também (nada arbitrário chega ao CSS);
 * fora do formato, a pastilha cai no token neutro.
 */
function Swatch({ color }: { color: string }): React.JSX.Element {
  const valid = isHexColor(color);
  return (
    <span
      aria-hidden
      className={cn(
        'size-3 shrink-0 rounded-pill ring-1 ring-border-2 ring-offset-1 ring-offset-surface',
        !valid && 'bg-text-low',
      )}
      style={valid ? { backgroundColor: color } : undefined}
    />
  );
}

function usage(count: number): React.JSX.Element {
  return (
    <span className="whitespace-nowrap text-text-mid">
      <span className="font-mono tabular-nums">{formatNumber(count)}</span> {count === 1 ? 'contato' : 'contatos'}
    </span>
  );
}

/**
 * Gestão de tags (F8-S08) no DS 3.0 (F72-S07): criar (nome + cor), editar e excluir com
 * aviso de uso. Desktop em `DataTable` (uso em mono à direita), celular em cards.
 *
 * Cor: a cor escolhida é dado do cliente e segue como `style` na pastilha. A cor INICIAL do
 * seletor vem do token `--brand` (sem hex no componente); se ninguém escolher, a cor não é
 * enviada e o servidor aplica o padrão.
 *
 * Só leitura (F71-S17): adicionar, editar e excluir ficam `aria-disabled` com a explicação.
 * UX: §2.6 vazio com o que fazer; §2.7 botões em loading; §2.9 excluir pede confirmação e
 * diz quantos contatos perdem a marcação.
 */
export default function TagsManager(): React.JSX.Element {
  const { toast } = useToast();
  const { isMobile } = useBreakpoint();
  const tagsQuery = useTags();
  const create = useCreateTag();
  const update = useUpdateTag();
  const remove = useDeleteTag();
  // Só leitura: o botão fica focável (aria-disabled + explicação) mesmo sem alterações;
  // `disabled` tiraria o botão do Tab e a explicação nunca seria encontrada.
  const readOnly = useIsReadOnly();

  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  const [editing, setEditing] = useState<Tag | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Tag | null>(null);

  const tags = tagsQuery.data?.tags ?? [];

  const add = async () => {
    if (!name.trim()) return;
    try {
      await create.mutateAsync({ name: name.trim(), ...(color ? { color } : {}) });
      setName('');
      setColor('');
      toast({ variant: 'success', title: 'Tag criada.' });
    } catch (err) {
      toast({ variant: 'error', title: err instanceof Error ? err.message : 'Falha ao criar.' });
    }
  };

  const openEdit = (t: Tag) => {
    setEditing(t);
    setEditName(t.name);
    setEditColor(isHexColor(t.color) ? t.color : '');
  };

  const saveEdit = async () => {
    if (!editing) return;
    try {
      await update.mutateAsync({ id: editing.id, name: editName.trim(), ...(editColor ? { color: editColor } : {}) });
      setEditing(null);
      toast({ variant: 'success', title: 'Tag atualizada.' });
    } catch (err) {
      toast({ variant: 'error', title: err instanceof Error ? err.message : 'Falha ao salvar.' });
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    try {
      await remove.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
      toast({ variant: 'success', title: 'Tag excluída.' });
    } catch (err) {
      toast({ variant: 'error', title: err instanceof Error ? err.message : 'Falha ao excluir.' });
    }
  };

  if (tagsQuery.isLoading) return <SectionLoading label="Carregando tags" />;

  const actions = (t: Tag) => (
    <div className="flex items-center justify-end gap-1">
      <ReadOnlyGuard>
        <Button
          variant="ghost"
          size="sm"
          className="max-md:h-11"
          leftIcon={<Pencil className="size-3.5" aria-hidden />}
          aria-label={`Editar tag ${t.name}`}
          onClick={() => openEdit(t)}
        >
          Editar
        </Button>
      </ReadOnlyGuard>
      <ReadOnlyGuard>
        <Button
          variant="ghost"
          size="sm"
          className="hover:text-danger max-md:h-11"
          leftIcon={<Trash2 className="size-3.5 text-danger" aria-hidden />}
          aria-label={`Excluir tag ${t.name}`}
          onClick={() => setDeleteTarget(t)}
        >
          Excluir
        </Button>
      </ReadOnlyGuard>
    </div>
  );

  const nameCell = (t: Tag) => (
    <span className="flex min-w-0 items-center gap-2.5">
      <Swatch color={t.color} />
      <span className="truncate font-semibold text-text">{t.name}</span>
    </span>
  );

  const columns: DataTableColumn<Tag>[] = [
    { id: 'name', header: 'Tag', cell: nameCell },
    { id: 'color', header: 'Cor', width: '7rem', cell: (t) => <span className="font-mono text-sm uppercase text-text-low">{t.color}</span> },
    { id: 'usage', header: 'Em uso', numeric: true, width: '9rem', cell: (t) => usage(t.usageCount) },
    {
      id: 'actions',
      header: <span className="sr-only">Ações</span>,
      headerLabel: 'Ações',
      align: 'right',
      width: '12rem',
      cell: actions,
    },
  ];

  const empty = (
    <EmptyState
      className="py-8"
      icon={TagIcon}
      title="Nenhuma tag ainda"
      description="Crie tags para marcar e segmentar contatos (ex.: VIP, Retorno, Orçamento)."
    />
  );
  const error = (
    <ErrorState
      title="Não foi possível carregar as tags"
      reason="A lista não respondeu."
      whatToDo="Tente de novo em instantes."
      action={
        <Button variant="secondary" loading={tagsQuery.isFetching} onClick={() => void tagsQuery.refetch()}>
          Tentar de novo
        </Button>
      }
    />
  );

  return (
    <div className="flex flex-col gap-5">
      <form
        aria-label="Nova tag"
        className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-5 py-4 sm:flex-row sm:items-start"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <div className="flex flex-1 items-start gap-2">
          <ColorSwatchInput value={color} onChange={setColor} label="Cor da nova tag" />
          <div className="min-w-0 flex-1">
            <Input aria-label="Nome da tag" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da tag" />
          </div>
        </div>
        <ReadOnlyGuard>
          <Button
            type="submit"
            variant="secondary"
            leftIcon={<Plus className="size-4" aria-hidden />}
            disabled={!readOnly && !name.trim()}
            loading={create.isPending}
          >
            Adicionar
          </Button>
        </ReadOnlyGuard>
      </form>

      {isMobile ? (
        tagsQuery.isError ? (
          error
        ) : tags.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border-2">{empty}</div>
        ) : (
          <ul aria-label="Tags" className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
            {tags.map((t) => (
              <li key={t.id} className="flex flex-col gap-2 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  {nameCell(t)}
                  <span className="text-sm">{usage(t.usageCount)}</span>
                </div>
                <div className="-ml-3">{actions(t)}</div>
              </li>
            ))}
          </ul>
        )
      ) : (
        <DataTable<Tag>
          caption="Tags"
          columns={columns}
          rows={tags}
          getRowId={(t) => t.id}
          density="compact"
          error={tagsQuery.isError ? error : undefined}
          empty={empty}
        />
      )}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Editar tag"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <ReadOnlyGuard>
              <Button variant="primary" disabled={!editName.trim()} loading={update.isPending} onClick={() => void saveEdit()}>
                Salvar tag
              </Button>
            </ReadOnlyGuard>
          </div>
        }
      >
        <div className="flex items-start gap-2">
          <ColorSwatchInput value={editColor} onChange={setEditColor} label="Cor da tag" />
          <div className="flex-1">
            <Input aria-label="Nome da tag" value={editName} onChange={(e) => setEditName(e.target.value)} />
          </div>
        </div>
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Excluir tag"
        description={
          deleteTarget && deleteTarget.usageCount > 0
            ? `Esta tag está em ${formatNumber(deleteTarget.usageCount)} ${deleteTarget.usageCount === 1 ? 'contato' : 'contatos'}. Excluí-la remove a marcação deles.`
            : 'Esta tag não está em uso.'
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancelar
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => void doDelete()}>
              Excluir tag
            </Button>
          </div>
        }
      />
    </div>
  );
}
