import {
  Activity,
  Bot,
  Boxes,
  Building2,
  CreditCard,
  Eye,
  Gauge,
  Headset,
  KeyRound,
  Layers,
  LifeBuoy,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import type { PlatformNavItem } from './nav-items';

/** Ícone de cada área do painel (sidebar, navegação mobile e hub). */
export const PLATFORM_ICONS: Record<PlatformNavItem['icon'], LucideIcon> = {
  models: Boxes,
  policies: SlidersHorizontal,
  secrets: KeyRound,
  usage: Gauge,
  tenants: Building2,
  plans: Layers,
  subscriptions: CreditCard,
  playground: Bot,
  impersonation: Eye,
  monitoring: Activity,
  help: LifeBuoy,
  support: Headset,
};
