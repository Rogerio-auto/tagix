'use client';

/**
 * Painel de configurações (F8-S05 / PERMISSIONS.md §5), no DS 3.0 (F72-S07). Layout
 * 2-colunas: sidebar agrupada (Pessoal/Workspace, rótulos em mono) + conteúdo lazy da
 * seção ativa. Busca ⌘K localiza seções; contadores/alertas por item; itens gated por
 * permissão (`can()`).
 *
 * Seção ativa via `?s=<id>` (deep-linkável, mantém histórico). Seções com
 * `externalHref` navegam para a página dedicada (canais/conversões já existem).
 * Conteúdo carrega via React.lazy + Suspense (esqueleto no formato do painel).
 *
 * Server-driven de permissão: o gating usa `can(role, permission)` — itens que o
 * member não pode ver nem aparecem na sidebar nem na busca.
 *
 * Responsivo (F36-S10 / MOBILE_UX §2 "Forms/Settings"): em `< md` vira uma pilha
 * de views — `/settings` mostra a LISTA de seções; abrir uma seção (`?s=`) navega
 * para a view da seção com "voltar" no topo. `md+` mantém o layout 2-colunas.
 *
 * UX: §2.4 caminho óbvio (sidebar sempre visível); §2.7 esqueleto na troca de seção;
 * §2.10 ⌘K foca a busca. A entrada da seção é fade + 8px (só com movimento permitido).
 */
import { Suspense, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { can, type Permission, type Role } from '@hm/shared';
import { PageHeader } from '@/shared/components/layout/PageHeader';
import { useAuthStore } from '@/shared/stores/auth.store';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { SectionLoading, eyebrowClass } from '../sections/personal/components';
import { SettingsSidebar } from './SettingsSidebar';
import { SettingsSearch } from './SettingsSearch';
import { useSectionCounters } from './useSectionCounters';
import { SETTINGS_GROUP_LABEL, SETTINGS_SECTIONS, findSection, type SettingsSection } from './registry';

function allowed(section: SettingsSection, role: Role | undefined): boolean {
  if (!section.permission) return true; // seções pessoais: qualquer member.
  if (!role) return false; // sem role resolvido → fecha (defesa em profundidade).
  return can(role, section.permission as Permission);
}

const DESCRIPTION = 'Sua conta, a operação do workspace e as integrações.';

/** Cabeçalho da seção ativa: grupo em mono, título e a frase do que ela controla. */
function SectionHeading({ section }: { section: SettingsSection }) {
  return (
    <div className="mb-5">
      <p className={eyebrowClass}>{SETTINGS_GROUP_LABEL[section.group]}</p>
      <h2 className="mt-1.5 font-head text-xl font-semibold tracking-tight text-text">{section.label}</h2>
      <p className="mt-1 max-w-prose font-body text-sm text-text-low">{section.description}</p>
    </div>
  );
}

export function SettingsPanel() {
  const router = useRouter();
  const params = useSearchParams();
  const role = useAuthStore((s) => s.auth?.role);
  const counters = useSectionCounters();
  const { isMobile } = useBreakpoint();

  const sections = useMemo(() => SETTINGS_SECTIONS.filter((s) => allowed(s, role)), [role]);

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

  const onSelectId = (id: string): void => {
    const section = findSection(id);
    if (section) select(section);
  };

  const goToIndex = (): void => router.push('/settings');

  const ActiveComponent = active?.component ?? null;

  // ── Mobile: pilha de views (lista ↔ seção) ────────────────────────────────
  if (isMobile) {
    if (!active) {
      return (
        <div className="flex flex-col gap-5">
          <div>
            <PageHeader title="Configurações" description={DESCRIPTION} />
            <SettingsSearch sections={sections} onSelect={select} className="-mt-2 w-full" />
          </div>
          <SettingsSidebar sections={sections} activeId="" counters={counters} onSelect={onSelectId} />
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-4">
        <button
          type="button"
          onClick={goToIndex}
          className="touch-target -ml-2 inline-flex w-fit items-center gap-1 rounded-sm px-2 font-body text-sm font-bold text-text-mid outline-none transition-colors duration-(--dur-base) hover:text-text focus-visible:focus-ring"
        >
          <ChevronLeft className="size-4" aria-hidden />
          Configurações
        </button>
        <div key={active.id} className="motion-safe:animate-[hm-rise_240ms_var(--ease)_both]">
          <SectionHeading section={active} />
          {ActiveComponent && (
            <Suspense fallback={<SectionLoading label={`Carregando ${active.label}`} />}>
              <ActiveComponent />
            </Suspense>
          )}
        </div>
      </div>
    );
  }

  // ── Desktop: layout 2-colunas ─────────────────────────────────────────────
  return (
    <>
      <PageHeader
        title="Configurações"
        description={DESCRIPTION}
        actions={<SettingsSearch sections={sections} onSelect={select} />}
      />
      <div className="flex items-start gap-10">
        <SettingsSidebar
          sections={sections}
          activeId={active?.id ?? ''}
          counters={counters}
          onSelect={onSelectId}
        />
        <div className="min-w-0 max-w-5xl flex-1">
          {active && ActiveComponent ? (
            <div key={active.id} className="motion-safe:animate-[hm-rise_240ms_var(--ease)_both]">
              <SectionHeading section={active} />
              <Suspense fallback={<SectionLoading label={`Carregando ${active.label}`} />}>
                <ActiveComponent />
              </Suspense>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border-2 p-8">
              <p className="font-body text-text-mid">Selecione uma configuração.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
