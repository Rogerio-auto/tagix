/**
 * @hm/shared/mq/stats — contadores de observabilidade da malha AMQP (F56-S12).
 *
 * Contadores em memória, por processo. Servem para o /healthz e /metrics dos
 * workers (F56-S17) e para os testes provarem que backpressure/reconexão foram
 * de fato contabilizados. Sem dependências (importável por qualquer módulo do
 * dir `mq/` sem risco de ciclo).
 */

export interface MqStats {
  /** `publish`/`sendToQueue` retornou `false` (write buffer cheio — INF-12). */
  readonly publishBackpressure: number;
  /**
   * `ack`/`nack` descartado por pertencer a um canal anterior à reconexão
   * (delivery tag é por canal; o broker reentrega a mensagem não-ackada).
   */
  readonly staleDeliveriesDropped: number;
  /** Reconexões completas (conexão + canal + replay de setup) bem-sucedidas. */
  readonly reconnects: number;
  /** Recriações de canal sobre a mesma conexão (erro de canal, não de rede). */
  readonly channelRecreations: number;
}

const counters: { -readonly [K in keyof MqStats]: number } = {
  publishBackpressure: 0,
  staleDeliveriesDropped: 0,
  reconnects: 0,
  channelRecreations: 0,
};

/** Incrementa um contador (uso interno do dir `mq/`). */
export function incMqStat(key: keyof MqStats): void {
  counters[key] += 1;
}

/** Snapshot imutável dos contadores do processo. */
export function mqStats(): MqStats {
  return { ...counters };
}

/** Zera os contadores (testes). */
export function resetMqStats(): void {
  for (const key of Object.keys(counters) as (keyof MqStats)[]) counters[key] = 0;
}
