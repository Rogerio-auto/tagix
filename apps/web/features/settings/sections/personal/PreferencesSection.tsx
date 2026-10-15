'use client';

import { useEffect, useState } from 'react';
import { Button, useToast } from '@hm/ui';
import { FieldLabel, Panel, SaveFooter, SectionLoading, selectClass } from './components';
import { useMe, useUpdateMe } from './queries';

type Theme = 'dark' | 'light' | 'system';
type Density = 'comfortable' | 'compact';

/**
 * Valor de idioma da interface (dado do formulário, não formatação: o componente não
 * formata nada com ele). O valor inicial é o idioma padrão do produto até o servidor
 * expor o `localeOverride` salvo do membro.
 */
const DEFAULT_LOCALE = 'pt-BR';

/**
 * Preferências: tema, densidade, idioma. Preferência PESSOAL: liberada com a empresa em
 * só leitura (o servidor isenta `PATCH /api/members/me`).
 */
export default function PreferencesSection(): React.JSX.Element {
  const { toast } = useToast();
  const meQuery = useMe();
  const update = useUpdateMe();
  const [theme, setTheme] = useState<Theme>('dark');
  const [density, setDensity] = useState<Density>('comfortable');
  const [locale, setLocale] = useState(DEFAULT_LOCALE);
  const [initial, setInitial] = useState({ theme: 'dark' as Theme, density: 'comfortable' as Density, locale: DEFAULT_LOCALE });

  useEffect(() => {
    const m = meQuery.data?.member;
    if (m) {
      const next = {
        theme: (m.themePreference ?? 'dark') as Theme,
        density: (m.densityPreference ?? 'comfortable') as Density,
        locale: DEFAULT_LOCALE,
      };
      setTheme(next.theme);
      setDensity(next.density);
      setLocale(next.locale);
      setInitial(next);
    }
  }, [meQuery.data]);

  const dirty = theme !== initial.theme || density !== initial.density || locale !== initial.locale;

  const save = async () => {
    try {
      await update.mutateAsync({
        themePreference: theme,
        densityPreference: density,
        localeOverride: locale,
      });
      setInitial({ theme, density, locale });
      toast({ variant: 'success', title: 'Preferências salvas.' });
    } catch (err) {
      toast({ variant: 'error', title: err instanceof Error ? err.message : 'Falha ao salvar.' });
    }
  };

  if (meQuery.isLoading) return <SectionLoading label="Carregando preferências" />;

  return (
    <Panel
      title="Aparência e idioma"
      description="Valem só para você, em qualquer dispositivo em que entrar."
      footer={
        <SaveFooter dirty={dirty}>
          <Button variant="primary" disabled={!dirty} loading={update.isPending} onClick={() => void save()}>
            Salvar preferências
          </Button>
        </SaveFooter>
      }
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <FieldLabel label="Tema">
          <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)} className={selectClass}>
            <option value="dark">Escuro</option>
            <option value="light">Claro</option>
            <option value="system">Sistema</option>
          </select>
        </FieldLabel>
        <FieldLabel label="Densidade">
          <select value={density} onChange={(e) => setDensity(e.target.value as Density)} className={selectClass}>
            <option value="comfortable">Confortável</option>
            <option value="compact">Compacta</option>
          </select>
        </FieldLabel>
      </div>
      <FieldLabel label="Idioma">
        <select value={locale} onChange={(e) => setLocale(e.target.value)} className={selectClass}>
          <option value="pt-BR">Português (Brasil)</option>
          <option value="en-US">English (US)</option>
          <option value="es-ES">Español</option>
        </select>
      </FieldLabel>
    </Panel>
  );
}
