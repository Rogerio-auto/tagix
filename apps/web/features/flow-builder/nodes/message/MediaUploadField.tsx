'use client';

import { useId, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Upload } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { uploadFlowMedia, type FlowMediaIntent } from './upload';

export interface UploadedMedia {
  key: string;
  mime: string;
  filename: string;
  /** Object URL local para preview imediato (nao persistido). */
  objectUrl?: string;
}

export interface MediaUploadFieldProps {
  label: string;
  /** `accept` do input nativo (ex.: `image/*`). */
  accept: string;
  /** Prefixos MIME aceitos para validacao (ex.: `['image/']`). Vazio = qualquer. */
  acceptPrefixes: readonly string[];
  storageKey: string;
  filename?: string;
  hint?: string;
  /**
   * Intenção de normalização server-side (default `auto` = passthrough). `voice`
   * transcodifica áudio p/ ogg/opus (nota de voz nativa). O `mime` em `onUploaded`
   * reflete sempre a resposta do servidor — não o `file.type` do browser.
   */
  intent?: FlowMediaIntent;
  onUploaded: (media: UploadedMedia) => void;
  onKeyChange: (key: string) => void;
}

/**
 * Campo de upload de midia do node `message` (F31-S02). Dropzone + file picker
 * com pipeline de signed-url; degrada para entrada manual de storage key quando
 * o endpoint de upload de flow ainda nao existe (ver upload.ts SEAM). Estados de
 * erro DS v2 (MIME invalido / upload indisponivel / falha de rede).
 */
export function MediaUploadField({
  label,
  accept,
  acceptPrefixes,
  storageKey,
  filename,
  hint,
  intent = 'auto',
  onUploaded,
  onKeyChange,
}: MediaUploadFieldProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const lastUrlRef = useRef<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const validateMime = (mime: string): boolean =>
    acceptPrefixes.length === 0 || acceptPrefixes.some((p) => mime.startsWith(p));

  const handleFile = async (file: File) => {
    setError(null);
    if (!validateMime(file.type)) {
      setError(`Tipo de arquivo invalido. Esperado: ${accept}.`);
      return;
    }
    setBusy(true);
    try {
      const uploaded = await uploadFlowMedia(file, intent);
      if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
      const objectUrl = URL.createObjectURL(file);
      lastUrlRef.current = objectUrl;
      // `mime` é o do SERVIDOR (pós-normalização) — ex.: `audio/ogg` quando voz —
      // não o `file.type` do browser; é ele que vira o `mediaType` do node.
      onUploaded({
        key: uploaded.key,
        mime: uploaded.mime || file.type,
        filename: file.name,
        objectUrl,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no upload da midia.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-text-low">{label}</span>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          const file = e.dataTransfer.files.item(0);
          if (file) void handleFile(file);
        }}
        disabled={busy}
        aria-describedby={hint ? `${inputId}-hint` : undefined}
        className={cn(
          'flex flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-border-2 bg-surface-2 px-3 py-5 text-center transition-colors',
          'hover:border-accent focus:border-accent focus:shadow-glow-sm focus:outline-none',
          dragActive && 'border-accent bg-surface-3',
          busy && 'cursor-wait opacity-70',
        )}
      >
        {busy ? (
          <Loader2 className="size-5 animate-spin text-text-low motion-reduce:animate-none" aria-hidden />
        ) : (
          <Upload className="size-5 text-text-low" aria-hidden />
        )}
        <span className="text-xs text-text-mid">
          {busy ? 'Enviando…' : 'Arraste um arquivo ou clique para enviar'}
        </span>
        {!busy && filename && (
          <span className="inline-flex max-w-full items-center gap-1 truncate text-[11px] text-text-low">
            <CheckCircle2 className="size-3 shrink-0 text-success" aria-hidden />
            {filename}
          </span>
        )}
      </button>

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = '';
        }}
      />

      {error && (
        <p
          role="alert"
          className="flex items-start gap-1.5 rounded-md border border-danger/30 bg-danger/10 px-2.5 py-1.5 text-[11px] text-danger"
        >
          <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-text-low">Storage key</span>
        <input
          type="text"
          value={storageKey}
          placeholder="workspaces/…/objeto"
          onChange={(e) => onKeyChange(e.target.value)}
          className="rounded-md border border-border-2 bg-surface-2 px-3 py-2 font-mono text-[11px] text-text focus:border-accent focus:outline-none"
        />
      </label>

      {hint && (
        <span id={`${inputId}-hint`} className="text-[11px] text-text-low">
          {hint}
        </span>
      )}
    </div>
  );
}
