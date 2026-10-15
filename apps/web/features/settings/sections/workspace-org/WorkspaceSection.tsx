'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, Input, useToast } from '@hm/ui';
import { ReadOnlyGuard, useIsReadOnly } from '@/shared/components/account-banner';
import { ColorSwatchInput } from '../../lib/ColorField';
import { isHexColor } from '../../lib/token-color';
import { FieldLabel, Panel, SaveFooter, SectionLoading, selectClass } from '../personal/components';
import { useUpdateWorkspace, useWorkspace } from './queries';

/**
 * Fusos IANA que o próprio runtime conhece (nenhum fuso literal no componente). O fuso
 * salvo entra na lista mesmo se o runtime não o listar (dado legado não some da tela).
 */
function timezoneOptions(current: string): readonly string[] {
  const known = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return current && !known.includes(current) ? [current, ...known] : known;
}

/**
 * Workspace + Marca: nome, fuso, idioma, logo, cor da marca (F8-S07), no DS 3.0 (F72-S07).
 * Configuração do WORKSPACE: com a empresa em só leitura "Salvar" fica `aria-disabled`
 * com a explicação (F71-S17). A cor da marca é DADO do cliente (`#RRGGBB`); sem escolha,
 * o seletor mostra a cor do token `--brand` e nada é enviado.
 */
export default function WorkspaceSection(): React.JSX.Element {
  const { toast } = useToast();
  const wsQuery = useWorkspace();
  const update = useUpdateWorkspace();
  // Só leitura: o botão fica focável (aria-disabled + explicação) mesmo sem alterações;
  // `disabled` tiraria o botão do Tab e a explicação nunca seria encontrada.
  const readOnly = useIsReadOnly();
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

  const zones = useMemo(() => timezoneOptions(form.timezone), [form.timezone]);

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const set = (k: keyof typeof form, v: string) => setForm((s) => ({ ...s, [k]: v }));
  const brandColor = form.brandColor.trim();
  const colorInvalid = brandColor !== '' && !isHexColor(brandColor);

  const save = async () => {
    if (colorInvalid) return;
    try {
      await update.mutateAsync({
        name: form.name.trim(),
        timezone: form.timezone.trim(),
        locale: form.locale.trim(),
        logoUrl: form.logoUrl.trim() || null,
        brandColor: brandColor || null,
      });
      setInitial(form);
      toast({ variant: 'success', title: 'Workspace atualizado.' });
    } catch (err) {
      toast({ variant: 'error', title: err instanceof Error ? err.message : 'Falha ao salvar.' });
    }
  };

  if (wsQuery.isLoading) return <SectionLoading label="Carregando workspace" />;

  return (
    <Panel
      title="Identidade, região e marca"
      description="Nome, fuso horário, idioma, logo e cor do workspace."
      footer={
        <SaveFooter dirty={dirty}>
          <ReadOnlyGuard>
            <Button
              variant="primary"
              disabled={!readOnly && (!dirty || colorInvalid)}
              loading={update.isPending}
              onClick={() => void save()}
            >
              Salvar workspace
            </Button>
          </ReadOnlyGuard>
        </SaveFooter>
      }
    >
      <Input label="Nome" value={form.name} onChange={(e) => set('name', e.target.value)} />
      <div className="grid gap-5 sm:grid-cols-2">
        <FieldLabel label="Fuso horário">
          <select
            value={form.timezone}
            onChange={(e) => set('timezone', e.target.value)}
            className={`${selectClass} font-mono`}
          >
            {!form.timezone && <option value="">Escolha um fuso</option>}
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </FieldLabel>
        <Input
          label="Idioma"
          className="font-mono"
          value={form.locale}
          onChange={(e) => set('locale', e.target.value)}
          hint="Código de idioma, como pt-BR."
        />
      </div>
      <Input
        label="Logo (URL)"
        type="url"
        value={form.logoUrl}
        onChange={(e) => set('logoUrl', e.target.value)}
        placeholder="https://…"
      />
      <div className="flex flex-col gap-1.5">
        <span id="brand-color-label" className="font-body text-sm font-bold text-text-mid">
          Cor da marca
        </span>
        <div className="flex items-start gap-2" role="group" aria-labelledby="brand-color-label">
          <ColorSwatchInput
            value={isHexColor(brandColor) ? brandColor : ''}
            onChange={(hex) => set('brandColor', hex)}
            label="Escolher a cor da marca"
          />
          <div className="flex-1">
            <Input
              aria-label="Cor da marca em hexadecimal"
              className="font-mono uppercase"
              value={form.brandColor}
              onChange={(e) => set('brandColor', e.target.value)}
              placeholder="#RRGGBB"
              error={colorInvalid ? 'Use o formato #RRGGBB.' : undefined}
              hint={brandColor ? undefined : 'Sem cor escolhida, vale a cor padrão.'}
            />
          </div>
        </div>
      </div>
    </Panel>
  );
}
