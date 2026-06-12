'use client';

import { Redo2, Save, Send, Undo2 } from 'lucide-react';
import { Button } from '@hm/ui';
import { HelpHint } from '@/shared/components/help';
import { cn } from '@/shared/lib/cn';

interface Props {
  flowName: string;
  dirty: boolean;
  saving: boolean;
  publishing: boolean;
  canUndo: boolean;
  canRedo: boolean;
  canPublish: boolean;
  onSave: () => void;
  onPublish: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

/** Barra superior do editor (FLOW_BUILDER secao 9.2): nome, dirty state, undo/redo, salvar, publicar. */
export function ToolbarTop({
  flowName,
  dirty,
  saving,
  publishing,
  canUndo,
  canRedo,
  canPublish,
  onSave,
  onPublish,
  onUndo,
  onRedo,
}: Props) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-border-2 bg-surface-1 px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="truncate font-head text-sm font-semibold text-text">{flowName}</h1>
        <HelpHint k="flow.canvas" />
        <span
          className={cn(
            'rounded-pill px-2 py-0.5 text-[11px]',
            dirty ? 'bg-warning/15 text-warning' : 'bg-surface-3 text-text-low',
          )}
        >
          {dirty ? 'Alteracoes nao salvas' : 'Salvo'}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          disabled={!canUndo}
          onClick={onUndo}
          aria-label="Desfazer"
        >
          <Undo2 className="size-4" aria-hidden />
        </Button>
        <Button variant="ghost" size="sm" disabled={!canRedo} onClick={onRedo} aria-label="Refazer">
          <Redo2 className="size-4" aria-hidden />
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={saving || !dirty}
          leftIcon={<Save className="size-4" aria-hidden />}
          onClick={onSave}
        >
          {saving ? 'Salvando...' : 'Salvar'}
        </Button>
        {canPublish && (
          <Button
            variant="primary"
            size="sm"
            disabled={publishing}
            leftIcon={<Send className="size-4" aria-hidden />}
            onClick={onPublish}
          >
            {publishing ? 'Publicando...' : 'Publicar'}
          </Button>
        )}
      </div>
    </header>
  );
}
