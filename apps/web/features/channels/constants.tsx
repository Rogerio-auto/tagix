import { Instagram, Mail, MessageCircle, QrCode, type LucideIcon } from 'lucide-react';
import type { ChannelProvider } from './types';

export interface ProviderMeta {
  provider: ChannelProvider;
  label: string;
  /** Descrição curta para o seletor do assistente. */
  blurb: string;
  icon: LucideIcon;
}

export const PROVIDER_META: Record<ChannelProvider, ProviderMeta> = {
  meta_whatsapp: {
    provider: 'meta_whatsapp',
    label: 'WhatsApp (Meta)',
    blurb: 'API oficial do WhatsApp Cloud via login da Meta.',
    icon: MessageCircle,
  },
  meta_instagram: {
    provider: 'meta_instagram',
    label: 'Instagram (Meta)',
    blurb: 'Mensagens diretas do Instagram via login da Meta.',
    icon: Instagram,
  },
  waha: {
    provider: 'waha',
    label: 'WhatsApp (WAHA)',
    blurb: 'Sessão não-oficial do WhatsApp via WAHA.',
    icon: QrCode,
  },
  email: {
    provider: 'email',
    label: 'E-mail',
    blurb: 'Conversas por e-mail na mesma inbox, encadeadas por thread.',
    icon: Mail,
  },
};

export const PROVIDER_ORDER: readonly ChannelProvider[] = [
  'meta_whatsapp',
  'meta_instagram',
  'email',
  'waha',
];
