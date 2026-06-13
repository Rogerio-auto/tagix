'use client';

/**
 * Editor de um modelo (F25-S07): notes + default_plan_keys (planos que herdam o
 * modelo). Modal DS v2; salva via PATCH /api/platform/models/:id. §2.7 feedback.
 */
import { useState } from 'react';
import { Button, Input, Modal, useToast } from '@hm/ui';
import { ApiError } from '@/shared/lib/api-client';
import type { LlmModel } from '@/features/platform-admin/lib';
import { usePatchModel } from './queries';

export function ModelEditor({ model, onClose }: { model: LlmModel; onClose: () => void }) {
  const patch = usePatchModel();
  const { toast } = useToast();
  const [notes, setNotes] = useState(model.notes ?? '');
  const [planKeys, setPlanKeys] = useState(model.defaultPlanKeys.join(', '));

  const save = async () => {
    const defaultPlanKeys = planKeys
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      await patch.mutateAsync({
        id: model.id,
        patch: { notes: notes.trim() === '' ? null : notes.trim(), defaultPlanKeys },
      });
      toast({ variant: 'success', title: 'Modelo atualizado', description: model.slug });
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Tente novamente.';
      toast({ variant: 'error', title: 'Falha ao salvar', description: msg });
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Editar ${model.displayName}`}
      description={model.slug}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void save()} disabled={patch.isPending}>
            {patch.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-text">Notas</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={2000}
            className="rounded-md border border-border bg-surface-inset px-3 py-2 text-sm text-text outline-none focus-visible:border-border-brand"
            placeholder="Observações internas (ex.: bom custo-benefício, evitar para visão)."
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-text">Planos padrão</span>
          <Input
            value={planKeys}
            onChange={(e) => setPlanKeys(e.target.value)}
            placeholder="pro, enterprise"
          />
          <span className="text-xs text-text-low">
            Planos que herdam este modelo automaticamente (separe por vírgula).
          </span>
        </label>
      </div>
    </Modal>
  );
}
