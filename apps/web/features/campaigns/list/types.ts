/** Tipos do dominio Campaigns no front (espelham a API F6-S03/04). */

export type CampaignStatus =
  | 'draft'
  | 'scheduled'
  | 'running'
  | 'paused'
  | 'completed'
  | 'cancelled';

export type CampaignType = 'broadcast' | 'drip' | 'triggered';

export interface Campaign {
  id: string;
  workspaceId: string;
  channelId: string;
  name: string;
  type: CampaignType;
  status: CampaignStatus;
  rateLimitPerMinute: number;
  dailyLimit: number | null;
  autoHandoffOnReply: boolean;
  createdAt: string;
  updatedAt: string | null;
}

export type HealthStatus = 'healthy' | 'warning' | 'critical';

export interface CampaignMetrics {
  campaignId: string;
  totalRecipients: number;
  messagesQueued: number;
  messagesSent: number;
  messagesDelivered: number;
  messagesRead: number;
  messagesReplied: number;
  messagesFailed: number;
  messagesBlocked: number;
  deliveryRate: string | null;
  readRate: string | null;
  responseRate: string | null;
  blockRate: string | null;
  healthStatus: HealthStatus;
  updatedAt: string;
}

export interface CampaignDelivery {
  id: string;
  campaignId: string;
  status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'blocked';
  errorCode: string | null;
  errorMessage: string | null;
  queuedAt: string;
  sentAt: string | null;
  failedAt: string | null;
}
