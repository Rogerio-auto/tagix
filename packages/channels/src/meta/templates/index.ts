export { MetaTemplatesClient, type MetaTemplatesClientOptions } from './client';
export {
  MetaTemplateError,
  type MetaTemplateErrorKind,
  type MetaTemplateErrorPermanence,
  type MetaTemplateValidationIssue,
} from './errors';
export { validateMetaTemplateCreateInput } from './validation';
export type {
  CreateMetaTemplateArgs,
  ListMetaTemplatesArgs,
  MetaBodyComponent,
  MetaButtonsComponent,
  MetaFooterComponent,
  MetaMediaHeaderComponent,
  MetaMessageTemplate,
  MetaPhoneNumberButton,
  MetaQuickReplyButton,
  MetaTemplateButton,
  MetaTemplateCategory,
  MetaTemplateCreateComponent,
  MetaTemplateCreateInput,
  MetaTemplateStatus,
  MetaTextHeaderComponent,
  MetaUrlButton,
} from './types';
