'use client';

import Link from 'next/link';
import { ChevronLeft, Redo2, Save, Send, Undo2 } from 'lucide-react';
import { Badge, Button, IconButton } from '@hm/ui';
import { ReadOnlyGuard } from '@/shared/components/account-banner';
import { HelpHint } from '@/shared/components/help';
import { FlowStatusBadge } from '../list/FlowStatusBadge';
import type { FlowStatus } from '../list/types';
import { EditableFlowName } from './EditableFlowName';

interface Props {
  flowName: string;
  status: FlowStatus;
  dirty: boolean;
  saving: boolean;
  publishing: boolean;
  renaming: boolean;
  canUndo: boolean;
  canRedo: boolean;
  canPublish: boolean;
  /** Empresa em só leitura (F71-S17): escrita fica `aria-disabled` com a explicação. */
  readOnly: boolean;
  onSave: () => void;
  onPublish: () => void;
  onRename: (name: string) => void;
  onUndo: () => void;
  onRedo: () => void;
}

/**
 * Barra superior do editor (FLOW_BUILDER seção 9.2) no DS 3.0 (F72-S07): volta para a
 * lista, nome editável como `<h1>`, status do flow e do rascunho, desfazer/refazer e as
 * ações. Publicar é o único verde cheio da tela; salvar é secundário.
 *
 * UX: §2.7 botões com loading; §2.10 atalhos (Ctrl/⌘+S, Ctrl/⌘+Z, Ctrl/⌘+Shift+Z,
 * declarados em `aria-keyshortcuts` e tratados no `FlowEditorPage`).
 */
export function ToolbarTop({
  flowName,
  status,
  dirty,
  saving,
  publishing,
  renaming,
  canUndo,
  canRedo,
  canPublish,
  readOnly,
  onSave,
  onPublish,
  onRename,
  onUndo,
  onRedo,
}: Props) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-3">
      <div className="flex min-w-0 items-center gap-2">
        <Link
          href="/flows"
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-sm px-2 text-sm font-medium text-text-low outline-none transition-colors hover:bg-surface-2 hover:text-text focus-visible:focus-ring"
        >
          <ChevronLeft className="size-4" aria-hidden />
          Flows
        </Link>
        <span aria-hidden className="h-5 w-px shrink-0 bg-border" />
        <h1 className="min-w-0">
          <EditableFlowName name={flowName} onRename={onRename} saving={renaming} readOnly={readOnly} />
        </h1>
        <HelpHint k="flow.canvas" />
        <FlowStatusBadge status={status} />
        <Badge tone={dirty ? 'warning' : 'neutral'} size="sm">
          {dirty ? 'Alterações não salvas' : 'Salvo'}
        </Badge>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <IconButton
          size="sm"
          icon={<Undo2 />}
          aria-label="Desfazer"
          aria-keyshortcuts="Control+Z Meta+Z"
          title="Desfazer (Ctrl+Z)"
          disabled={!canUndo}
          onClick={onUndo}
        />
        <IconButton
          size="sm"
          icon={<Redo2 />}
          aria-label="Refazer"
          aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z"
          title="Refazer (Ctrl+Shift+Z)"
          disabled={!canRedo}
          onClick={onRedo}
        />
        <span aria-hidden className="mx-1 h-5 w-px bg-border" />
        <ReadOnlyGuard readOnly={readOnly}>
          <Button
            variant="secondary"
            size="sm"
            loading={saving}
            // Só leitura: focável e explicado (aria-disabled), nunca `disabled`.
            disabled={!readOnly && !dirty}
            aria-keyshortcuts="Control+S Meta+S"
            leftIcon={<Save className="size-4" aria-hidden />}
            onClick={onSave}
          >
            Salvar
          </Button>
        </ReadOnlyGuard>
        {canPublish && (
          <ReadOnlyGuard readOnly={readOnly}>
            <Button
              variant="primary"
              size="sm"
              loading={publishing}
              leftIcon={<Send className="size-4" aria-hidden />}
              onClick={onPublish}
            >
              Publicar
            </Button>
          </ReadOnlyGuard>
        )}
      </div>
    </header>
  );
}
