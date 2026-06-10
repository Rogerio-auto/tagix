'use client';

import { useCallback, useState } from 'react';

export interface GeoPosition {
  lat: number;
  lon: number;
  altitude?: number;
  accuracy?: number;
}

export interface GeolocationState {
  position: GeoPosition | null;
  error: string | null;
  loading: boolean;
}

/**
 * Hook de geolocalização (port do v1, F5-S10). `request()` chama a Geolocation
 * API do browser. Device-dependent: requer HTTPS + permissão do usuário; sem
 * isso, retorna erro claro (sem inventar coordenadas). NÃO testável headless.
 */
export function useGeolocation(): GeolocationState & { request: () => Promise<GeoPosition | null> } {
  const [state, setState] = useState<GeolocationState>({
    position: null,
    error: null,
    loading: false,
  });

  const request = useCallback(async (): Promise<GeoPosition | null> => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setState({ position: null, error: 'Geolocalização indisponível neste dispositivo.', loading: false });
      return null;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const position: GeoPosition = {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            altitude: pos.coords.altitude ?? undefined,
            accuracy: pos.coords.accuracy,
          };
          setState({ position, error: null, loading: false });
          resolve(position);
        },
        (err) => {
          setState({ position: null, error: err.message, loading: false });
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 10_000 },
      );
    });
  }, []);

  return { ...state, request };
}
