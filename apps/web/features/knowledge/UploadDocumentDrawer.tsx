'use client';

import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { FileText, Upload } from 'lucide-react';
import { Button, Drawer, Input, useToast } from '@hm/ui';
import { ReadOnlyGuard, useIsReadOnly } from '@/shared/components/account-banner';
import { Sheet as MobileSheet } from '@/shared/components/Sheet';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { ApiError } from '@/shared/lib/api-client';
import { useCreateKbDocument } from './queries';

/**
 * Drawer lateral de upload de documento (UX §2.3: drawer, não modal full-screen).
 * Aceita texto/markdown colado OU um arquivo .md/.txt. Cria o documento (nasce
 * `draft`/processando) e fecha; a lista faz polling até virar `active`.
 * Em empresa só leitura, "Enviar" fica `aria-disabled` com a explicação (F72-S07).
 */
export function UploadDocumentDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const { isMobile } = useBreakpoint();
  const create = useCreateKbDocument();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const readOnly = useIsReadOnly();

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
    if (readOnly) return;
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

  const fields: ReactNode = (
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
        <label htmlFor="kb-upload-content" className="font-body text-sm font-bold text-text-mid">
          Conteúdo (markdown)
        </label>
        <textarea
          id="kb-upload-content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={isMobile ? 8 : 12}
          placeholder="Cole o texto/markdown do documento aqui…"
          className="w-full resize-y rounded-sm border border-border bg-surface-2 px-3 py-2 font-mono text-sm leading-relaxed text-text outline-none transition-[border-color,box-shadow] duration-(--dur-base) ease-ds placeholder:font-body placeholder:text-text-low hover:border-border-2 focus:border-brand-text focus:shadow-glow-sm focus-visible:focus-ring"
        />
      </div>

      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          className="hidden"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onFile(file);
          }}
        />
        <Button
          variant="ghost"
          className="w-full sm:w-auto"
          leftIcon={<FileText className="size-4" aria-hidden />}
          onClick={() => fileInputRef.current?.click()}
        >
          Carregar arquivo .md/.txt
        </Button>
      </div>
    </div>
  );

  // Mobile: bottom-sheet com CTA fixo na zona do polegar (UX §2.3 / MOBILE_UX §1).
  if (isMobile) {
    return (
      <MobileSheet
        open={open}
        onClose={close}
        variant="bottom"
        title="Novo documento"
        footer={
          <ReadOnlyGuard className="w-full" align="center">
            <Button
              variant="primary"
              className="w-full"
              leftIcon={<Upload className="size-4" aria-hidden />}
              loading={create.isPending}
              onClick={() => void submit()}
            >
              Enviar
            </Button>
          </ReadOnlyGuard>
        }
      >
        {fields}
      </MobileSheet>
    );
  }

  return (
    <Drawer
      open={open}
      onClose={close}
      title="Novo documento"
      description="Os agentes passam a consultá-lo assim que a indexação terminar."
      className="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <ReadOnlyGuard>
            <Button
              variant="primary"
              leftIcon={<Upload className="size-4" aria-hidden />}
              loading={create.isPending}
              onClick={() => void submit()}
            >
              Enviar
            </Button>
          </ReadOnlyGuard>
        </>
      }
    >
      {fields}
    </Drawer>
  );
}
