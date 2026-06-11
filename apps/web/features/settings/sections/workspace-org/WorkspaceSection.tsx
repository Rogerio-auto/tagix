'use client';

import { useEffect, useState } from 'react';
import { Button, Input, useToast } from '@hm/ui';
import { FieldLabel } from '../personal/components';
import { useUpdateWorkspace, useWorkspace } from './queries';

/** Workspace + Marca: nome, timezone, locale, logo, cor da marca. */
export default function WorkspaceSection(): React.JSX.Element {
  const { toast } = useToast();
  const wsQuery = useWorkspace();
  const update = useUpdateWorkspace();
  const [form, setForm] = useState({ name: '', timezone: '', locale: '', logoUrl: '', brandColor: '' });
  const [initial, setInitial] = useState(form);

  useEffect(() => {
    const w = wsQuery.data?.workspace;
    if (w) {
      const next = {
        name: w.name,
        timezone: w.timezone,
        locale: w.locale,
        logoUrl: w.logoUrl ?? '',
        brandColor: typeof w.settings['brand_color'] === 'string' ? (w.settings['brand_color'] as string) : '',
      };
      setForm(next);
      setInitial(next);
    }
  }, [wsQuery.data]);

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const set = (k: keyof typeof form, v: string) => setForm((s) => ({ ...s, [k]: v }));

  const save = async () => {
    try {
      await update.mutateAsync({
        name: form.name.trim(),
        timezone: form.timezone.trim(),
        locale: form.locale.trim(),
        logoUrl: form.logoUrl.trim() || null,
        brandColor: form.brandColor.trim() || null,
      });
      setInitial(form);
      toast({ variant: 'success', title: 'Workspace atualizado.' });
    } catch (err) {
      toast({ variant: 'error', title: err instanceof Error ? err.message : 'Falha ao salvar.' });
    }
  };

  if (wsQuery.isLoading) return <p className="text-sm text-text-low">Carregando…</p>;

  return (
    <div className="flex max-w-md flex-col gap-4">
      <FieldLabel label="Nome">
        <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
      </FieldLabel>
      <FieldLabel label="Fuso horário">
        <Input value={form.timezone} onChange={(e) => set('timezone', e.target.value)} placeholder="America/Sao_Paulo" />
      </FieldLabel>
      <FieldLabel label="Idioma">
        <Input value={form.locale} onChange={(e) => set('locale', e.target.value)} placeholder="pt-BR" />
      </FieldLabel>
      <FieldLabel label="Logo (URL)">
        <Input value={form.logoUrl} onChange={(e) => set('logoUrl', e.target.value)} placeholder="https://…" />
      </FieldLabel>
      <FieldLabel label="Cor da marca">
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={form.brandColor || '#1FFF13'}
            onChange={(e) => set('brandColor', e.target.value)}
            aria-label="Cor da marca"
            className="h-9 w-12 rounded border border-border bg-surface"
          />
          <Input value={form.brandColor} onChange={(e) => set('brandColor', e.target.value)} placeholder="#1FFF13" />
        </div>
      </FieldLabel>
      <div>
        <Button variant="primary" disabled={!dirty || update.isPending} onClick={() => void save()}>
          {update.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </div>
  );
}
