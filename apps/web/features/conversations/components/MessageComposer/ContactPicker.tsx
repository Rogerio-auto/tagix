'use client';

/**
 * Compartilhar um contato do workspace numa conversa (F45-S07 — RICH_COMPOSER §1,§3).
 * Painel embutido no `AttachmentMenu`: busca → seleciona UM contato → confirma →
 * envia `type:'contact'` com `payload:{ contacts:[{ name, phones[], emails? }] }`.
 *
 * Fronteira: este painel NÃO recebe `conversationId` por prop (o ponto de montagem
 * das opções vive no `MessageComposer`, fora deste slot). Em vez de cruzar a
 * fronteira, deriva o id da ROTA `/conversations/[id]` via `useParams` — fonte
 * confiável: o composer só monta quando há conversa ativa, e a navegação da lista
 * é sempre por `<Link href="/conversations/:id">`, então o param === conversa ativa.
 *
 * Reusa a query pública de contatos (`useContacts`, somente leitura — RLS no
 * backend) e a mutation `useSendMessage` (que ESPALHA `payload` no corpo do POST;
 * aninhar `{ payload: { contacts } }` produz a chave `payload` que a rota valida).
 *
 * UX: busca dentro do popover; confirma antes de enviar (seleção → botão dedicado);
 * loading/empty/error com saída; feedback imediato (botão em loading).
 * DS v2: zero hex, só tokens; foco `focus-visible:shadow-glow-md`; alvos ≥44px.
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Check, Loader2, Mail, Phone, SearchX, SendHorizontal, User, X } from 'lucide-react';
import { useToast } from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import { ApiError } from '@/shared/lib/api-client';
import { useContacts } from '@/features/contacts/queries';
import type { Contact } from '@/features/contacts/types';
import { useSendMessage } from '../../queries';

export interface ContactPickerProps {
  /** Fecha o menu de anexo após o envio bem-sucedido. */
  readonly onSent: () => void;
}

/** Rótulo legível do contato (cai p/ telefone quando não há nome). */
function contactName(contact: Contact): string {
  const name = contact.displayName?.trim();
  if (name) return name;
  const phone = contact.phone?.trim();
  return phone && phone !== '' ? phone : 'Contato sem nome';
}

/** Telefone normalizado p/ o cartão (a Graph exige ≥1 telefone) ou `null`. */
function contactPhone(contact: Contact): string | null {
  const phone = contact.phone?.trim();
  return phone && phone !== '' ? phone : null;
}

export function ContactPicker({ onSent }: ContactPickerProps) {
  const params = useParams();
  const rawId = params['id'];
  const conversationId = typeof rawId === 'string' ? rawId : null;

  const { toast } = useToast();
  const send = useSendMessage();

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Debounce da busca (300ms) — evita uma chamada por tecla; limpa no unmount.
  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(handle);
  }, [search]);

  const query = useContacts({ q: debounced || undefined, sort: 'name', pageSize: 8 });
  const contacts = query.data?.contacts ?? [];

  const selected = useMemo(
    () => contacts.find((c) => c.id === selectedId) ?? null,
    [contacts, selectedId],
  );
  const selectedPhone = selected ? contactPhone(selected) : null;
  const canSend = conversationId !== null && selected !== null && selectedPhone !== null && !send.isPending;

  const submit = async () => {
    if (selected === null || selectedPhone === null || conversationId === null || send.isPending) {
      return;
    }
    const name = contactName(selected);
    const email = selected.email?.trim();
    const card = {
      name,
      phones: [selectedPhone],
      ...(email && email !== '' ? { emails: [email] } : {}),
    };
    try {
      // Ponte S02/S03: `useSendMessage` ESPALHA `payload` no corpo do POST e a
      // rota lê `body.payload` (validado por `contactsPayloadSchema`). Aninhar
      // `{ payload: { contacts } }` produz a chave `payload` esperada no corpo.
      // `content` = nome p/ a bolha otimista; o backend recompõe o mesmo content.
      await send.mutateAsync({
        conversationId,
        content: name,
        type: 'contact',
        payload: { payload: { contacts: [card] } },
      });
      onSent();
    } catch (err) {
      const ref = err instanceof ApiError ? err.ref : undefined;
      toast({
        variant: 'error',
        title: 'Não foi possível enviar o contato',
        description:
          err instanceof ApiError
            ? `${err.message}${ref ? ` (ref ${ref})` : ''}`
            : 'Algo deu errado ao enviar. Tente novamente.',
      });
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Busca dentro do popover (UX §2). */}
      <div className="relative">
        <User className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-text-low" aria-hidden />
        <input
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setSelectedId(null);
          }}
          placeholder="Buscar contato…"
          aria-label="Buscar contato"
          autoFocus
          className={cn(
            'w-full rounded-md border border-border-2 bg-surface-inset py-2 pr-2 pl-8 font-body text-sm text-text outline-none',
            'placeholder:text-text-low focus-visible:border-border focus-visible:shadow-glow-md',
          )}
        />
        {search !== '' && (
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setSelectedId(null);
            }}
            aria-label="Limpar busca"
            className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-sm text-text-mid outline-none transition-colors hover:text-text focus-visible:shadow-glow-md"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </div>

      <div className="max-h-56 overflow-y-auto" role="listbox" aria-label="Contatos">
        {query.isLoading ? (
          <ListNotice>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Carregando contatos…
          </ListNotice>
        ) : query.isError ? (
          <div className="flex flex-col items-start gap-1.5 px-1 py-3" role="alert">
            <span className="font-body text-xs text-danger">Não foi possível carregar os contatos.</span>
            <button
              type="button"
              onClick={() => void query.refetch()}
              className={cn(
                'rounded-sm px-1.5 py-0.5 font-body text-xs text-text-mid outline-none transition-colors',
                'hover:text-text hover:underline focus-visible:shadow-glow-md',
              )}
            >
              Tentar novamente
            </button>
          </div>
        ) : contacts.length === 0 ? (
          <ListNotice>
            <SearchX className="size-4" aria-hidden />
            {debounced ? 'Nenhum contato encontrado.' : 'Nenhum contato cadastrado.'}
          </ListNotice>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {contacts.map((contact) => {
              const isSelected = contact.id === selectedId;
              const phone = contactPhone(contact);
              return (
                <li key={contact.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => setSelectedId(contact.id)}
                    className={cn(
                      'touch-target flex w-full items-center gap-2.5 rounded-md px-2 text-left outline-none',
                      'transition-colors hover:bg-surface-3 focus-visible:shadow-glow-md',
                      isSelected && 'bg-surface-3',
                    )}
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-pill bg-surface-inset text-text-mid">
                      <User className="size-4" aria-hidden />
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-body text-sm text-text">{contactName(contact)}</span>
                      <span className="truncate font-body text-xs text-text-low">
                        {phone ?? 'Sem telefone'}
                      </span>
                    </span>
                    {isSelected && <Check className="ml-auto size-4 shrink-0 text-brand" aria-hidden />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Confirmação antes de enviar (UX §2): cartão do contato + ação dedicada. */}
      {selected && (
        <div className="flex flex-col gap-2 rounded-md border border-border-2 bg-surface-inset p-2">
          <span className="inline-flex items-center gap-1.5 truncate font-body text-sm font-medium text-text">
            <User className="size-4 shrink-0 text-text-mid" aria-hidden />
            {contactName(selected)}
          </span>
          {selectedPhone ? (
            <span className="inline-flex items-center gap-1.5 truncate font-body text-xs text-text-mid">
              <Phone className="size-3.5 shrink-0" aria-hidden />
              {selectedPhone}
            </span>
          ) : (
            <span className="font-body text-xs text-danger" role="alert">
              Este contato não tem telefone — o WhatsApp exige ao menos um número.
            </span>
          )}
          {selected.email && selected.email.trim() !== '' && (
            <span className="inline-flex items-center gap-1.5 truncate font-body text-xs text-text-mid">
              <Mail className="size-3.5 shrink-0" aria-hidden />
              {selected.email}
            </span>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={!canSend}
        aria-busy={send.isPending || undefined}
        className={cn(
          'flex items-center justify-center gap-1.5 rounded-md px-3 py-2 font-body text-sm outline-none',
          'transition-colors focus-visible:shadow-glow-md disabled:cursor-not-allowed disabled:opacity-40',
          canSend ? 'bg-brand text-text-on-brand hover:bg-brand-strong' : 'bg-surface-3 text-text-low',
        )}
      >
        {send.isPending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <SendHorizontal className="size-4" aria-hidden />
        )}
        Enviar contato
      </button>
    </div>
  );
}

/** Linha de aviso compacta (loading / vazio) dentro da lista. */
function ListNotice({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="flex items-center gap-2 px-1 py-3 font-body text-xs text-text-mid"
      role="status"
      aria-live="polite"
    >
      {children}
    </p>
  );
}
