'use client';

import { AlertTriangle, CheckCircle2, FileWarning, ShieldCheck, ShieldX } from 'lucide-react';
import { Badge, Button, Modal } from '@hm/ui';
import { ReadOnlyGuard } from '@/shared/components/account-banner';
import { formatNumber } from '@/shared/lib/locale';
import type { FlowPreviewEntry, PreviewResult, ReferenceResolution } from './types';

const KIND_LABEL: Record<ReferenceResolution['kind'], string> = {
  tag: 'Etiqueta',
  stage: 'Etapa',
  pipeline: 'Funil',
  agent: 'Agente',
  channel: 'Canal',
  member: 'Membro',
  flow: 'Flow',
  conversionType: 'Conversão',
  media: 'Mídia',
};

/** Número em mono dentro de uma frase. */
function Num({ value }: { value: number }) {
  return <span className="font-mono tabular-nums">{formatNumber(value)}</span>;
}

function FlowRow({ flow }: { flow: FlowPreviewEntry }) {
  const unresolved = flow.unresolvedReferences.length;
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text">{flow.name}</p>
          {flow.nameCollision && (
            <p className="text-xs text-warn">Nome já existe: entra como “{flow.finalName}”.</p>
          )}
        </div>
        <span className="shrink-0 text-xs text-text-low">
          <Num value={flow.nodeCount} /> {flow.nodeCount === 1 ? 'nó' : 'nós'}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {flow.resolvedReferences > 0 && (
          <Badge tone="success" size="sm">
            <CheckCircle2 className="size-3" aria-hidden />
            <Num value={flow.resolvedReferences} /> {flow.resolvedReferences === 1 ? 'referência vinculada' : 'referências vinculadas'}
          </Badge>
        )}
        {unresolved > 0 && (
          <Badge tone="warning" size="sm">
            <AlertTriangle className="size-3" aria-hidden />
            <Num value={unresolved} /> {unresolved === 1 ? 'não encontrada' : 'não encontradas'}
          </Badge>
        )}
        {flow.mediaWarnings > 0 && (
          <Badge tone="neutral" size="sm">
            <FileWarning className="size-3" aria-hidden />
            <Num value={flow.mediaWarnings} /> {flow.mediaWarnings === 1 ? 'mídia não migra' : 'mídias não migram'}
          </Badge>
        )}
      </div>

      {unresolved > 0 && (
        <ul className="ml-1 list-disc space-y-0.5 pl-4 text-xs text-text-low">
          {flow.unresolvedReferences.map((r, i) => (
            <li key={`${r.kind}-${r.sourceValue}-${i}`}>
              {KIND_LABEL[r.kind]}: <span className="text-text-mid">{r.label}</span> — será limpa
              (reconfigure antes de publicar)
            </li>
          ))}
        </ul>
      )}

      {flow.versionWarnings.map((w, i) => (
        <p key={i} className="text-xs text-warn">
          {w}
        </p>
      ))}
    </li>
  );
}

/**
 * Resumo da importação antes de confirmar (F50-S05; DS 3.0 F72-S07). Integridade do
 * arquivo primeiro (confirmar fica bloqueado com checksum inválido), depois cada flow com
 * o que foi vinculado e o que precisa de atenção. Contagens em mono.
 * Só leitura (F71-S17): "Confirmar importação" fica `aria-disabled` com a explicação.
 */
export function ImportPreviewModal({
  open,
  preview,
  importing,
  onConfirm,
  onClose,
}: {
  open: boolean;
  preview: PreviewResult | null;
  importing: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open && preview !== null}
      onClose={onClose}
      title="Revisar importação"
      description="Os flows entram como rascunho — nada é sobrescrito e nada dispara sozinho."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={importing}>
            Cancelar
          </Button>
          <ReadOnlyGuard>
            <Button
              variant="primary"
              loading={importing}
              disabled={!preview?.checksumValid}
              onClick={onConfirm}
            >
              Confirmar importação
            </Button>
          </ReadOnlyGuard>
        </>
      }
    >
      {preview && (
        <div className="space-y-4">
          {preview.checksumValid ? (
            <p className="flex items-center gap-2 rounded-sm border border-success/25 bg-success/10 px-3 py-2 text-xs text-success">
              <ShieldCheck className="size-4 shrink-0" aria-hidden />
              <span>
                Integridade do arquivo verificada · <Num value={preview.flowCount} />{' '}
                {preview.flowCount === 1 ? 'flow a importar' : 'flows a importar'}
              </span>
            </p>
          ) : (
            <p className="flex items-center gap-2 rounded-sm border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger">
              <ShieldX className="size-4 shrink-0" aria-hidden />
              O arquivo parece corrompido (checksum inválido). A importação está bloqueada.
            </p>
          )}

          <ul className="divide-y divide-border">
            {preview.flows.map((f) => (
              <FlowRow key={f.sourceId} flow={f} />
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
