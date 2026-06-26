/** Fake do BackupDbPort para testes puros (sem Postgres). Não é parte do runtime. */
import { referenceIndexSchema, type ReferenceIndex } from '@hm/flow-engine';
import type { BackupDbPort, NewFlowRow, RawFlowRow, TargetLookups } from './ports';

export function emptyLookups(over: Partial<TargetLookups> = {}): TargetLookups {
  return {
    tagIdByName: new Map(),
    stageIdByPipelineName: new Map(),
    stageIdByName: new Map(),
    pipelineIdByName: new Map(),
    agentIdByName: new Map(),
    channelIdByName: new Map(),
    memberIdByEmail: new Map(),
    flowIdByName: new Map(),
    conversionTypeKeys: new Set(),
    ...over,
  };
}

export interface FakePortOptions {
  readonly flows?: RawFlowRow[];
  readonly index?: ReferenceIndex;
  readonly lookups?: Partial<TargetLookups>;
  readonly existingNames?: string[];
}

export function createFakePort(opts: FakePortOptions = {}): {
  port: BackupDbPort;
  inserted: NewFlowRow[];
} {
  const inserted: NewFlowRow[] = [];
  const lookups = emptyLookups(opts.lookups);
  const index = opts.index ?? referenceIndexSchema.parse({});
  const port: BackupDbPort = {
    async listFlows() {
      return opts.flows ?? [];
    },
    async describeReferences() {
      return index;
    },
    async loadTargetLookups() {
      return lookups;
    },
    async existingFlowNames() {
      return new Set(opts.existingNames ?? []);
    },
    async insertFlows(rows) {
      inserted.push(...rows);
    },
  };
  return { port, inserted };
}
