/** Tipos do domínio Contatos (CRM) — espelham as respostas de @hm/api (F8-S09). */

/**
 * Endereço estruturado do contato (F47-S04). Espelha o jsonb `contacts.address`
 * — todos os campos opcionais (cadastro incremental). `state` = UF (2 letras).
 */
export interface ContactAddress {
  cep?: string;
  street?: string;
  number?: string;
  complement?: string;
  district?: string;
  city?: string;
  state?: string;
}

export interface Contact {
  id: string;
  workspaceId: string;
  displayName: string | null;
  phone: string | null;
  email: string | null;
  avatarUrl: string | null;
  notes: string | null;
  language: string | null;
  source: string | null;
  marketingOptIn: boolean;
  optInMethod: string | null;
  optInSource: string | null;
  optInAt: string | null;
  optOutAt: string | null;
  optOutReason: string | null;
  ownerId: string | null;
  customFields: Record<string, unknown>;
  /** Cadastro estruturado (F47-S04): endereço tipado + documento (CPF/CNPJ). */
  address: ContactAddress;
  document: string | null;
  createdAt: string;
  updatedAt: string | null;
  deletedAt: string | null;
}

export interface ContactTag {
  id: string;
  name: string;
  color: string;
  taggedAt?: string;
}

export interface ContactConversation {
  id: string;
  channelId: string;
  status: string;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  createdAt: string;
}

export interface ContactDeal {
  id: string;
  title: string;
  stageId: string;
  closedAt: string | null;
  closedWon: boolean | null;
  valueCents: number;
  currency: string;
  createdAt: string;
}

export interface ContactConversion {
  id: string;
  typeId: string | null;
  typeKey: string | null;
  typeLabel: string | null;
  valueCents: number | null;
  currency: string;
  cancelledAt: string | null;
  occurredAt: string;
}

export type ConsentEntry =
  | { kind: 'opt_in'; at: string; method: string | null; source: string | null }
  | { kind: 'opt_out'; at: string; reason: string | null };

export interface ContactListResponse {
  contacts: Contact[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ContactDetailResponse {
  contact: Contact;
  tags: ContactTag[];
  conversations: ContactConversation[];
  deals: ContactDeal[];
  conversions: ContactConversion[];
  consent: ConsentEntry[];
  marketingOptIn: boolean;
}

export interface ContactFilters {
  q?: string;
  tagId?: string;
  source?: string;
  optIn?: 'true' | 'false';
  page?: number;
  pageSize?: number;
  sort?: 'recent' | 'name';
}

export interface ContactInput {
  displayName: string;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  source?: string | null;
  /** Cadastro estruturado (F47-S04): endereço + documento. */
  address?: ContactAddress;
  document?: string | null;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}
