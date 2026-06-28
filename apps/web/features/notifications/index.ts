/**
 * Central de notificações in-app (F53-S06). Consome o evento socket
 * `appointment:due` (F53-S05): lembretes persistentes até descartar/concluir,
 * sino na TopBar e som configurável (prefs com fonte da verdade no servidor).
 */
export { NotificationBell } from './NotificationBell';
export { NotificationCenter } from './NotificationCenter';
export { useNotificationsStore, groupByContact } from './store';
export { DEFAULT_SOUND_PREFS } from './types';
export type { AppNotification, NotificationGroup, NotificationSoundPrefs } from './types';
