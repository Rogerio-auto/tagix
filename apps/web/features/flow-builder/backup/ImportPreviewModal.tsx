'use client';

import { AlertTriangle, CheckCircle2, FileWarning, ShieldCheck, ShieldX } from 'lucide-react';
import { Button, Modal } from '@hm/ui';
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

function FlowRow({ flow }: { flow: FlowPreviewEntry }) {
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text">{flow.name}</p>
          {flow.nameCollision && (
            <p className="truncate text-[11px] text-warning">
              Nome já existe → será importado como “{flow.finalName}”
            </p>
          )}
        </div>
        <span className="shrink-0 text-[11px] text-text-low">{flow.nodeCount} nós</span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        {flow.resolvedReferences > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-success">
            <CheckCircle2 className="size-3" aria-hidden />
            {flow.resolvedReferences} referência(s) vinculada(s)
          </span>
        )}
        {flow.unresolvedReferences.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-warning">
            <AlertTriangle className="size-3" aria-hidden />
            {flow.unresolvedReferences.length} não encontrada(s)
          </span>
        )}
        {flow.mediaWarnings > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 text-text-low">
            <FileWarning className="size-3" aria-hidden />
            {flow.mediaWarnings} mídia(s) não migram
          </span>
        )}
      </div>

      {flow.unresolvedReferences.length > 0 && (
        <ul className="ml-1 list-disc space-y-0.5 pl-4 text-[11px] text-text-low">
          {flow.unresolvedReferences.map((r, i) => (
            <li key={`${r.kind}-${r.sourceValue}-${i}`}>
              {KIND_LABEL[r.kind]}: <span className="text-text-mid">{r.label}</span> — será limpa
              (reconfigure antes de publicar)
            </li>
          ))}
        </ul>
      )}

      {flow.versionWarnings.map((w, i) => (
        <p key={i} className="text-[11px] text-warning">
          {w}
        </p>
      ))}
    </li>
  );
}

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
          <Button
            variant="primary"
            loading={importing}
            disabled={!preview?.checksumValid}
            onClick={onConfirm}
          >
            Confirmar importação
          </Button>
        </>
      }
    >
      {preview && (
        <div className="space-y-4">
          {preview.checksumValid ? (
            <div className="flex items-center gap-2 rounded-md bg-success/10 px-3 py-2 text-xs text-success">
              <ShieldCheck className="size-4" aria-hidden />
              Integridade do arquivo verificada · {preview.flowCount} flow(s) a importar
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">
              <ShieldX className="size-4" aria-hidden />
              O arquivo parece corrompido (checksum inválido). A importação está bloqueada.
            </div>
          )}

          <ul className="divide-y divide-border-2">
            {preview.flows.map((f) => (
              <FlowRow key={f.sourceId} flow={f} />
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
