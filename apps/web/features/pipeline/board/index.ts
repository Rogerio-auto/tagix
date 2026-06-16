/** Kanban do pipeline (F5-S09). */
export { PipelinePage } from './PipelinePage';
export { StageColumn } from './StageColumn';
export { DealCard } from './DealCard';
export { MobileBoard } from './MobileBoard';
export { MobileDealSheet } from './MobileDealSheet';
export {
  pipelineKeys,
  usePipelines,
  usePipelineDetail,
  useDeals,
  useCreateDeal,
  useMoveDeal,
} from './queries';
export { useDealSocket } from './useDealSocket';
export type { Pipeline, Stage, Deal, CreateDealInput, TransitionRules } from './types';
