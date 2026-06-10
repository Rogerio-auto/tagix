/** Tipos do DealDetailDrawer (F5-S10). Espelham a API de F5-S05. */
export interface DealHistoryEntry {
  id: string;
  dealId: string;
  eventType:
    | 'created'
    | 'stage_changed'
    | 'field_updated'
    | 'owner_changed'
    | 'closed'
    | 'reopened'
    | 'note_added'
    | 'attachment_added';
  fromValue: Record<string, unknown> | null;
  toValue: Record<string, unknown> | null;
  actorType: string;
  createdAt: string;
}

export interface DealAttachment {
  id: string;
  dealId: string;
  storageKey: string;
  mime: string;
  sizeBytes: number;
  filename: string | null;
  caption: string | null;
  gpsLat: string | null;
  gpsLon: string | null;
  capturedAt: string | null;
  indexNumber: number | null;
  metadata: { city?: string; state?: string; address?: string; country?: string };
  createdAt: string;
}

export interface SignedUrlResponse {
  url: string;
  key: string;
  expiresAt: string;
}

/** Metadados de captura (GPS/EXIF) anexados no POST de persistência. */
export interface CaptureMetadata {
  gpsLat?: number;
  gpsLon?: number;
  gpsAltitude?: number;
  gpsAccuracy?: number;
  capturedAt?: string;
  metadata?: { city?: string; state?: string; address?: string; country?: string };
}
