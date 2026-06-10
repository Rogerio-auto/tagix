'use client';

import { useRef, useState } from 'react';
import { FileText, Upload } from 'lucide-react';
import { Button, Input, useToast } from '@hm/ui';
import { Sheet } from '@/shared/components/help/Sheet';
import { ApiError } from '@/shared/lib/api-client';
import { useCreateKbDocument } from './queries';

/**
 * Drawer lateral de upload de documento (UX §2.3: drawer, não modal full-screen).
 * Aceita texto/markdown colado OU um arquivo .md/.txt. Cria o documento (nasce
 * `draft`/processando) e fecha; a lista faz polling até virar `active`.
 */
export function UploadDocumentDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const create = useCreateKbDocument();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [content, setContent] = useState('');

  const reset = () => {
    setTitle('');
    setCategory('');
    setContent('');
  };

  const close = () => {
    reset();
    onClose();
  };

  const onFile = async (file: File) => {
    const text = await file.text();
    setContent(text);
    if (title.trim().length === 0) {
      setTitle(file.name.replace(/\.(md|markdown|txt)$/i, ''));
    }
  };

  const submit = async () => {
    if (title.trim().length === 0 || content.trim().length === 0) {
      toast({ variant: 'error', title: 'Preencha título e conteúdo' });
      return;
    }
    try {
      await create.mutateAsync({
        title: title.trim(),
        source: 'upload',
        category: category.trim() || null,
        rawContent: content,
      });
      toast({
        variant: 'success',
        title: 'Documento enviado',
        description: 'A indexação começou; o status aparece na lista.',
      });
      close();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Tente novamente.';
      const ref = err instanceof ApiError ? err.ref : undefined;
      toast({
        variant: 'error',
        title: 'Falha ao enviar o documento',
        description: ref ? `${message} (ref ${ref})` : message,
      });
    }
  };

  return (
    <Sheet open={open} onClose={close} title="Novo documento" widthClass="w-[520px]">
      <div className="flex flex-col gap-4">
        <Input
          label="Título"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ex.: Política de reembolso"
        />
        <Input
          label="Categoria (opcional)"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Ex.: Suporte"
        />

        <div className="flex flex-col gap-1.5">
          <span className="font-head text-sm font-medium text-text-mid">Conteúdo (markdown)</span>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={12}
            placeholder="Cole o texto/markdown do documento aqui…"
            className="w-full resize-y rounded-sm border border-border bg-surface-2 px-3 py-2 font-body text-sm text-text outline-none placeholder:text-text-low focus-visible:border-border-brand focus-visible:shadow-glow-sm"
          />
        </div>

        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
            }}
          />
          <Button
            variant="ghost"
            leftIcon={<FileText className="size-4" aria-hidden />}
            onClick={() => fileInputRef.current?.click()}
          >
            Carregar arquivo .md/.txt
          </Button>
        </div>

        <div className="mt-2 flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={close}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            leftIcon={<Upload className="size-4" aria-hidden />}
            loading={create.isPending}
            onClick={() => void submit()}
          >
            Enviar
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
