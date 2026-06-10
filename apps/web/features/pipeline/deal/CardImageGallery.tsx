'use client';

import { Trash2 } from 'lucide-react';
import type { DealAttachment } from './types';

export interface CardImageGalleryProps {
  attachments: DealAttachment[];
  onDelete?: (attId: string) => void;
  disabled?: boolean;
}

function formatGps(att: DealAttachment): string | null {
  if (att.gpsLat == null || att.gpsLon == null) return null;
  return `${Number(att.gpsLat).toFixed(5)}, ${Number(att.gpsLon).toFixed(5)}`;
}

/**
 * Galeria de anexos do deal (F5-S10, PIPELINE.md §5.4). Mostra overlay com
 * timestamp/lat-lon/cidade (port do v1). O overlay é desenhado sobre os metadados
 * persistidos (não exige câmera). DS v2: tokens.
 */
export function CardImageGallery({
  attachments,
  onDelete,
  disabled,
}: CardImageGalleryProps): React.JSX.Element {
  if (attachments.length === 0) {
    return <p className="text-sm text-text-low">Nenhuma foto anexada.</p>;
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      {attachments.map((att) => {
        const gps = formatGps(att);
        const city = att.metadata?.city;
        return (
          <figure
            key={att.id}
            className="relative overflow-hidden rounded-lg border border-border bg-surface-raised"
          >
            <div className="flex aspect-square items-center justify-center text-xs text-text-low">
              {att.indexNumber != null ? `#${att.indexNumber}` : 'foto'}
            </div>
            <figcaption className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-surface/80 px-2 py-1 text-[10px] text-text-mid backdrop-blur-sm">
              {att.capturedAt ? (
                <span>{new Date(att.capturedAt).toLocaleString('pt-BR')}</span>
              ) : null}
              {gps ? <span>{gps}</span> : null}
              {city ? <span>{city}</span> : null}
            </figcaption>
            {onDelete ? (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onDelete(att.id)}
                aria-label="Remover foto"
                className="absolute right-1 top-1 rounded bg-surface/80 p-1 text-text-low hover:text-danger"
              >
                <Trash2 className="size-3.5" />
              </button>
            ) : null}
          </figure>
        );
      })}
    </div>
  );
}
