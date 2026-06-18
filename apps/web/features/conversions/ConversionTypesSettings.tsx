'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { AnchoredHelpHint, Button, Card, CardBody, Input, useToast } from '@hm/ui';
import { useConversionTypes, useCreateConversionType, useDeleteConversionType } from './queries';

function slugify(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

/**
 * Settings de tipos de conversão (F5-S13, /settings/conversions): CRUD de
 * conversion_types. Gatilhos por stage/tag são editados nas automações de stage
 * (F5-S09) e em conversion_tag_triggers — aqui focamos no catálogo de tipos.
 */
export function ConversionTypesSettings(): React.JSX.Element {
  const { toast } = useToast();
  const typesQuery = useConversionTypes();
  const create = useCreateConversionType();
  const remove = useDeleteConversionType();

  const [label, setLabel] = useState('');
  const [valueRequired, setValueRequired] = useState(false);

  function add(): void {
    const trimmed = label.trim();
    if (!trimmed) return;
    create.mutate(
      { key: slugify(trimmed) || `tipo_${Date.now()}`, label: trimmed, valueRequired },
      {
        onSuccess: () => {
          setLabel('');
          setValueRequired(false);
        },
        onError: (e) => toast({ variant: 'error', title: e.message }),
      },
    );
  }

  const types = (typesQuery.data?.conversionTypes ?? []).filter((t) => t.isActive);

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold text-text">Tipos de conversão</h1>
        <AnchoredHelpHint anchorKey="conversions.types" />
      </div>

      <Card elevation={1}>
        <CardBody className="flex flex-col gap-3">
          {types.length === 0 ? (
            <p className="text-sm text-text-low">Nenhum tipo de conversão ainda.</p>
          ) : (
            types.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3">
                <div className="flex flex-col">
                  <span className="text-sm text-text">{t.label}</span>
                  <span className="text-xs text-text-low">
                    {t.key}
                    {t.valueRequired ? ' · valor obrigatório' : ''}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={remove.isPending}
                  onClick={() =>
                    remove.mutate(t.id, {
                      onError: (e) => toast({ variant: 'error', title: e.message }),
                    })
                  }
                  aria-label="Remover tipo"
                  className="touch-target grid place-items-center rounded-md text-text-low outline-none hover:text-danger focus-visible:shadow-glow-md"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))
          )}

          <div className="flex flex-col gap-3 border-t border-border-subtle pt-3 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-1.5">
              <label className="text-xs text-text-low" htmlFor="ct-label">
                Novo tipo
              </label>
              <Input
                id="ct-label"
                value={label}
                placeholder="Ex.: Visita agendada"
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-1.5 text-sm text-text-mid sm:pb-2 sm:text-xs">
              <input
                type="checkbox"
                checked={valueRequired}
                onChange={(e) => setValueRequired(e.target.checked)}
                className="size-4 accent-[var(--color-accent)]"
              />
              Exige valor
            </label>
            <Button
              variant="secondary"
              className="w-full sm:w-auto"
              disabled={!label.trim() || create.isPending}
              onClick={add}
            >
              <Plus className="size-4" />
              Adicionar
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
