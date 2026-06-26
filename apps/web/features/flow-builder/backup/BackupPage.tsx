'use client';

import { useRef, useState } from 'react';
import { DatabaseBackup, Download, Upload } from 'lucide-react';
import { can } from '@hm/shared';
import { Button, Card, useToast } from '@hm/ui';
import { HelpPanel } from '@/shared/components/help';
import { PageHeader } from '@/shared/components/layout/PageHeader';
import { ApiError } from '@/shared/lib/api-client';
import { useAuthStore } from '@/shared/stores/auth.store';
import { ImportPreviewModal } from './ImportPreviewModal';
import { useExportFlows, useImportFlows, usePreviewImport } from './queries';
import type { BackupEnvelope, PreviewResult } from './types';

function downloadEnvelope(envelope: BackupEnvelope): void {
  const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `leadium-flows-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function BackupPage() {
  const role = useAuthStore((s) => s.auth?.role);
  const canBackup = role ? can(role, 'flow.backup') : false;
  const { toast } = useToast();

  const exportFlows = useExportFlows();
  const previewImport = usePreviewImport();
  const importFlows = useImportFlows();

  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingEnvelope, setPendingEnvelope] = useState<unknown>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const toastError = (err: unknown, title: string): void => {
    toast({
      variant: 'error',
      title,
      description: err instanceof ApiError ? err.message : 'Tente novamente.',
    });
  };

  const onExport = (): void => {
    exportFlows.mutate(undefined, {
      onSuccess: (envelope) => {
        downloadEnvelope(envelope);
        toast({
          variant: 'success',
          title: 'Backup exportado',
          description: `${envelope.flows.length} flow(s) no arquivo.`,
        });
      },
      onError: (err) => toastError(err, 'Não foi possível exportar'),
    });
  };

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite reselecionar o mesmo arquivo
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch {
        toast({
          variant: 'error',
          title: 'Arquivo inválido',
          description: 'Não foi possível ler o JSON do backup.',
        });
        return;
      }
      setPendingEnvelope(parsed);
      previewImport.mutate(parsed, {
        onSuccess: (res) => {
          setPreview(res);
          setModalOpen(true);
        },
        onError: (err) => toastError(err, 'Backup incompatível'),
      });
    };
    reader.readAsText(file);
  };

  const onConfirmImport = (): void => {
    const envelope = pendingEnvelope as BackupEnvelope | null;
    const checksum = envelope?.checksum?.value;
    if (!envelope || !checksum) return;
    importFlows.mutate(
      { envelope, confirmedChecksum: checksum },
      {
        onSuccess: (res) => {
          toast({
            variant: 'success',
            title: 'Importação concluída',
            description: `${res.created.length} flow(s) importado(s) como rascunho.`,
          });
          setModalOpen(false);
          setPendingEnvelope(null);
          setPreview(null);
        },
        onError: (err) => toastError(err, 'Falha na importação'),
      },
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Backup de Flows"
        helpSlot={
          <HelpPanel title="Backup de Flows">
            <div className="space-y-2 text-sm text-text-mid">
              <p>
                Exporte todos os seus flows num único arquivo JSON e importe-os de volta — no mesmo
                ambiente ou em outra instalação do Leadium.
              </p>
              <p>
                Na importação, as referências (etiquetas, etapas, agentes, canais) são re-vinculadas
                pelo nome no ambiente destino. O que não existir lá é informado no resumo e entra como
                rascunho para você reconfigurar. Nada é sobrescrito e nada dispara sozinho.
              </p>
            </div>
          </HelpPanel>
        }
      />

      {!canBackup ? (
        <Card elevation={1}>
          <p className="p-6 text-sm text-text-low">
            Você não tem permissão para exportar ou importar flows. Fale com um administrador do
            workspace.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {/* Exportar */}
          <Card elevation={1}>
            <div className="flex flex-col gap-4 p-6">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-lg bg-surface-2 text-accent">
                  <Download className="size-5" aria-hidden />
                </span>
                <div>
                  <h2 className="text-sm font-semibold text-text">Exportar flows</h2>
                  <p className="text-xs text-text-low">Baixa todos os flows num arquivo JSON.</p>
                </div>
              </div>
              <p className="text-sm text-text-mid">
                Inclui nós, conexões, posições e configurações de cada flow, além dos nomes das
                referências para reconstrução em outro ambiente.
              </p>
              <Button
                variant="primary"
                leftIcon={<Download className="size-4" aria-hidden />}
                loading={exportFlows.isPending}
                onClick={onExport}
              >
                Exportar e baixar
              </Button>
            </div>
          </Card>

          {/* Importar */}
          <Card elevation={1}>
            <div className="flex flex-col gap-4 p-6">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-lg bg-surface-2 text-accent">
                  <Upload className="size-5" aria-hidden />
                </span>
                <div>
                  <h2 className="text-sm font-semibold text-text">Importar flows</h2>
                  <p className="text-xs text-text-low">Restaura de um arquivo de backup.</p>
                </div>
              </div>
              <p className="text-sm text-text-mid">
                Você verá um resumo do conteúdo antes de confirmar. Os flows entram como rascunho — nada
                é sobrescrito.
              </p>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={onFileSelected}
              />
              <Button
                variant="secondary"
                leftIcon={<Upload className="size-4" aria-hidden />}
                loading={previewImport.isPending}
                onClick={() => fileRef.current?.click()}
              >
                Selecionar arquivo…
              </Button>
            </div>
          </Card>
        </div>
      )}

      {!canBackup ? null : (
        <div className="flex items-center gap-2 text-xs text-text-low">
          <DatabaseBackup className="size-3.5" aria-hidden />
          <span>O arquivo de backup pode conter dados sensíveis (URLs e cabeçalhos de webhooks). Guarde com cuidado.</span>
        </div>
      )}

      <ImportPreviewModal
        open={modalOpen}
        preview={preview}
        importing={importFlows.isPending}
        onConfirm={onConfirmImport}
        onClose={() => {
          if (importFlows.isPending) return;
          setModalOpen(false);
          setPendingEnvelope(null);
          setPreview(null);
        }}
      />
    </div>
  );
}
