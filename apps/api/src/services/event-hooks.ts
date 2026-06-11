/**
 * Wiring do seam onEventChanged (gap-fill orchestrator F7-S05, padrão F5).
 *
 * Liga o cancelamento de evento (event-service.cancelEvent) a seu side-effect de
 * notificação: para cada participante (organizer member + attendees), registra um
 * `audit_logs` 'event.cancelled' (rastreável). O sistema de notificação in-app/
 * email/WhatsApp pluga aqui na fase futura — sem tabela de notificações ainda, o
 * audit log é a fonte rastreável (mesmo padrão do reminder do organizer).
 *
 * Idempotente: registerEventHooks roda uma vez no boot do app. Best-effort: o seam
 * já isola erros (não derruba o cancelamento).
 */
import { eq } from 'drizzle-orm';
import { withWorkspace, schema } from '@hm/db';
import { onEventChanged, type EventChangeEvent } from './event-service';

const { eventParticipants, auditLogs } = schema;

let registered = false;

/** Registra os hooks do seam de eventos (cancel → notifica participantes). Idempotente. */
export function registerEventHooks(): void {
  if (registered) return;
  registered = true;

  onEventChanged(async (e: EventChangeEvent) => {
    if (e.kind !== 'cancelled') return;
    await withWorkspace(e.workspaceId, async (tx) => {
      const participants = await tx
        .select({
          memberId: eventParticipants.memberId,
          contactId: eventParticipants.contactId,
          role: eventParticipants.role,
        })
        .from(eventParticipants)
        .where(eq(eventParticipants.eventId, e.event.id));

      if (participants.length === 0) return;
      await tx.insert(auditLogs).values(
        participants.map((p) => ({
          workspaceId: e.workspaceId,
          actorMemberId: e.actor.memberId ?? null,
          actorType: 'system' as const,
          action: 'event.cancelled',
          resourceType: 'event',
          resourceId: e.event.id,
          metadata: {
            title: e.event.title,
            startAt: e.event.startAt instanceof Date ? e.event.startAt.toISOString() : e.event.startAt,
            participantRole: p.role,
            memberId: p.memberId,
            contactId: p.contactId,
          },
        })),
      );
    });
  });
}
