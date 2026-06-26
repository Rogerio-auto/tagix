'use client';

import { useEffect, useRef, useState } from 'react';
import { FileText, ImageIcon, Mic, Type, Video } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { useFlowEditor } from '../../hooks/useFlowEditor';
import { VariablesPicker } from '../../inspector/VariablesPicker';
import { NumberField, SelectField } from '../inspector-fields';
import { MediaUploadField, type UploadedMedia } from './MediaUploadField';
import { MessageBubblePreview } from './MessageBubblePreview';
import { mediaKindForType, type AudioMessageKind, type MessageType } from './types';

/**
 * Teto da pré-ação em segundos. Espelha `MESSAGE_PRE_ACTION_MAX_MS` (30_000ms) do
 * `@hm/flow-engine` (message.handler) — o runtime clampa a pré-ação nesse valor; o input
 * impõe o mesmo limite para a UI não prometer um tempo que o worker ignora. Esperas maiores
 * são o campo "Aguardar antes de enviar" (delayMs), que é não-bloqueante.
 */
const PRE_ACTION_MAX_SECONDS = 30;

const TYPE_OPTIONS: readonly { value: MessageType; label: string; icon: typeof Type }[] = [
  { value: 'text', label: 'Texto', icon: Type },
  { value: 'image', label: 'Imagem', icon: ImageIcon },
  { value: 'video', label: 'Vídeo', icon: Video },
  { value: 'document', label: 'Documento', icon: FileText },
  { value: 'audio', label: 'Áudio', icon: Mic },
];

/** Configuração de aceite de arquivo por tipo de mídia. */
const MEDIA_ACCEPT: Record<
  Exclude<MessageType, 'text'>,
  { accept: string; prefixes: readonly string[] }
> = {
  image: { accept: 'image/*', prefixes: ['image/'] },
  video: { accept: 'video/*', prefixes: ['video/'] },
  document: { accept: '*/*', prefixes: [] },
  audio: { accept: 'audio/*', prefixes: ['audio/'] },
};

/** Inferência de tipo p/ flows antigos (só tinham key + MIME). */
function inferType(data: Record<string, unknown>): MessageType {
  const explicit = data['messageType'];
  if (
    explicit === 'text' ||
    explicit === 'image' ||
    explicit === 'video' ||
    explicit === 'document' ||
    explicit === 'audio'
  ) {
    return explicit;
  }
  const key = (data['mediaStorageKey'] as string) ?? (data['mediaUrl'] as string) ?? '';
  if (!key) return 'text';
  const mime = (data['mediaType'] as string) ?? '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

/** Textarea com inserção de variáveis no cursor (FLOW_BUILDER §8). */
function TextWithVariables({
  label,
  value,
  placeholder,
  hint,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  hint?: string;
  onChange: (v: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const insert = (token: string) => {
    const el = ref.current;
    if (!el) {
      onChange(value + token);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-text-low">{label}</span>
        <VariablesPicker onPick={insert} />
      </div>
      <textarea
        ref={ref}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[90px] rounded-md border border-border-2 bg-surface-2 px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
      />
      {hint && <span className="text-[11px] text-text-low">{hint}</span>}
    </div>
  );
}

export function MessageInspector({ nodeId }: { nodeId: string }) {
  const nodes = useFlowEditor((s) => s.nodes);
  const update = useFlowEditor((s) => s.updateNodeData);
  const node = nodes.find((n) => n.id === nodeId);

  // Preview local de imagem (object URL); não persiste em node.data.
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    setPreviewUrl(undefined);
  }, [nodeId]);

  if (!node) return null;
  const d = (node.data ?? {}) as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => update(nodeId, patch);

  const messageType = inferType(d);
  const text = (d['text'] as string) ?? '';
  const caption = (d['caption'] as string) ?? '';
  const storageKey = (d['mediaStorageKey'] as string) ?? (d['mediaUrl'] as string) ?? '';
  const filename = (d['mediaFilename'] as string) ?? '';
  const audioMessageKind = ((d['audioMessageKind'] as string) ?? 'voice') as AudioMessageKind;
  const preAction = (d['preAction'] as string) ?? '';
  const preActionDurationMs = d['preActionDurationMs'] as number | undefined;
  const delayMs = d['delayMs'] as number | undefined;

  const selectType = (type: MessageType) => {
    setPreviewUrl(undefined);
    const patch: Record<string, unknown> = {
      messageType: type,
      mediaKind: mediaKindForType(type),
    };
    // Áudio nasce como nota de voz; outros tipos limpam o campo.
    patch['audioMessageKind'] =
      type === 'audio' ? ((d['audioMessageKind'] as string) ?? 'voice') : undefined;
    set(patch);
  };

  const onUploaded = (media: UploadedMedia) => {
    setPreviewUrl(media.objectUrl);
    set({
      mediaStorageKey: media.key,
      mediaType: media.mime,
      mediaFilename: media.filename,
      // Mantém compat com flows que liam `mediaUrl` como key.
      mediaUrl: media.key,
    });
  };

  const onKeyChange = (key: string) => {
    set({ mediaStorageKey: key, mediaUrl: key });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Seletor de tipo */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-text-low">Tipo de mensagem</span>
        <div className="grid grid-cols-5 gap-1 rounded-md border border-border-2 bg-surface-2 p-1">
          {TYPE_OPTIONS.map(({ value, label, icon: Icon }) => {
            const active = messageType === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => selectType(value)}
                aria-pressed={active}
                title={label}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-sm px-1 py-2 text-[10px] font-medium transition-colors',
                  'focus:shadow-glow-sm focus:outline-none',
                  active
                    ? 'bg-surface-3 text-text'
                    : 'text-text-low hover:bg-surface-3/60 hover:text-text-mid',
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </button>
            );
          })}
        </div>
        <span className="text-[11px] text-text-low">
          Nem todo canal envia todos os tipos — o envio respeita o canal da conversa.
        </span>
      </div>

      {/* Campos por tipo */}
      {messageType === 'text' && (
        <TextWithVariables
          label="Texto"
          value={text}
          placeholder="Olá {{contact.name}}"
          onChange={(v) => set({ text: v })}
        />
      )}

      {messageType !== 'text' && (
        <>
          <MediaUploadField
            label={
              messageType === 'image'
                ? 'Imagem'
                : messageType === 'video'
                  ? 'Vídeo'
                  : messageType === 'document'
                    ? 'Documento'
                    : 'Áudio'
            }
            accept={MEDIA_ACCEPT[messageType].accept}
            acceptPrefixes={MEDIA_ACCEPT[messageType].prefixes}
            storageKey={storageKey}
            filename={filename}
            onUploaded={onUploaded}
            onKeyChange={onKeyChange}
          />

          {messageType === 'audio' && (
            <SelectField
              label="Como enviar o áudio"
              value={audioMessageKind}
              options={[
                { value: 'voice', label: 'Nota de voz' },
                { value: 'audio_file', label: 'Arquivo de áudio' },
              ]}
              onChange={(v) => set({ audioMessageKind: v })}
            />
          )}

          {messageType !== 'audio' && (
            <TextWithVariables
              label="Legenda"
              value={caption}
              placeholder="Legenda opcional"
              hint="Aparece junto da mídia (imagem/vídeo/documento)."
              onChange={(v) => set({ caption: v })}
            />
          )}
        </>
      )}

      {/* Pré-visualização WYSIWYG */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-text-low">Pré-visualização</span>
        <MessageBubblePreview
          data={{
            messageType,
            text,
            caption,
            filename,
            previewUrl,
            audioMessageKind,
          }}
        />
      </div>

      {/* Aguardar antes de enviar (delay não-bloqueante) */}
      <div className="flex flex-col gap-3 border-t border-border-2 pt-4">
        <NumberField
          label="Aguardar antes de enviar (segundos)"
          value={delayMs !== undefined ? delayMs / 1000 : undefined}
          min={0}
          hint="Espera antes de enviar esta mensagem — use para espaçar as mensagens do fluxo. Não bloqueia o atendimento e não tem limite prático."
          onChange={(v) =>
            set({ delayMs: Number.isFinite(v) && v > 0 ? Math.round(v * 1000) : undefined })
          }
        />
      </div>

      {/* Pré-ação (presença) — indicador cosmético, ≤30s */}
      <div className="flex flex-col gap-3 border-t border-border-2 pt-4">
        <SelectField
          label="Pré-ação"
          value={preAction}
          hint="Mostra “digitando/gravando” logo antes de enviar (indicador visual)."
          options={[
            { value: '', label: 'Nenhuma' },
            { value: 'typing', label: 'Digitando' },
            { value: 'recording', label: 'Gravando' },
          ]}
          onChange={(v) => set({ preAction: v || undefined })}
        />
        {preAction && (
          <NumberField
            label="Duração (segundos)"
            value={preActionDurationMs !== undefined ? preActionDurationMs / 1000 : undefined}
            min={0}
            max={PRE_ACTION_MAX_SECONDS}
            hint="Tempo mostrando “digitando/gravando” ANTES de enviar. Padrão 1,5s · máx. 30s (acima disso, use “Aguardar antes de enviar”)."
            onChange={(v) => {
              if (!Number.isFinite(v) || v <= 0) {
                set({ preActionDurationMs: undefined });
                return;
              }
              const capped = Math.min(v, PRE_ACTION_MAX_SECONDS);
              set({ preActionDurationMs: Math.round(capped * 1000) });
            }}
          />
        )}
      </div>
    </div>
  );
}
