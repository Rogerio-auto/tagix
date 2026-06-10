/** DealDetailDrawer + captura/galeria de fotos (F5-S10). */
export { DealDetailDrawer } from './DealDetailDrawer';
export type { DealDetailDrawerProps } from './DealDetailDrawer';
export { CardImageCapture } from './CardImageCapture';
export { CardImageGallery } from './CardImageGallery';
export { HistoryTimeline } from './HistoryTimeline';
export { useGeolocation } from './useGeolocation';
export { sha256Hex, uploadToSignedUrl } from './upload';
export {
  useDeal,
  useDealHistory,
  useDealAttachments,
  useRequestUploadUrl,
  usePersistAttachment,
  useDeleteAttachment,
  dealKeys,
} from './queries';
export type { DealAttachment, DealHistoryEntry, SignedUrlResponse, CaptureMetadata } from './types';
