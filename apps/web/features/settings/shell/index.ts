/**
 * Shell do painel de configurações (F8-S05). Dono do SectionRegistry + layout. Slots
 * de seção (S04/S06/S07/S08) preenchem `features/settings/sections/<x>/**` e plugam
 * no registry — sem tocar o shell.
 */
export { SettingsPanel } from './SettingsPanel';
export {
  SETTINGS_SECTIONS,
  SETTINGS_GROUP_LABEL,
  SETTINGS_GROUP_ORDER,
  findSection,
  type SettingsSection,
  type SettingsGroup,
  type CounterState,
} from './registry';
export { SectionStub } from './SectionStub';
