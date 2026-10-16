'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, Download, Lock, ShieldAlert, Upload } from 'lucide-react';
import { can } from '@hm/shared';
import { Button, useToast } from '@hm/ui';
import { ReadOnlyGuard } from '@/shared/components/account-banner';
import { HelpPanel } from '@/shared/components/help';
import { PageHeader } from '@/shared/components/layout/PageHeader';
import { ApiError } from '@/shared/lib/api-client';
import { formatNumber } from '@/shared/lib/locale';
import { useAuthStore } from '@/shared/stores/auth.store';
import { ImportPreviewModal } from './ImportPreviewModal';
import { useExportFlows, useImportFlows, usePreviewImport } from './queries';
import type { BackupEnvelope, PreviewResult } from './types';

function downloadEnvelope(envelope: BackupEnvelope): void {
  const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  a.download = `leadium-flows-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  // Limpeza ADIADA: revogar o object URL no mesmo tick do click() cancela o download
  // em Chrome/Firefox (o browser ainda não leu o blob). Deixar o URL vivo ~1s.
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}

/** "1 flow" / "12 flows", com o número no idioma da interface. */
function flowCount(n: number): string {
  return `${formatNumber(n)} ${n === 1 ? 'flow' : 'flows'}`;
}

/**
 * Backup de flows (F50-S05) no DS 3.0 (F72-S07): exportar (leitura, sempre disponível) e
 * importar (escrita, guardada em só leitura — F71-S17). A importação passa por um resumo
 * com verificação de integridade antes de confirmar (UX §2.9).
 *
 * UX: §2.5 `?` (HelpPanel); §2.7 botões em loading; §2.11 erros por toast com o motivo.
 */
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
          description: `${flowCount(envelope.flows.length)} no arquivo.`,
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
            description: `${flowCount(res.created.length)} como rascunho.`,
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
    <div>
      <Link
        href="/flows"
        className="-ml-2 mb-3 inline-flex h-8 items-center gap-1 rounded-sm px-2 text-sm font-medium text-text-low outline-none transition-colors hover:bg-surface-2 hover:text-text focus-visible:focus-ring"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Flows
      </Link>
      <PageHeader
        title="Backup de Flows"
        description="Exporte todos os flows num arquivo e importe em outro ambiente, como rascunho."
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
        <div className="flex items-start gap-3 rounded-lg border border-border bg-surface p-6">
          <Lock className="mt-0.5 size-4 shrink-0 text-text-low" aria-hidden />
          <p className="text-sm text-text-mid">
            Você não tem permissão para exportar ou importar flows. Fale com um administrador do
            workspace.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <section
              aria-labelledby="backup-export-title"
              className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6"
            >
              <span
                aria-hidden
                className="flex size-10 items-center justify-center rounded-sm border border-border bg-surface-2 text-text-mid"
              >
                <Download className="size-5" />
              </span>
              <div className="space-y-1.5">
                <h2 id="backup-export-title" className="font-head text-base font-semibold text-text">
                  Exportar flows
                </h2>
                <p className="text-sm leading-relaxed text-text-mid">
                  Baixa um arquivo JSON com nós, conexões, posições e configurações de cada flow, além dos
                  nomes das referências para reconstrução em outro ambiente.
                </p>
              </div>
              <div className="mt-auto">
                <Button
                  variant="primary"
                  leftIcon={<Download className="size-4" aria-hidden />}
                  loading={exportFlows.isPending}
                  onClick={onExport}
                >
                  Exportar e baixar
                </Button>
              </div>
            </section>

            <section
              aria-labelledby="backup-import-title"
              className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6"
            >
              <span
                aria-hidden
                className="flex size-10 items-center justify-center rounded-sm border border-border bg-surface-2 text-text-mid"
              >
                <Upload className="size-5" />
              </span>
              <div className="space-y-1.5">
                <h2 id="backup-import-title" className="font-head text-base font-semibold text-text">
                  Importar flows
                </h2>
                <p className="text-sm leading-relaxed text-text-mid">
                  Restaura de um arquivo de backup. Você revisa um resumo antes de confirmar; os flows
                  entram como rascunho e nada é sobrescrito.
                </p>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                tabIndex={-1}
                aria-hidden
                onChange={onFileSelected}
              />
              <div className="mt-auto">
                <ReadOnlyGuard align="start">
                  <Button
                    variant="secondary"
                    leftIcon={<Upload className="size-4" aria-hidden />}
                    loading={previewImport.isPending}
                    onClick={() => fileRef.current?.click()}
                  >
                    Selecionar arquivo…
                  </Button>
                </ReadOnlyGuard>
              </div>
            </section>
          </div>

          <p className="flex items-start gap-2 text-xs leading-snug text-text-low">
            <ShieldAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            O arquivo de backup pode conter dados sensíveis (URLs e cabeçalhos de webhooks). Guarde com cuidado.
          </p>
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
