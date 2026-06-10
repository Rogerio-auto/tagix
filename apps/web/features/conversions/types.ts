/** Tipos da feature de conversões (F5-S13). Espelham a API de F5-S12. */
export interface ConversionType {
  id: string;
  key: string;
  label: string;
  color: string;
  icon: string | null;
  valueRequired: boolean;
  valueLabel: string | null;
  currency: string;
  isDefault: boolean;
  position: number;
  isActive: boolean;
}

export interface ConversionEvent {
  id: string;
  conversionTypeId: string;
  contactId: string;
  dealId: string | null;
  valueCents: number | null;
  currency: string;
  note: string | null;
  source: string;
  occurredAt: string;
  cancelledAt: string | null;
}

export interface RegisterConversionInput {
  conversionTypeId?: string;
  conversionTypeKey?: string;
  contactId: string;
  conversationId?: string | null;
  dealId?: string | null;
  valueCents?: number | null;
  note?: string | null;
  source?: 'manual' | 'deal_won' | 'api';
}

export interface CreateConversionTypeInput {
  key: string;
  label: string;
  valueRequired?: boolean;
  valueLabel?: string | null;
  color?: string;
  isDefault?: boolean;
}
