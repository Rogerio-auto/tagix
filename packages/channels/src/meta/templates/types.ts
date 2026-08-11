/** Contratos estaveis do catalogo de modelos de mensagem da Meta. */

export type MetaTemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION' | 'UNKNOWN';

export type MetaTemplateStatus =
  | 'APPROVED'
  | 'PENDING'
  | 'REJECTED'
  | 'PAUSED'
  | 'DISABLED'
  | 'IN_APPEAL'
  | 'PENDING_DELETION'
  | 'UNKNOWN';

/**
 * Modelo normalizado. Valores novos do provider nao quebram a sincronizacao:
 * status/categoria caem em UNKNOWN e os componentes continuam opacos.
 */
export interface MetaMessageTemplate {
  readonly externalId: string;
  readonly name: string;
  readonly language: string;
  readonly category: MetaTemplateCategory;
  readonly providerCategory?: string;
  readonly status: MetaTemplateStatus;
  readonly providerStatus?: string;
  readonly components: readonly unknown[];
  readonly rejectionReason?: string;
}

export interface MetaTextHeaderComponent {
  readonly type: 'HEADER';
  readonly format: 'TEXT';
  readonly text: string;
  readonly example?: { readonly header_text: readonly string[] };
}

export interface MetaMediaHeaderComponent {
  readonly type: 'HEADER';
  readonly format: 'IMAGE' | 'VIDEO' | 'DOCUMENT';
  readonly example: { readonly header_handle: readonly string[] };
}

export interface MetaBodyComponent {
  readonly type: 'BODY';
  readonly text: string;
  readonly example?: { readonly body_text: readonly (readonly string[])[] };
}

export interface MetaFooterComponent {
  readonly type: 'FOOTER';
  readonly text: string;
}

export interface MetaQuickReplyButton {
  readonly type: 'QUICK_REPLY';
  readonly text: string;
}

export interface MetaUrlButton {
  readonly type: 'URL';
  readonly text: string;
  readonly url: string;
  readonly example?: readonly string[];
}

export interface MetaPhoneNumberButton {
  readonly type: 'PHONE_NUMBER';
  readonly text: string;
  readonly phone_number: string;
}

export type MetaTemplateButton = MetaQuickReplyButton | MetaUrlButton | MetaPhoneNumberButton;

export interface MetaButtonsComponent {
  readonly type: 'BUTTONS';
  readonly buttons: readonly MetaTemplateButton[];
}

export type MetaTemplateCreateComponent =
  | MetaTextHeaderComponent
  | MetaMediaHeaderComponent
  | MetaBodyComponent
  | MetaFooterComponent
  | MetaButtonsComponent;

export interface MetaTemplateCreateInput {
  readonly name: string;
  readonly language: string;
  readonly category: Exclude<MetaTemplateCategory, 'UNKNOWN'>;
  readonly components: readonly MetaTemplateCreateComponent[];
  readonly allowCategoryChange?: boolean;
}

export interface ListMetaTemplatesArgs {
  readonly wabaId: string;
  readonly accessToken: string;
}

export interface CreateMetaTemplateArgs extends ListMetaTemplatesArgs {
  readonly template: MetaTemplateCreateInput;
}
