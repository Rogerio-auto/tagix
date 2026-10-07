'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Clock, CreditCard, Lock, MailPlus, X, type LucideIcon } from 'lucide-react';
import { create } from 'zustand';
import { cn } from '@/shared/lib/cn';
import { useAuthStore } from '@/shared/stores/auth.store';
import { BILLING_HREF, pickAccountBanner, type AccountBannerModel } from './banner-priority';
import { usePendingInvites } from './useInvites';

type Tone = 'danger' | 'warn' | 'info';

const TONE: Record<Tone, { bar: string; icon: string }> = {
  danger: { bar: 'border-danger/30 bg-danger/10', icon: 'bg-danger/15 text-danger' },
  warn: { bar: 'border-warn/30 bg-warn/10', icon: 'bg-warn/15 text-warn' },
  info: { bar: 'border-info/30 bg-info/10', icon: 'bg-info/15 text-info' },
};

/** Faixas dispensáveis (trial/convite) que a pessoa já fechou nesta tela. */
const useDismissed = create<{ keys: ReadonlySet<string>; dismiss: (key: string) => void }>(
  (set) => ({
    keys: new Set<string>(),
    dismiss: (key) => set((s) => ({ keys: new Set([...s.keys, key]) })),
  }),
);

interface BannerView {
  tone: Tone;
  icon: LucideIcon;
  message: string;
  cta?: { label: string; href: string };
  /** Chave de dispensa; ausente = a faixa não pode ser fechada. */
  dismissKey?: string;
}

function viewFor(model: AccountBannerModel, workspaceId: string): BannerView {
  switch (model.kind) {
    case 'read_only':
      return {
        tone: 'danger',
        icon: Lock,
        message: 'Sua empresa está em modo só leitura. Escolha um plano para voltar a editar.',
        cta: { label: 'Escolher plano', href: BILLING_HREF },
      };
    case 'trial_ending':
      return {
        tone: 'warn',
        icon: Clock,
        message:
          model.days === 1
            ? 'Seu teste termina em 1 dia.'
            : `Seu teste termina em ${model.days} dias.`,
        cta: { label: 'Escolher plano', href: BILLING_HREF },
        dismissKey: `trial:${workspaceId}:${model.days}`,
      };
    case 'past_due':
      return {
        tone: 'warn',
        icon: CreditCard,
        message: 'Pagamento pendente. Regularize para não perder o acesso.',
        cta: { label: 'Ver pagamento', href: BILLING_HREF },
      };
    case 'invite': {
      const more =
        model.others > 0
          ? ` Mais ${model.others} ${model.others === 1 ? 'convite' : 'convites'}.`
          : '';
      return {
        tone: 'info',
        icon: MailPlus,
        message: `Você foi convidado para ${model.invite.workspaceName}.${more}`,
        dismissKey: `invite:${model.invite.id}`,
      };
    }
  }
}

/**
 * Faixa de conta no topo do shell (F71-S08). UMA por vez, por prioridade (ver
 * `pickAccountBanner`). Cobrança não pode ser fechada — só some quando a situação
 * muda; trial e convite podem ser dispensados. O convite não tem CTA de aceitar
 * porque a API só aceita pelo token do link do email: o botão explica onde ele está.
 */
export function AccountBanner() {
  const workspace = useAuthStore((s) => s.workspace);
  const invites = usePendingInvites();
  const dismissed = useDismissed((s) => s.keys);
  const dismiss = useDismissed((s) => s.dismiss);
  const [howOpen, setHowOpen] = useState(false);

  const model = pickAccountBanner({ workspace, invites, now: Date.now() });
  if (!model) return null;
  const view = viewFor(model, workspace?.id ?? '');
  const { dismissKey } = view;
  if (dismissKey && dismissed.has(dismissKey)) return null;

  const tone = TONE[view.tone];
  const Icon = view.icon;
  const isInvite = model.kind === 'invite';
  // Visual de 32 px (a faixa é discreta), área de toque de 44 px: o `::after` estende
  // o alvo 6 px para cada lado sem crescer a faixa (alvo mínimo no mobile, UX §mobile).
  const hitArea = 'relative after:absolute after:-inset-1.5';
  const actionClass = cn(
    hitArea,
    'inline-flex h-8 shrink-0 items-center rounded-sm border border-border bg-surface px-3 font-head text-xs font-medium text-text outline-none transition-colors duration-150 hover:bg-surface-2 focus-visible:shadow-glow-md',
  );

  // `pt-safe`: a faixa é o topo da tela no mobile; com `viewport-fit=cover` ficaria sob
  // o notch sem a safe-area (env = 0 fora de notch e no desktop).
  return (
    <section
      aria-label="Aviso da conta"
      data-banner={model.kind}
      className={cn('shrink-0 border-b pt-safe', tone.bar)}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 md:px-8">
        <span
          aria-hidden
          className={cn('grid size-7 shrink-0 place-items-center rounded-sm', tone.icon)}
        >
          <Icon className="size-4" />
        </span>
        <p className="min-w-0 flex-1 basis-60 font-head text-sm text-text">{view.message}</p>
        {view.cta && (
          <Link href={view.cta.href} className={actionClass}>
            {view.cta.label}
          </Link>
        )}
        {isInvite && (
          <button
            type="button"
            aria-expanded={howOpen}
            aria-controls="account-banner-invite-how"
            onClick={() => setHowOpen((v) => !v)}
            className={actionClass}
          >
            Ver como entrar
          </button>
        )}
        {dismissKey && (
          <button
            type="button"
            aria-label="Dispensar aviso"
            onClick={() => dismiss(dismissKey)}
            className={cn(hitArea, 'grid size-8 shrink-0 place-items-center rounded-sm text-text-mid outline-none transition-colors duration-150 hover:bg-surface-2 hover:text-text focus-visible:shadow-glow-md')}
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
      {isInvite && howOpen && (
        <p
          id="account-banner-invite-how"
          className="border-t border-border/60 px-4 py-2 text-xs text-text-mid md:px-8"
        >
          Abra o link que enviamos para o seu email para aceitar o convite. Não encontrou? Veja a
          caixa de spam ou peça um novo convite a quem convidou você.
        </p>
      )}
    </section>
  );
}
