'use client';

/**
 * Editor de um modelo (F25-S07): notes + default_plan_keys (planos que herdam o
 * modelo). Modal (formulário curto, UX §2.3); salva via PATCH /api/platform/models/:id.
 * DS 3.0 (F72-S08): campos no desenho do `Input`, botão em carregando (UX §2.7).
 */
import { useId, useState } from 'react';
import { Button, Input, Modal, useToast } from '@hm/ui';
import { ApiError } from '@/shared/lib/api-client';
import type { LlmModel } from '@/features/platform-admin/lib';
import { textareaClass } from '../ui/kit';
import { usePatchModel } from './queries';

export function ModelEditor({ model, onClose }: { model: LlmModel; onClose: () => void }) {
  const patch = usePatchModel();
  const { toast } = useToast();
  const notesId = useId();
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
      description={<span className="font-mono">{model.slug}</span>}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={patch.isPending}>
            {patch.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={notesId} className="font-body text-sm font-bold text-text-mid">
            Notas
          </label>
          <textarea
            id={notesId}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={2000}
            className={textareaClass}
            placeholder="Observações internas (ex.: bom custo-benefício, evitar para visão)."
          />
        </div>
        <Input
          label="Planos padrão"
          value={planKeys}
          onChange={(e) => setPlanKeys(e.target.value)}
          placeholder="pro, enterprise"
          hint="Planos que herdam este modelo automaticamente (separe por vírgula)."
          className="font-mono"
        />
      </div>
    </Modal>
  );
}
