'use client';

import { useState } from 'react';
import { Button, Input, Modal, useToast } from '@hm/ui';
import { useCreateTag, useDeleteTag, useTags, useUpdateTag, type Tag } from './queries';

/** Gestão de tags: criar/editar (nome + cor) e excluir com aviso de uso. */
export default function TagsManager(): React.JSX.Element {
  const { toast } = useToast();
  const tagsQuery = useTags();
  const create = useCreateTag();
  const update = useUpdateTag();
  const remove = useDeleteTag();

  const [name, setName] = useState('');
  const [color, setColor] = useState('#1FFF13');
  const [editing, setEditing] = useState<Tag | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('#1FFF13');
  const [deleteTarget, setDeleteTarget] = useState<Tag | null>(null);

  const tags = tagsQuery.data?.tags ?? [];

  const add = async () => {
    if (!name.trim()) return;
    try {
      await create.mutateAsync({ name: name.trim(), color });
      setName('');
      setColor('#1FFF13');
      toast({ variant: 'success', title: 'Tag criada.' });
    } catch (err) {
      toast({ variant: 'error', title: err instanceof Error ? err.message : 'Falha ao criar.' });
    }
  };

  const openEdit = (t: Tag) => {
    setEditing(t);
    setEditName(t.name);
    setEditColor(t.color);
  };

  const saveEdit = async () => {
    if (!editing) return;
    try {
      await update.mutateAsync({ id: editing.id, name: editName.trim(), color: editColor });
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

  if (tagsQuery.isLoading) return <p className="text-sm text-text-low">Carregando…</p>;

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          aria-label="Cor da tag"
          className="h-9 w-12 rounded border border-border bg-surface"
        />
        <div className="flex-1 min-w-40">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da tag" />
        </div>
        <Button variant="primary" disabled={!name.trim() || create.isPending} onClick={() => void add()}>
          Adicionar
        </Button>
      </div>

      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {tags.length === 0 && <li className="px-4 py-3 text-sm text-text-low">Nenhuma tag.</li>}
        {tags.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-4 px-4 py-3">
            <span className="inline-flex items-center gap-2">
              <span className="size-3 rounded-full" style={{ backgroundColor: t.color }} aria-hidden />
              <span className="text-sm text-text">{t.name}</span>
              <span className="text-xs text-text-low">
                {t.usageCount} contato{t.usageCount === 1 ? '' : 's'}
              </span>
            </span>
            <span className="flex items-center gap-3">
              <button type="button" onClick={() => openEdit(t)} className="text-xs text-text-low hover:text-text">
                Editar
              </button>
              <button
                type="button"
                onClick={() => setDeleteTarget(t)}
                className="text-xs text-text-low hover:text-danger"
              >
                Excluir
              </button>
            </span>
          </li>
        ))}
      </ul>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Editar tag"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button variant="primary" disabled={update.isPending} onClick={() => void saveEdit()}>
              Salvar
            </Button>
          </div>
        }
      >
        <div className="flex items-end gap-2">
          <input
            type="color"
            value={editColor}
            onChange={(e) => setEditColor(e.target.value)}
            aria-label="Cor da tag"
            className="h-9 w-12 rounded border border-border bg-surface"
          />
          <div className="flex-1">
            <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
          </div>
        </div>
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Excluir tag"
        description={
          deleteTarget && deleteTarget.usageCount > 0
            ? `Esta tag está em ${deleteTarget.usageCount} contato(s). Excluí-la remove a marcação deles.`
            : 'Esta tag não está em uso.'
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancelar
            </Button>
            <Button variant="primary" disabled={remove.isPending} onClick={() => void doDelete()}>
              Excluir
            </Button>
          </div>
        }
      >
        <p className="text-sm text-text-mid">Tem certeza?</p>
      </Modal>
    </div>
  );
}
