import { ApiError } from '@/shared/lib/api-client';
import type { InvitesApi } from './api';
import type { CreateInviteInput } from './types';

/** Descrição de um toast + se a UI deve oferecer o CTA de upgrade. */
export interface Outcome {
  variant: 'success' | 'error' | 'warn' | 'info';
  title: string;
  description?: string;
  /** `402 seat_limit`: oferecer "Ver plano" (billing). */
  billingCta?: boolean;
}

export type InviteErrorContext = 'create' | 'resend' | 'revoke' | 'link' | 'reactivate';

const FALLBACK_TITLES: Record<InviteErrorContext, string> = {
  create: 'Não foi possível criar o convite',
  resend: 'Não foi possível reenviar',
  revoke: 'Não foi possível revogar',
  link: 'Não foi possível copiar o link',
  reactivate: 'Não foi possível reativar',
};

/**
 * Traduz o erro da API em texto de 3 partes (o quê / por quê / o que fazer, UX §2.11).
 * O código estável (`err.code`) decide — nunca a mensagem do servidor.
 */
export function describeInviteError(err: unknown, ctx: InviteErrorContext): Outcome {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'seat_limit':
        return {
          variant: 'error',
          title: 'Limite de membros atingido',
          description:
            ctx === 'reactivate'
              ? 'O plano não tem vaga para reativar esta pessoa. Faça upgrade ou remova alguém.'
              : 'Convites pendentes ocupam vagas. Faça upgrade do plano ou revogue um convite.',
          billingCta: true,
        };
      case 'already_member':
        return {
          variant: 'warn',
          title: 'Essa pessoa já faz parte da empresa',
          description: 'Procure por ela na lista de membros.',
        };
      case 'member_blocked':
        return {
          variant: 'error',
          title: 'Esta pessoa está bloqueada',
          description: 'Desbloqueie o membro antes de enviar um novo convite.',
        };
      case 'invite_pending':
        return {
          variant: 'warn',
          title: 'Já existe um convite pendente',
          description: 'Reenvie ou copie o link na lista de convites.',
        };
      case 'resend_cooldown':
      case 'send_cooldown':
        return {
          variant: 'warn',
          title: 'Aguarde um minuto para reenviar',
          description: 'O último email saiu agora há pouco. Se não chegou, copie o link.',
        };
      case 'send_limit':
        return {
          variant: 'warn',
          title: 'Limite de envios atingido',
          description: 'Este convite já foi enviado várias vezes. Copie o link e envie por outro canal.',
        };
      case 'invite_rate_limited':
        return {
          variant: 'warn',
          title: 'Muitos convites na última hora',
          description: 'Tente de novo em instantes ou copie os links dos convites já criados.',
        };
      case 'invite_not_found':
        return {
          variant: 'info',
          title: 'Esse convite não existe mais',
          description: 'Ele foi aceito ou revogado. A lista foi atualizada.',
        };
      case 'link_unavailable':
        return {
          variant: 'error',
          title: 'Não foi possível gerar o link',
          description: 'O endereço público do app não está configurado. Fale com o suporte.',
        };
      case 'invite_quota_unavailable':
      case 'send_unavailable':
        return {
          variant: 'error',
          title: 'Envio indisponível agora',
          description: 'Tente novamente em alguns minutos.',
        };
      case 'owner_not_invitable':
      case 'invalid_role':
        return { variant: 'error', title: 'Papel inválido', description: 'Escolha outro papel.' };
      case 'invalid_department':
        return {
          variant: 'error',
          title: 'Departamento inválido',
          description: 'Escolha outro departamento.',
        };
      case 'impersonation_read_only':
        return {
          variant: 'warn',
          title: 'Modo de visualização',
          description: 'Não é possível alterar convites enquanto você vê como outra pessoa.',
        };
      default:
        break;
    }
    if (err.status === 400) {
      return {
        variant: 'error',
        title: 'Confira os dados',
        description: 'O email ou o papel não foram aceitos.',
      };
    }
  }
  return {
    variant: 'error',
    title: FALLBACK_TITLES[ctx],
    description: 'Algo deu errado do nosso lado. Tente novamente.',
  };
}

/** Resultado de criar/reenviar. Toast de sucesso SÓ com `delivery:'sent'`. */
export function outcomeForDelivery(
  delivery: 'sent' | 'failed',
  email: string,
  resent = false,
): Outcome {
  if (delivery === 'sent') {
    return {
      variant: 'success',
      title: resent ? `Convite reenviado para ${email}` : `Convite enviado para ${email}`,
    };
  }
  return {
    variant: 'warn',
    title: 'Convite criado, mas o email não saiu',
    description: 'Copie o link do convite na lista e envie por outro canal.',
  };
}

export async function runCreate(
  api: Pick<InvitesApi, 'create'>,
  input: CreateInviteInput,
): Promise<Outcome & { ok: boolean }> {
  try {
    const res = await api.create(input);
    return { ...outcomeForDelivery(res.delivery, res.invite.email, res.resent === true), ok: true };
  } catch (err) {
    return { ...describeInviteError(err, 'create'), ok: false };
  }
}

export async function runResend(
  api: Pick<InvitesApi, 'resend'>,
  id: string,
  email: string,
): Promise<Outcome> {
  try {
    const res = await api.resend(id);
    return outcomeForDelivery(res.delivery, email, true);
  } catch (err) {
    return describeInviteError(err, 'resend');
  }
}

export async function runRevoke(
  api: Pick<InvitesApi, 'revoke'>,
  id: string,
  email: string,
): Promise<Outcome> {
  try {
    await api.revoke(id);
    return {
      variant: 'success',
      title: 'Convite revogado',
      description: `O link enviado para ${email} deixou de funcionar.`,
    };
  } catch (err) {
    return describeInviteError(err, 'revoke');
  }
}

export interface Clipboard {
  writeText: (text: string) => Promise<void>;
}

export interface CopyResult {
  outcome: Outcome;
  /** Preenchido quando o clipboard falhou: a UI mostra o link para copiar à mão. */
  manualUrl?: string;
}

/**
 * Gera o link (troca o token: o link do email morre) e copia. Se a área de
 * transferência recusar (Safari perde o gesto após o `await`), devolve a URL para a
 * UI exibir — o link nunca fica só no clipboard.
 */
export async function runCopyLink(
  api: Pick<InvitesApi, 'link'>,
  clipboard: Clipboard | null,
  id: string,
): Promise<CopyResult> {
  try {
    const { url } = await api.link(id);
    if (clipboard) {
      try {
        await clipboard.writeText(url);
        return {
          outcome: {
            variant: 'success',
            title: 'Link copiado',
            description: 'O link anterior deste convite deixou de valer.',
          },
        };
      } catch {
        /* cai no manual */
      }
    }
    return {
      outcome: {
        variant: 'info',
        title: 'Copie o link abaixo',
        description: 'O navegador não permitiu copiar sozinho.',
      },
      manualUrl: url,
    };
  } catch (err) {
    return { outcome: describeInviteError(err, 'link') };
  }
}
