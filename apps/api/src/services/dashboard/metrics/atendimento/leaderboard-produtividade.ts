import type { MetricModule } from '../types';
import { SUP_RO } from '../types';
import { leaderboardProdutividade } from '../../queries';

export const leaderboardProdutividadeMetric: MetricModule = {
  def: {
    key: 'leaderboard_produtividade',
    label: 'Leaderboard de produtividade',
    category: 'atendimento',
    roles: SUP_RO,
    cadence: 'snapshot_5min',
    scope: 'team',
    cardType: 'leaderboard',
  },
  resolve: (ctx) => leaderboardProdutividade(ctx.tx, ctx.workspaceId),
};
