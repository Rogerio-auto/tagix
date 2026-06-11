/** Tipos da feature de agenda (F7-S06). Espelham a API de F7-S02/S03. */

export type CalendarType = 'personal' | 'team' | 'workspace';

export type EventType = 'meeting' | 'demo' | 'follow_up' | 'task' | 'reminder' | 'other';

export type EventStatus = 'scheduled' | 'confirmed' | 'cancelled' | 'completed';

export interface CalendarRow {
  id: string;
  workspaceId: string;
  name: string;
  type: CalendarType;
  ownerId: string | null;
  teamId: string | null;
  color: string;
  description: string | null;
  timezone: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string | null;
}

export interface EventRow {
  id: string;
  workspaceId: string;
  calendarId: string;
  title: string;
  description: string | null;
  type: EventType;
  startAt: string;
  endAt: string;
  status: EventStatus;
  location: string | null;
  meetingUrl: string | null;
  contactId: string | null;
  dealId: string | null;
  conversationId: string | null;
  createdBy: string | null;
  createdByAgentId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string | null;
}

export interface EventParticipantRow {
  id: string;
  eventId: string;
  memberId: string | null;
  contactId: string | null;
  role: 'organizer' | 'attendee';
  rsvp: 'pending' | 'accepted' | 'declined' | 'tentative' | null;
  notifiedAt: string | null;
}

export interface CreateEventInput {
  calendarId: string;
  title: string;
  startAt: string; // ISO com offset
  endAt: string;
  type?: EventType;
  description?: string | null;
  location?: string | null;
  meetingUrl?: string | null;
  contactId?: string | null;
}

export interface UpdateEventInput {
  title?: string;
  startAt?: string;
  endAt?: string;
  type?: EventType;
  status?: Exclude<EventStatus, 'cancelled'>;
  description?: string | null;
  location?: string | null;
  meetingUrl?: string | null;
}
