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
 *
 * Responsivo (F36-S10 / MOBILE_UX §2 "Forms/Settings"): em `< md` vira uma pilha
 * de views — `/settings` mostra a LISTA de seções; abrir uma seção (`?s=`) navega
 * para a view da seção com "voltar" no topo. `md+` mantém o layout 2-colunas.
 */
import { Suspense, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { can, type Permission, type Role } from '@hm/shared';
import { PageHeader } from '@/shared/components/layout/PageHeader';
import { SkeletonList } from '@/shared/components/feedback';
import { useAuthStore } from '@/shared/stores/auth.store';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
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
  const { isMobile } = useBreakpoint();

  const sections = useMemo(
    () => SETTINGS_SECTIONS.filter((s) => allowed(s, role)),
    [role],
  );

  // Seção pedida explicitamente via ?s= (e permitida, sem externalHref).
  const requested = params.get('s');
  const requestedSection = useMemo(() => {
    const fromQuery = requested ? findSection(requested) : undefined;
    if (fromQuery && allowed(fromQuery, role) && !fromQuery.externalHref) return fromQuery;
    return null;
  }, [requested, role]);

  // No desktop, sem ?s= cai na 1ª seção visível (Perfil). No mobile, sem ?s= a
  // view-base é a LISTA (active = null) — pilha de views thumb-first.
  const active = useMemo(() => {
    if (requestedSection) return requestedSection;
    if (isMobile) return null;
    return sections.find((s) => !s.externalHref) ?? null;
  }, [requestedSection, isMobile, sections]);

  const select = (section: SettingsSection): void => {
    if (section.externalHref) {
      router.push(section.externalHref);
      return;
    }
    router.push(`/settings?s=${section.id}`);
  };

  const goToIndex = (): void => router.push('/settings');

  const ActiveComponent = active?.component ?? null;

  // ── Mobile: pilha de views (lista ↔ seção) ────────────────────────────────
  if (isMobile) {
    if (!active) {
      return (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <PageHeader title="Configurações" />
            <SettingsSearch sections={sections} onSelect={select} />
          </div>
          <SettingsSidebar
            sections={sections}
            activeId=""
            counters={counters}
            onSelect={(id) => {
              const section = findSection(id);
              if (section) select(section);
            }}
          />
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-4">
        <button
          type="button"
          onClick={goToIndex}
          className="touch-target -ml-2 inline-flex w-fit items-center gap-1 rounded-md px-2 text-sm font-medium text-text-mid outline-none hover:text-text focus-visible:shadow-glow-md"
        >
          <ChevronLeft className="size-4" aria-hidden />
          Configurações
        </button>
        <div>
          <h2 className="font-head text-lg text-text">{active.label}</h2>
          <p className="font-body text-sm text-text-low">{active.description}</p>
        </div>
        {ActiveComponent && (
          <Suspense fallback={<SkeletonList rows={5} />}>
            <ActiveComponent />
          </Suspense>
        )}
      </div>
    );
  }

  // ── Desktop: layout 2-colunas (inalterado) ────────────────────────────────
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
