/**
 * Agregador das rotas do dominio Deals (F5-S05, PIPELINE.md 10).
 * Monta CRUD/lifecycle + anexos. O storage e injetavel (default: @hm/storage
 * via createStorage()) p/ testabilidade. Montado em app.ts pelo orchestrator.
 */
import { Router } from 'express';
import { createStorage } from '@hm/storage';
import { createDealsCrudRouter } from './crud';
import { createDealAttachmentsRouter, type AttachmentStorage } from './attachments';

export function createDealsRouter(storage?: AttachmentStorage): Router {
  const router = Router();
  const store: AttachmentStorage = storage ?? createStorage();
  router.use(createDealAttachmentsRouter(store));
  router.use(createDealsCrudRouter());
  return router;
}

export { createDealsCrudRouter } from './crud';
export { createDealAttachmentsRouter, type AttachmentStorage } from './attachments';
export {
  moveDealToStage,
  onStageChanged,
  validateTransition,
  TransitionError,
  type DealActor,
  type StageChangeEvent,
  type StageChangeHook,
} from '../../services/deal-move';
