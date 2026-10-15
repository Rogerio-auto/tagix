'use client';

import { useState } from 'react';
import { AlertTriangle, Plus, Target, Trash2 } from 'lucide-react';
import {
  AnchoredHelpHint,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Modal,
  Switch,
  useToast,
} from '@hm/ui';
import { ReadOnlyGuard, useIsReadOnly } from '@/shared/components/account-banner';
import { Skeleton } from '@/shared/components/feedback';
import { PageHeader } from '@/shared/components/layout/PageHeader';
import { useConversionTypes, useCreateConversionType, useDeleteConversionType } from './queries';
import type { ConversionType } from './types';

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
 * Settings de tipos de conversão (F5-S13, /settings/conversions; DS 3.0 na F72-S07):
 * catálogo de `conversion_types`. Gatilhos por etapa/tag são editados nas automações.
 *
 * UX: §2.6 vazio com convite; §2.7 "Adicionar" com loading e erro inline; §2.9 remover
 * pede confirmação; §2.10 Enter no campo adiciona. Só leitura: adicionar e remover ficam
 * `aria-disabled` com a explicação.
 */
export function ConversionTypesSettings(): React.JSX.Element {
  const { toast } = useToast();
  const readOnly = useIsReadOnly();
  const typesQuery = useConversionTypes();
  const create = useCreateConversionType();
  const remove = useDeleteConversionType();

  const [label, setLabel] = useState('');
  const [valueRequired, setValueRequired] = useState(false);
  const [toRemove, setToRemove] = useState<ConversionType | null>(null);

  function add(): void {
    const trimmed = label.trim();
    if (!trimmed || readOnly) return;
    create.mutate(
      { key: slugify(trimmed) || `tipo_${Date.now()}`, label: trimmed, valueRequired },
      {
        onSuccess: () => {
          setLabel('');
          setValueRequired(false);
          toast({ variant: 'success', title: 'Tipo de conversão criado.' });
        },
        onError: (e) => toast({ variant: 'error', title: e.message }),
      },
    );
  }

  function confirmRemove(): void {
    if (!toRemove) return;
    remove.mutate(toRemove.id, {
      onSuccess: () => setToRemove(null),
      onError: (e) => toast({ variant: 'error', title: e.message }),
    });
  }

  const types = (typesQuery.data?.conversionTypes ?? []).filter((t) => t.isActive);

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Tipos de conversão"
        description="O que conta como resultado para a empresa. Cada tipo vira uma linha no painel de conversões."
        helpSlot={<AnchoredHelpHint anchorKey="conversions.types" />}
      />

      <div className="flex flex-col gap-4">
        <section
          aria-label="Tipos cadastrados"
          className="overflow-hidden rounded-lg border border-border bg-surface"
        >
          {typesQuery.isLoading ? (
            <ul aria-busy aria-label="Carregando tipos" className="divide-y divide-border">
              {Array.from({ length: 3 }).map((_, i) => (
                <li key={i} className="flex items-center gap-3 px-5 py-4">
                  <Skeleton className="size-2 rounded-pill" />
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="ml-auto h-4 w-24" />
                </li>
              ))}
            </ul>
          ) : typesQuery.isError ? (
            <ErrorState
              title="Não foi possível carregar os tipos"
              reason="A lista de tipos de conversão não respondeu."
              whatToDo="Verifique a conexão e tente novamente."
              action={
                <Button variant="secondary" size="sm" onClick={() => void typesQuery.refetch()}>
                  Tentar de novo
                </Button>
              }
            />
          ) : types.length === 0 ? (
            <EmptyState
              icon={Target}
              title="Nenhum tipo de conversão ainda"
              description="Crie o primeiro abaixo: por exemplo, “Venda fechada” ou “Visita agendada”."
            />
          ) : (
            <ul className="divide-y divide-border">
              {types.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-5 py-3.5">
                  {/* A cor é dado do tipo (cadastrada pelo cliente): só no ponto. */}
                  <i
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-pill bg-text-low"
                    style={t.color ? { backgroundColor: t.color } : undefined}
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-body text-sm font-bold text-text">{t.label}</span>
                    <span className="truncate font-mono text-xs text-text-low">{t.key}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {t.isDefault && (
                      <Badge tone="brand" size="sm">
                        Padrão
                      </Badge>
                    )}
                    {t.valueRequired && (
                      <Badge tone="neutral" size="sm">
                        Exige valor
                      </Badge>
                    )}
                    <ReadOnlyGuard>
                      <IconButton
                        variant="danger"
                        size="sm"
                        aria-label={`Remover tipo ${t.label}`}
                        icon={<Trash2 aria-hidden />}
                        onClick={() => setToRemove(t)}
                      />
                    </ReadOnlyGuard>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <form
          aria-label="Novo tipo de conversão"
          className="flex flex-col gap-4 rounded-lg border border-border bg-surface px-5 py-4 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <div className="min-w-0 flex-1">
            <Input
              label="Novo tipo"
              value={label}
              placeholder="Ex.: Visita agendada"
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="flex h-10 items-center sm:pb-0">
            <Switch checked={valueRequired} onCheckedChange={setValueRequired} label="Exige valor" />
          </div>
          <ReadOnlyGuard className="w-full sm:w-auto">
            <Button
              type="submit"
              variant="secondary"
              className="w-full sm:w-auto"
              leftIcon={<Plus className="size-4" aria-hidden />}
              disabled={!label.trim()}
              loading={create.isPending}
            >
              Adicionar
            </Button>
          </ReadOnlyGuard>
        </form>
      </div>

      <Modal
        open={toRemove !== null}
        onClose={() => setToRemove(null)}
        title="Remover tipo de conversão?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setToRemove(null)} disabled={remove.isPending}>
              Manter
            </Button>
            <ReadOnlyGuard>
              <Button variant="danger" loading={remove.isPending} onClick={confirmRemove}>
                Remover
              </Button>
            </ReadOnlyGuard>
          </>
        }
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="grid size-9 shrink-0 place-items-center rounded-sm border border-danger/25 bg-danger/10 text-danger"
          >
            <AlertTriangle className="size-5" />
          </span>
          <p className="font-body text-sm text-text-mid">
            <span className="font-bold text-text">{toRemove?.label}</span> deixa de aparecer para
            marcar novas conversões. As conversões já registradas com este tipo continuam no histórico.
          </p>
        </div>
      </Modal>
    </div>
  );
}
