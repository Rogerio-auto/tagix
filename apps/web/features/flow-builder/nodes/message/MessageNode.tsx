'use client';

import type { NodeProps } from '@xyflow/react';
import { AudioLines, FileText, ImageIcon, Mic, Type, Video } from 'lucide-react';
import { NodeShell } from '../BaseNode';
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
 * conteúdo direto no canvas. DS 3.0 (F72-S07): casco comum `NodeShell`.
 */
function MessageNodeComponent(props: NodeProps) {
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
    <NodeShell kind="message" selected={props.selected}>
      <div className="mt-2 flex items-center gap-1.5 rounded-xs border border-border bg-surface-2 px-2 py-1">
        <RowIcon className="size-3.5 shrink-0 text-text-low" aria-hidden />
        <span className="truncate text-xs text-text-mid">{summary}</span>
      </div>
    </NodeShell>
  );
}

MessageNodeComponent.displayName = 'FlowNode_message';

export const MessageNode = MessageNodeComponent;
