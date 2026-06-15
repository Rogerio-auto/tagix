'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AudioLines, FileText, ImageIcon, Mic, Type, Video } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { NODE_CATALOG } from '../../shared/node-catalog';
import { type MessageType } from './types';

const TYPE_META: Record<MessageType, { icon: typeof Type; label: string }> = {
  text: { icon: Type, label: 'Texto' },
  image: { icon: ImageIcon, label: 'Imagem' },
  video: { icon: Video, label: 'Vídeo' },
  document: { icon: FileText, label: 'Documento' },
  audio: { icon: Mic, label: 'Áudio' },
};

function readType(data: Record<string, unknown>): MessageType {
  const t = data['messageType'];
  if (t === 'image' || t === 'video' || t === 'document' || t === 'audio') return t;
  if (t === 'text') return 'text';
  const key = (data['mediaStorageKey'] as string) ?? (data['mediaUrl'] as string) ?? '';
  if (!key) return 'text';
  const mime = (data['mediaType'] as string) ?? '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

/**
 * Node `message` rico (F31-S02). Mostra o tipo de mensagem e um resumo do
 * conteúdo direto no canvas. Mantém os handles do shell base.
 */
function MessageNodeComponent(props: NodeProps) {
  const meta = NODE_CATALOG['message'];
  const HeaderIcon = meta.icon;
  const data: Record<string, unknown> = props.data ?? {};
  const type = readType(data);
  const { icon: TypeIcon, label } = TYPE_META[type];

  const text = ((data['text'] as string) ?? '').trim();
  const caption = ((data['caption'] as string) ?? '').trim();
  const filename = ((data['mediaFilename'] as string) ?? '').trim();
  const audioKind = data['audioMessageKind'];

  let summary: string;
  if (type === 'text') {
    summary = text || 'Mensagem de texto';
  } else if (type === 'audio') {
    summary = audioKind === 'audio_file' ? 'Arquivo de áudio' : 'Nota de voz';
  } else {
    summary = caption || filename || label;
  }

  const AudioGlyph = audioKind === 'audio_file' ? AudioLines : Mic;
  const RowIcon = type === 'audio' ? AudioGlyph : TypeIcon;

  return (
    <div
      className={cn(
        'min-w-[180px] max-w-[220px] rounded-lg border bg-surface-2 px-3 py-2.5 shadow-sm transition-colors',
        props.selected ? 'border-accent' : 'border-border-2',
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-text-low" />
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-md bg-surface-3 text-text">
          <HeaderIcon className="size-4" aria-hidden />
        </span>
        <p className="truncate font-head text-sm font-medium text-text">{meta.label}</p>
      </div>

      <div className="mt-2 flex items-center gap-1.5 rounded-md bg-surface-1/60 px-2 py-1.5">
        <RowIcon className="size-3.5 shrink-0 text-text-low" aria-hidden />
        <span className="truncate text-[11px] text-text-mid">{summary}</span>
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-text-low" />
    </div>
  );
}

MessageNodeComponent.displayName = 'FlowNode_message';

export const MessageNode = MessageNodeComponent;
