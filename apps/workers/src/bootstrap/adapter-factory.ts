/**
 * Adapter factory (F1-S26) — `provider → IChannelAdapter` para os workers.
 *
 * É o ponto de composição que instancia os adapters de canal de `@hm/channels`.
 * Os adapters Meta (WhatsApp/Instagram) compartilham um `GraphClient` (fetch
 * global, retry/timeout) — sem segredo per-canal no construtor: o token vai no
 * `Channel` snapshot a cada chamada. Por isso a factory pode ser **stateless por
 * provider** e cobre tanto a assinatura `(provider)` do media-worker quanto a
 * `(channel)` do outbound.
 *
 * **WAHA (gap reportado).** O `WAHAAdapter` exige um `WahaClient` (baseUrl +
 * apiKey da instância), que **NÃO é exportado pelo barrel `@hm/channels`** (só
 * `WAHAAdapter`/`MetaWhatsAppAdapter`/`MetaInstagramAdapter`/`GraphClient`). Por
 * restrição do slot, NÃO fazemos deep-import de `@hm/channels/src/...`. Logo,
 * construir um adapter `waha` aqui lança um erro tipado e a feature WAHA fica
 * bloqueada até o barrel exportar `WahaClient` (+ sua config de instância) — ver
 * REPORT. Os providers Meta funcionam ponta-a-ponta.
 */
import {
  GraphClient,
  MetaInstagramAdapter,
  MetaWhatsAppAdapter,
  type Channel,
  type GraphClientOptions,
  type IChannelAdapter,
} from '@hm/channels';
import type { ChannelProvider } from '@hm/shared';

/** Erro tipado de provider sem adapter construível na composição atual. */
export class AdapterUnavailableError extends Error {
  constructor(public readonly provider: ChannelProvider, reason: string) {
    super(`Adapter indisponível para provider '${provider}': ${reason}`);
    this.name = 'AdapterUnavailableError';
    Object.setPrototypeOf(this, AdapterUnavailableError.prototype);
  }
}

export interface AdapterFactoryOptions {
  /** Override do `GraphClient` (testes / config de base URL Meta). */
  readonly graphOptions?: GraphClientOptions;
}

/**
 * Constrói uma factory de adapters por provider. O `GraphClient` é compartilhado
 * entre os providers Meta (stateless quanto a token — o token vem no `Channel`).
 *
 * @returns `(provider) => IChannelAdapter`. Lança `AdapterUnavailableError` para
 *   `waha` (WahaClient não exportado pelo barrel — ver REPORT).
 */
export function createAdapterFactory(
  options: AdapterFactoryOptions = {},
): (provider: ChannelProvider) => IChannelAdapter {
  const graph = new GraphClient(options.graphOptions ?? {});
  const whatsapp = new MetaWhatsAppAdapter(graph);
  const instagram = new MetaInstagramAdapter(graph);

  return (provider: ChannelProvider): IChannelAdapter => {
    switch (provider) {
      case 'meta_whatsapp':
        return whatsapp;
      case 'meta_instagram':
        return instagram;
      case 'waha':
        throw new AdapterUnavailableError(
          'waha',
          "WahaClient não é exportado por '@hm/channels' (apenas WAHAAdapter). " +
            'Exportar WahaClient + config de instância para habilitar (ver REPORT do slot).',
        );
      default:
        return assertNever(provider);
    }
  };
}

/**
 * Adaptação para o outbound, cuja `ChannelResolver` passa o `Channel` snapshot.
 * Como os adapters Meta são stateless quanto a token, só roteamos por
 * `channel.provider`.
 */
export function adapterFactoryByChannel(
  factory: (provider: ChannelProvider) => IChannelAdapter,
): (channel: Channel) => IChannelAdapter {
  return (channel: Channel): IChannelAdapter => factory(channel.provider);
}

function assertNever(value: never): never {
  throw new Error(`Provider sem adapter: ${JSON.stringify(value)}`);
}
