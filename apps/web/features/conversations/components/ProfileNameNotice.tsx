'use client';

/**
 * Nome do perfil do canal no cockpit (F70-S37).
 *
 * Mostra "Nome no WhatsApp: X" quando o perfil traz um nome diferente do salvo no
 * sistema. Sem nome no sistema, oferece "Usar este nome" (grava em `display_name`
 * pelo endpoint de edição de contato). UX §2.7: botão em loading; §2.9: ação
 * reversível (edita-se de novo no cadastro), sem confirmação extra.
 */

import { useQueryClient } from '@tanstack/react-query';
import { UserCheck } from 'lucide-react';
import { Button, useToast } from '@hm/ui';
import { can } from '@hm/shared';
import { useAuthStore } from '@/shared/stores/auth.store';
import { useUpdateContact } from '@/features/contacts/queries';
import { clean } from '../contact-label';
import type { ConversationContact } from '../types';

export function channelNameLabel(channel: string | null | undefined): string {
  return typeof channel === 'string' && channel.toLowerCase().includes('instagram')
    ? 'Instagram'
    : 'WhatsApp';
}

/** Verdadeiro quando há nome de perfil útil e ele difere do nome do sistema. */
export function shouldShowProfileName(contact: ConversationContact | null): boolean {
  const profile = clean(contact?.profileName);
  if (profile === null) return false;
  const system = clean(contact?.displayName);
  if (system === null) return true;
  return profile.localeCompare(system, 'pt-BR', { sensitivity: 'base' }) !== 0;
}

export function ProfileNameNotice({
  contact,
  channel,
}: {
  contact: ConversationContact | null;
  channel: string | null | undefined;
}) {
  const auth = useAuthStore((s) => s.auth);
  const { toast } = useToast();
  const update = useUpdateContact();
  const queryClient = useQueryClient();

  if (!contact || !shouldShowProfileName(contact)) return null;

  const id = contact.id;
  const profile = clean(contact.profileName) ?? '';
  const hasSystemName = clean(contact.displayName) !== null;
  const role = auth?.role ?? null;
  const canEdit = role ? can(role, 'contact.edit') : false;

  function applyProfileName(): void {
    if (update.isPending) return;
    update.mutate(
      { id, patch: { displayName: profile } },
      {
        onSuccess: () => {
          // Lista = ['conversations', …]; detalhe/mensagens = ['conversation', id, …].
          void queryClient.invalidateQueries({ queryKey: ['conversations'] });
          void queryClient.invalidateQueries({ queryKey: ['conversation'] });
          toast({ title: 'Nome salvo no cadastro', variant: 'success' });
        },
        onError: () => toast({ title: 'Não foi possível salvar o nome', variant: 'error' }),
      },
    );
  }

  return (
    <div className="mb-3 flex items-center justify-between gap-2 rounded-md border border-border bg-surface-2 px-3 py-2">
      <p className="min-w-0 font-body text-xs text-text-low">
        Nome no {channelNameLabel(channel)}:{' '}
        <span className="font-medium text-text">{profile}</span>
      </p>
      {!hasSystemName && canEdit && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          loading={update.isPending}
          leftIcon={<UserCheck className="size-3.5" aria-hidden />}
          onClick={applyProfileName}
        >
          Usar este nome
        </Button>
      )}
    </div>
  );
}
