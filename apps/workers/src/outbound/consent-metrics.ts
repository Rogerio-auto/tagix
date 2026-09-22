/**
 * Métricas do portão de consentimento (F59-S05 — AGENCIA_PLAN §4.4).
 *
 * O motivo da recusa é enum estável de propósito: vira rótulo de métrica. Uma
 * recusa por `no_consent` subindo é problema de captação; por `quiet_hours`, de
 * agendamento; por `registration_pending`, de onboarding travado no 10DLC. São
 * três operações diferentes, e sem o rótulo elas viram um número só.
 */
import { getMeter } from '@hm/logger';
import type { ChannelProvider, OutboundDenyReason } from '@hm/shared';

const meter = getMeter('@hm/workers');

const denied = meter.createCounter('hm.outbound.denied', {
  description: 'Envios recusados pelo portão de consentimento, por motivo e canal.',
});

/** Conta uma recusa do portão. */
export function recordOutboundDenied(
  reason: OutboundDenyReason,
  channel: ChannelProvider,
): void {
  denied.add(1, { reason, channel });
}
