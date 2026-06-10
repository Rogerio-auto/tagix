'use client';

import { createContext, useContext, type ReactNode } from 'react';

/** Recursos auxiliares do editor (tags/stages/agents/channels) para os inspectors (S11). */
export interface FlowHelpers {
  agents: { id: string; name: string }[];
  channels: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  stages: { id: string; name: string }[];
}

const EMPTY: FlowHelpers = { agents: [], channels: [], tags: [], stages: [] };

const HelpersContext = createContext<FlowHelpers>(EMPTY);

export function FlowHelpersProvider({
  value,
  children,
}: {
  value: FlowHelpers;
  children: ReactNode;
}) {
  return <HelpersContext.Provider value={value}>{children}</HelpersContext.Provider>;
}

export function useFlowHelpers(): FlowHelpers {
  return useContext(HelpersContext);
}
