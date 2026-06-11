'use client';

/**
 * Painel de configurações (F8-S05 / PERMISSIONS.md §5). Layout 2-colunas: sidebar
 * agrupada (Pessoal/Workspace) + conteúdo lazy da seção ativa. Busca Cmd+K localiza
 * seções; contadores/alertas por item; itens gated por permissão (`can()`).
 *
 * Seção ativa via `?s=<id>` (deep-linkável, mantém histórico). Seções com
 * `externalHref` navegam para a página dedicada (canais/conversões já existem).
 * Conteúdo carrega via React.lazy + Suspense (RSC-friendly no boundary do client).
 *
 * Server-driven de permissão: o gating usa `can(role, permission)` — itens que o
 * member não pode ver nem aparecem na sidebar nem na busca.
 */
import { Suspense, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { can, type Permission, type Role } from '@hm/shared';
import { PageHeader } from '@/shared/components/layout/PageHeader';
import { SkeletonList } from '@/shared/components/feedback';
import { useAuthStore } from '@/shared/stores/auth.store';
import { SettingsSidebar } from './SettingsSidebar';
import { SettingsSearch } from './SettingsSearch';
import { useSectionCounters } from './useSectionCounters';
import { SETTINGS_SECTIONS, findSection, type SettingsSection } from './registry';

function allowed(section: SettingsSection, role: Role | undefined): boolean {
  if (!section.permission) return true; // seções pessoais: qualquer member.
  if (!role) return false; // sem role resolvido → fecha (defesa em profundidade).
  return can(role, section.permission as Permission);
}

export function SettingsPanel() {
  const router = useRouter();
  const params = useSearchParams();
  const role = useAuthStore((s) => s.auth?.role);
  const counters = useSectionCounters();

  const sections = useMemo(
    () => SETTINGS_SECTIONS.filter((s) => allowed(s, role)),
    [role],
  );

  // Seção ativa: ?s= se válida e permitida; senão a 1ª seção visível (Perfil).
  const requested = params.get('s');
  const active = useMemo(() => {
    const fromQuery = requested ? findSection(requested) : undefined;
    if (fromQuery && allowed(fromQuery, role) && !fromQuery.externalHref) return fromQuery;
    return sections.find((s) => !s.externalHref) ?? null;
  }, [requested, role, sections]);

  const select = (section: SettingsSection): void => {
    if (section.externalHref) {
      router.push(section.externalHref);
      return;
    }
    router.push(`/settings?s=${section.id}`);
  };

  const ActiveComponent = active?.component ?? null;

  return (
    <>
      <div className="flex items-center justify-between">
        <PageHeader title="Configurações" />
        <SettingsSearch sections={sections} onSelect={select} />
      </div>
      <div className="mt-6 flex gap-8">
        <SettingsSidebar
          sections={sections}
          activeId={active?.id ?? ''}
          counters={counters}
          onSelect={(id) => {
            const section = findSection(id);
            if (section) select(section);
          }}
        />
        <div className="min-w-0 flex-1">
          {ActiveComponent ? (
            <div>
              <div className="mb-4">
                <h2 className="font-head text-lg text-text">{active?.label}</h2>
                <p className="font-body text-sm text-text-low">{active?.description}</p>
              </div>
              <Suspense fallback={<SkeletonList rows={5} />}>
                <ActiveComponent />
              </Suspense>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-surface p-8">
              <p className="font-body text-text-mid">Selecione uma configuração.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
