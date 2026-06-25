'use client';

/**
 * <ContactPanel> — cadastro vivo do contato, reutilizável (F47-S06).
 *
 * Surface-agnóstico de propósito: o Cockpit do LiveChat usa `editable`; a Pipeline
 * e a página de Contatos (S09) reusam read-only. Nada aqui sabe onde está montado.
 *
 * Renderiza: nome, telefone, e-mail, documento (CPF/CNPJ), endereço (ViaCEP via
 * <AddressForm>), custom_fields (F43, por nicho) e um RESUMO FINANCEIRO derivado
 * dos agregados que `GET /api/contacts/:id` já devolve (deals + conversions).
 *
 * UX:
 *  §2.1 — editar é ação no corpo: o painel inteiro alterna para modo edição por um
 *         botão "Editar" no header da seção, e os campos viram inputs — não há
 *         engrenagem escondendo a ação principal.
 *  §2.6 — endereço vazio mostra CTA "Adicionar endereço".
 *  §2.7 — save com loading + toast; skeleton enquanto carrega o contato.
 *  §2.11 — erro de carga em 3 partes (via <ErrorState>); erro de CEP no <AddressForm>.
 *  §8 (mobile) — inputs ≥16px (globals.css), alvos generosos; roda dentro do Sheet.
 *
 * Gate de edição: `editable` (intenção da surface) ∧ `contact.edit` (autoridade).
 * Esconder controles é UX — a autoridade real é backend + RLS.
 */

import { useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  FileText,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Tag,
  User,
  X,
} from 'lucide-react';
import { Button, Input, useToast } from '@hm/ui';
import { can } from '@hm/shared';
import { cn } from '@/shared/lib/cn';
import { useAuthStore } from '@/shared/stores/auth.store';
import { ApiError } from '@/shared/lib/api-client';
import { ErrorState, Skeleton } from '@/shared/components/feedback';
import type { ContactAddress, ContactDeal, ContactConversion } from '../types';
import { useContact, useUpdateContact } from '../queries';
import { AddressForm } from './AddressForm';

/** Rótulos amigáveis dos campos do cadastro (último segmento do path da issue). */
const FIELD_LABELS: Record<string, string> = {
  cep: 'CEP',
  state: 'UF',
  street: 'Rua',
  number: 'Número',
  complement: 'Complemento',
  district: 'Bairro',
  city: 'Cidade',
  document: 'Documento',
  phone: 'Telefone',
  email: 'E-mail',
  displayName: 'Nome',
};

/**
 * Descrição acionável do erro de save (§2.11): se o backend mandou `issues` do
 * Zod, mostra "Campo: motivo" por campo; senão a `message`; senão um fallback.
 */
function describeSaveError(err: unknown): string {
  if (err instanceof ApiError && err.issues && err.issues.length > 0) {
    return err.issues
      .map((i) => {
        const key = String(i.path[i.path.length - 1] ?? '');
        const label = FIELD_LABELS[key] ?? key;
        return label ? `${label}: ${i.message}` : i.message;
      })
      .join(' · ');
  }
  if (err instanceof ApiError && err.message) return err.message;
  return 'Tente novamente em instantes.';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const currencyFmt = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

function formatCents(cents: number, currency = 'BRL'): string {
  if (currency !== 'BRL') {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  }
  return currencyFmt.format(cents / 100);
}

function isAddressEmpty(a: ContactAddress | undefined | null): boolean {
  if (!a) return true;
  return !(a.cep || a.street || a.number || a.complement || a.district || a.city || a.state);
}

/**
 * Normaliza o address do draft para envio: campos vazios (`''`) viram `undefined`
 * em vez de string vazia — o backend rejeita `cep: ''`/`state: ''` com 400 (bug_006).
 * Espelha o tratamento de phone/email/document (vazio → null).
 */
function normalizeAddress(a: ContactAddress): ContactAddress {
  const clean = (s: string | undefined): string | undefined => {
    const t = s?.trim();
    return t ? t : undefined;
  };
  return {
    cep: clean(a.cep),
    street: clean(a.street),
    number: clean(a.number),
    complement: clean(a.complement),
    district: clean(a.district),
    city: clean(a.city),
    state: clean(a.state),
  };
}

/** Resumo financeiro: total fechado/ganho, nº de deals e ticket médio. */
function financialSummary(deals: ContactDeal[], conversions: ContactConversion[]) {
  // Total convertido = soma das conversões válidas (não canceladas) com valor.
  const convertedCents = conversions
    .filter((c) => c.cancelledAt === null && typeof c.valueCents === 'number')
    .reduce((sum, c) => sum + (c.valueCents ?? 0), 0);

  // Deals ganhos (closed won) — base do ticket médio do cliente.
  const wonDeals = deals.filter((d) => d.closedWon === true);
  const wonCents = wonDeals.reduce((sum, d) => sum + d.valueCents, 0);
  const dealCount = deals.length;
  const avgTicketCents = wonDeals.length > 0 ? Math.round(wonCents / wonDeals.length) : 0;

  return { convertedCents, dealCount, wonCount: wonDeals.length, avgTicketCents };
}

// ── Linha de campo (read-only) ─────────────────────────────────────────────────

function FieldRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | null | undefined;
}) {
  const has = !!value && value.length > 0;
  return (
    <div className="flex items-center gap-3">
      {/* Tile de ícone — identifica o tipo da informação num relance (scan rápido). */}
      <span
        className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-3 text-text-mid"
        aria-hidden
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-body text-[0.65rem] uppercase tracking-wide text-text-low">{label}</p>
        <p
          className={cn(
            'truncate font-body text-sm font-medium',
            has ? 'text-text' : 'text-text-low',
          )}
        >
          {has ? value : '—'}
        </p>
      </div>
    </div>
  );
}

// ── Custom fields (F43, por nicho) — render genérico ────────────────────────────

function CustomFields({ fields }: { fields: Record<string, unknown> }) {
  const entries = Object.entries(fields).filter(([, v]) => v != null && v !== '');
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-col gap-2.5 border-t border-border-2 pt-3">
      {entries.map(([key, raw]) => (
        <FieldRow key={key} icon={Tag} label={key} value={String(raw)} />
      ))}
    </div>
  );
}

// ── Componente principal ────────────────────────────────────────────────────────

export interface ContactPanelProps {
  contactId: string;
  /**
   * Intenção da surface: `true` no Cockpit (edição inline), `false`/omitido nas
   * superfícies de leitura (Pipeline, Contatos). A edição só aparece de fato se o
   * papel tiver `contact.edit`.
   */
  editable?: boolean;
}

interface DraftState {
  displayName: string;
  phone: string;
  email: string;
  document: string;
  address: ContactAddress;
}

export function ContactPanel({ contactId, editable = false }: ContactPanelProps) {
  const auth = useAuthStore((s) => s.auth);
  const { toast } = useToast();
  const { data, isLoading, isError, refetch } = useContact(contactId);
  const update = useUpdateContact();

  const role = auth?.role ?? null;
  const canEdit = editable && (role ? can(role, 'contact.edit') : false);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DraftState | null>(null);

  const summary = useMemo(
    () => financialSummary(data?.deals ?? [], data?.conversions ?? []),
    [data?.deals, data?.conversions],
  );

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  // ── Error (3 partes) ─────────────────────────────────────────────────────────
  if (isError || !data) {
    return (
      <ErrorState
        title="Não foi possível carregar o cadastro"
        reason="A consulta ao contato falhou."
        whatToDo="Verifique a conexão e tente novamente."
        action={
          <Button variant="secondary" size="sm" onClick={() => void refetch()}>
            Tentar de novo
          </Button>
        }
      />
    );
  }

  const contact = data.contact;
  const addressEmpty = isAddressEmpty(contact.address);

  function startEdit(seedAddress?: ContactAddress): void {
    setDraft({
      displayName: contact.displayName ?? '',
      phone: contact.phone ?? '',
      email: contact.email ?? '',
      document: contact.document ?? '',
      address: seedAddress ?? contact.address ?? {},
    });
    setEditing(true);
  }

  function cancelEdit(): void {
    setEditing(false);
    setDraft(null);
  }

  function save(): void {
    if (!draft || update.isPending) return;
    update.mutate(
      {
        id: contactId,
        patch: {
          displayName: draft.displayName.trim() || contact.displayName || '—',
          phone: draft.phone.trim() || null,
          email: draft.email.trim() || null,
          document: draft.document.trim() || null,
          address: normalizeAddress(draft.address),
        },
      },
      {
        onSuccess: () => {
          toast({ title: 'Cadastro atualizado', variant: 'success' });
          setEditing(false);
          setDraft(null);
        },
        onError: (err) =>
          toast({
            title: 'Falha ao salvar cadastro',
            // Surface o motivo do backend (validação Zod por campo via `issues`) em
            // vez de um texto genérico — o usuário sabe qual campo corrigir (§2.11).
            description: describeSaveError(err),
            variant: 'error',
          }),
      },
    );
  }

  // ── Modo edição ──────────────────────────────────────────────────────────────
  if (editing && draft) {
    return (
      <div className="flex flex-col gap-4">
        <Input
          label="Nome"
          value={draft.displayName}
          onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
        />
        <Input
          label="Telefone"
          inputMode="tel"
          autoComplete="tel"
          value={draft.phone}
          onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
        />
        <Input
          label="E-mail"
          type="email"
          autoComplete="email"
          value={draft.email}
          onChange={(e) => setDraft({ ...draft, email: e.target.value })}
        />
        <Input
          label="Documento (CPF/CNPJ)"
          inputMode="numeric"
          placeholder="Apenas números"
          value={draft.document}
          onChange={(e) => setDraft({ ...draft, document: e.target.value })}
        />

        <div className="border-t border-border-2 pt-3">
          <p className="mb-2 font-body text-xs font-medium text-text-low">Endereço</p>
          <AddressForm
            value={draft.address}
            onChange={(address) => setDraft({ ...draft, address })}
          />
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            loading={update.isPending}
            leftIcon={<Check className="size-3.5" aria-hidden />}
            onClick={save}
          >
            Salvar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={update.isPending}
            leftIcon={<X className="size-3.5" aria-hidden />}
            onClick={cancelEdit}
          >
            Cancelar
          </Button>
        </div>
      </div>
    );
  }

  // ── Modo leitura ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">
      {/* Header + ação de edição no corpo da seção (§2.1) */}
      {canEdit && (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<Pencil className="size-3.5" aria-hidden />}
            onClick={() => startEdit()}
          >
            Editar
          </Button>
        </div>
      )}

      {/* Dados gerais */}
      <div className="flex flex-col gap-2.5">
        <FieldRow icon={User} label="Nome" value={contact.displayName} />
        <FieldRow icon={Phone} label="Telefone" value={contact.phone} />
        <FieldRow icon={Mail} label="E-mail" value={contact.email} />
        <FieldRow icon={FileText} label="Documento" value={contact.document} />
      </div>

      {/* Endereço */}
      <div className="border-t border-border-2 pt-3">
        <div className="mb-2 flex items-center gap-1.5">
          <MapPin className="size-3.5 text-text-low" aria-hidden />
          <span className="font-body text-xs font-medium text-text-low">Endereço</span>
        </div>
        {addressEmpty ? (
          canEdit ? (
            // Empty state com CTA (§2.6)
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<MapPin className="size-3.5" aria-hidden />}
              onClick={() => startEdit({})}
            >
              Adicionar endereço
            </Button>
          ) : (
            <p className="font-body text-sm text-text-low">Sem endereço cadastrado.</p>
          )
        ) : (
          <AddressForm value={contact.address} onChange={() => undefined} editable={false} />
        )}
      </div>

      {/* Custom fields (por nicho) */}
      <CustomFields fields={contact.customFields} />

      {/* Resumo financeiro */}
      <div className="border-t border-border-2 pt-3">
        <p className="mb-2 font-body text-xs font-medium text-text-low">Resumo financeiro</p>
        {summary.dealCount === 0 && summary.convertedCents === 0 ? (
          <div className="flex items-start gap-2 rounded-sm border border-border-2 bg-surface-2 px-3 py-2">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-text-low" aria-hidden />
            <p className="font-body text-xs text-text-mid">
              Ainda sem negócios ou conversões para este cliente.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <FinancialStat
              label="Convertido"
              value={formatCents(summary.convertedCents)}
              highlight
            />
            <FinancialStat label="Negócios" value={String(summary.dealCount)} />
            <FinancialStat label="Ticket médio" value={formatCents(summary.avgTicketCents)} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Stat do resumo financeiro ────────────────────────────────────────────────────

function FinancialStat({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-sm border border-border-2 bg-surface-2 px-2.5 py-2">
      <span className="font-body text-[0.65rem] uppercase tracking-wide text-text-low">
        {label}
      </span>
      <span
        className={
          highlight
            ? 'font-price text-sm font-semibold text-brand'
            : 'font-price text-sm font-semibold text-text'
        }
      >
        {value}
      </span>
    </div>
  );
}
