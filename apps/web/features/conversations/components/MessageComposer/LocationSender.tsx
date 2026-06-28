'use client';

/**
 * Painel de envio de localização (F45-S05), embutido no `AttachmentMenu`.
 * Caminho feliz: "Usar localização atual" via `navigator.geolocation` preenche
 * lat/long. Permissão negada/indisponível degrada elegante (UX §2 — sem beco
 * sem saída): mostra o motivo e revela a entrada MANUAL de coordenadas + nome/
 * endereço, já que o WhatsApp exige `latitude`/`longitude` (shape Graph) — não
 * há geocoding de endereço no MVP (sem libs de mapa pesadas).
 *
 * Envia `type:'location'` com `payload:{ latitude, longitude, name?, address? }`.
 * DS v2: zero hex, só tokens; foco `focus-visible:shadow-glow-md`; alvo ≥44px.
 */

import { useState } from 'react';
import { Loader2, LocateFixed, MapPin, SendHorizontal } from 'lucide-react';
import { useToast } from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import { ApiError } from '@/shared/lib/api-client';
import { useSendMessage } from '../../queries';

export interface LocationSenderProps {
  readonly conversationId: string;
  /** Fecha o menu de anexo após o envio bem-sucedido. */
  readonly onSent: () => void;
}

type GeoStatus = 'idle' | 'locating' | 'ready' | 'denied' | 'unavailable' | 'timeout' | 'unsupported';

const GEO_MESSAGE: Record<Exclude<GeoStatus, 'idle' | 'locating' | 'ready'>, string> = {
  denied: 'Permissão de localização negada. Informe as coordenadas manualmente.',
  unavailable: 'Não foi possível obter sua localização. Informe manualmente.',
  timeout: 'A localização demorou a responder. Informe manualmente.',
  unsupported: 'Este dispositivo não suporta localização. Informe manualmente.',
};

/** Coordenada válida dentro dos limites geográficos (graus decimais). */
function parseCoord(raw: string, max: number): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < -max || value > max) return null;
  return value;
}

export function LocationSender({ conversationId, onSent }: LocationSenderProps) {
  const { toast } = useToast();
  const send = useSendMessage();

  const [status, setStatus] = useState<GeoStatus>('idle');
  const [manualOpen, setManualOpen] = useState(false);
  const [lat, setLat] = useState('');
  const [long, setLong] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');

  const useCurrentLocation = () => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setStatus('unsupported');
      setManualOpen(true);
      return;
    }
    setStatus('locating');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLat(position.coords.latitude.toFixed(6));
        setLong(position.coords.longitude.toFixed(6));
        setStatus('ready');
      },
      (error) => {
        const next: GeoStatus =
          error.code === error.PERMISSION_DENIED
            ? 'denied'
            : error.code === error.TIMEOUT
              ? 'timeout'
              : 'unavailable';
        setStatus(next);
        setManualOpen(true);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  };

  const latitude = parseCoord(lat, 90);
  const longitude = parseCoord(long, 180);
  const canSend = latitude !== null && longitude !== null && !send.isPending;

  const submit = async () => {
    if (latitude === null || longitude === null || send.isPending) return;
    const trimmedName = name.trim();
    const trimmedAddress = address.trim();
    const location = {
      latitude,
      longitude,
      ...(trimmedName !== '' ? { name: trimmedName } : {}),
      ...(trimmedAddress !== '' ? { address: trimmedAddress } : {}),
    };
    // `content` legível para a bolha/lista (a rota persiste `name` como content);
    // cai para o endereço ou as coordenadas quando não há nome.
    const content =
      trimmedName !== ''
        ? trimmedName
        : trimmedAddress !== ''
          ? trimmedAddress
          : `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
    try {
      // Ponte S02/S03: `useSendMessage` ESPALHA `payload` no corpo do POST e a
      // rota lê `body.payload` (validado por `locationPayloadSchema`). Aninhar
      // `{ payload }` produz exatamente a chave `payload` esperada no corpo.
      await send.mutateAsync({
        conversationId,
        content,
        type: 'location',
        payload: { payload: location },
      });
      onSent();
    } catch (err) {
      const ref = err instanceof ApiError ? err.ref : undefined;
      toast({
        variant: 'error',
        title: 'Não foi possível enviar a localização',
        description:
          err instanceof ApiError
            ? `${err.message}${ref ? ` (ref ${ref})` : ''}`
            : 'Algo deu errado ao enviar. Tente novamente.',
      });
    }
  };

  const locating = status === 'locating';
  const errored = status === 'denied' || status === 'unavailable' || status === 'timeout' || status === 'unsupported';
  const sending = send.isPending;

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={useCurrentLocation}
        disabled={locating || sending}
        aria-busy={locating || undefined}
        className={cn(
          'flex w-full items-center justify-center gap-2 rounded-md border border-border-2 px-3 py-2.5',
          'font-body text-sm text-text outline-none transition-colors',
          'hover:bg-surface-3 focus-visible:shadow-glow-md disabled:cursor-not-allowed disabled:opacity-40',
        )}
      >
        {locating ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <LocateFixed className="size-4" aria-hidden />
        )}
        {locating ? 'Obtendo localização…' : 'Usar localização atual'}
      </button>

      {status === 'ready' && (
        <p
          className="flex items-center gap-1.5 font-body text-xs text-text-mid"
          role="status"
          aria-live="polite"
        >
          <MapPin className="size-3.5 shrink-0" aria-hidden />
          Localização obtida: {lat}, {long}
        </p>
      )}

      {errored && (
        <p className="font-body text-xs text-danger" role="alert">
          {GEO_MESSAGE[status]}
        </p>
      )}

      {!manualOpen && status !== 'ready' && (
        <button
          type="button"
          onClick={() => setManualOpen(true)}
          className={cn(
            'self-start rounded-sm px-1 py-0.5 font-body text-xs text-text-mid underline-offset-2 outline-none',
            'transition-colors hover:text-text hover:underline focus-visible:shadow-glow-md',
          )}
        >
          Inserir coordenadas manualmente
        </button>
      )}

      {(manualOpen || status === 'ready') && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <CoordField label="Latitude" value={lat} onChange={setLat} placeholder="-23.55" />
            <CoordField label="Longitude" value={long} onChange={setLong} placeholder="-46.63" />
          </div>
          <TextField label="Nome do local (opcional)" value={name} onChange={setName} placeholder="Loja Centro" />
          <TextField label="Endereço (opcional)" value={address} onChange={setAddress} placeholder="Rua, número, bairro" />
        </div>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={!canSend}
        aria-busy={sending || undefined}
        className={cn(
          'flex items-center justify-center gap-1.5 rounded-md px-3 py-2 font-body text-sm outline-none',
          'transition-colors focus-visible:shadow-glow-md disabled:cursor-not-allowed disabled:opacity-40',
          canSend ? 'bg-brand text-text-on-brand hover:bg-brand-strong' : 'bg-surface-3 text-text-low',
        )}
      >
        {sending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <SendHorizontal className="size-4" aria-hidden />
        )}
        Enviar localização
      </button>
    </div>
  );
}

function CoordField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-body text-xs text-text-low">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={cn(
          'w-full rounded-md border border-border-2 bg-surface-inset px-2 py-1.5 font-body text-sm text-text outline-none',
          'placeholder:text-text-low focus-visible:border-border focus-visible:shadow-glow-md',
        )}
      />
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-body text-xs text-text-low">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={cn(
          'w-full rounded-md border border-border-2 bg-surface-inset px-2 py-1.5 font-body text-sm text-text outline-none',
          'placeholder:text-text-low focus-visible:border-border focus-visible:shadow-glow-md',
        )}
      />
    </label>
  );
}
