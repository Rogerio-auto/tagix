/**
 * Feature today. A antiga tela `/hoje` virou a Home (F72-S04): a fila de espera e a
 * agenda do dia vivem como blocos da Home; `/hoje` só redireciona.
 */
export { WaitingQueue } from './WaitingQueue';
export { TodayAgenda } from './TodayAgenda';
export { useToday, todayKeys } from './queries';
export { esperaEmTexto, esperaCurta } from './format';
export type { TodayPayload, WaitingLead, TodayAppointment, UrgencyBand } from './types';
