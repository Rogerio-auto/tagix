/** Tipos da feature de disponibilidade (F7-S07). Espelham a API de F7-S02. */

export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface AvailabilityRule {
  id: string;
  workspaceId: string;
  memberId: string;
  name: string;
  dayOfWeek: number;
  startTime: string; // HH:MM[:SS]
  endTime: string;
  isAvailable: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string | null;
}

/** Item enviado no PUT bulk de regras. */
export interface RuleInput {
  name: string;
  dayOfWeek: number;
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  isAvailable?: boolean;
  isActive?: boolean;
}

export interface AvailabilityException {
  id: string;
  workspaceId: string;
  memberId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  isAvailable: boolean;
  reason: string | null;
  createdAt: string;
}

export interface ExceptionInput {
  startDate: string;
  endDate: string;
  startTime?: string | null;
  endTime?: string | null;
  isAllDay?: boolean;
  isAvailable?: boolean;
  reason?: string | null;
}

export interface AvailabilitySlot {
  startAt: string;
  endAt: string;
  durationMinutes: number;
}
