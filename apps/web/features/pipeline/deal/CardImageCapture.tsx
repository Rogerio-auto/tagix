'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff } from 'lucide-react';
import { Button } from '@hm/ui';
import { useRequestUploadUrl, usePersistAttachment } from './queries';
import { sha256Hex, uploadToSignedUrl } from './upload';
import { useGeolocation } from './useGeolocation';

export interface CardImageCaptureProps {
  dealId: string;
  disabled?: boolean;
  onCaptured?: () => void;
}

/**
 * Captura de foto via câmera traseira (F5-S10, PIPELINE.md §5.1). Port do v1 no
 * DS v2: getUserMedia({ facingMode: 'environment' }) → canvas → blob → signed URL
 * → POST de metadata com GPS/EXIF.
 *
 * DEVICE-DEPENDENT (NÃO testável headless): câmera exige HTTPS + permissão; GPS
 * exige permissão. Sem isso, mostramos um fallback claro (sem inventar verde de
 * câmera). A lógica de upload (signed URL → PUT → persist) é testável à parte.
 */
export function CardImageCapture({
  dealId,
  disabled,
  onCaptured,
}: CardImageCaptureProps): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const geo = useGeolocation();
  const requestUrl = useRequestUploadUrl(dealId);
  const persist = usePersistAttachment(dealId);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setActive(false);
  }, []);

  useEffect(() => () => stop(), [stop]);

  const start = useCallback(async () => {
    setError(null);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('Câmera indisponível. Use um dispositivo com câmera e acesso via HTTPS.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setActive(true);
    } catch {
      setError('Não foi possível acessar a câmera (permissão negada ou sem HTTPS).');
    }
  }, []);

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    setBusy(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas indisponível.');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.9));
      if (!blob) throw new Error('Falha ao gerar a imagem.');

      // GPS opcional (best-effort; não bloqueia a captura).
      const position = await geo.request();

      const sha = await sha256Hex(blob);
      const filename = `deal-${dealId}-${Date.now()}.jpg`;
      const signed = await requestUrl.mutateAsync({ filename, mime: blob.type });
      await uploadToSignedUrl(signed.url, blob);
      await persist.mutateAsync({
        storageKey: signed.key,
        mime: blob.type,
        sizeBytes: blob.size,
        sha256: sha,
        filename,
        capturedAt: new Date().toISOString(),
        ...(position
          ? { gpsLat: position.lat, gpsLon: position.lon, gpsAccuracy: position.accuracy }
          : {}),
      });
      onCaptured?.();
      stop();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao capturar a foto.');
    } finally {
      setBusy(false);
    }
  }, [dealId, geo, persist, requestUrl, stop, onCaptured]);

  return (
    <div className="flex flex-col gap-2">
      {active ? (
        <div className="overflow-hidden rounded-lg border border-border bg-black">
          <video ref={videoRef} className="w-full" playsInline muted />
        </div>
      ) : null}

      {error ? (
        <p className="flex items-center gap-2 rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">
          <CameraOff className="size-4 shrink-0" />
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        {!active ? (
          <Button variant="secondary" disabled={disabled} onClick={() => void start()}>
            <Camera className="size-4" />
            Abrir câmera
          </Button>
        ) : (
          <>
            <Button variant="primary" disabled={disabled || busy} onClick={() => void capture()}>
              {busy ? 'Enviando…' : 'Capturar e anexar'}
            </Button>
            <Button variant="ghost" onClick={stop}>
              Cancelar
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
