/** Custom fields por pipeline (F5-S11). Exporta o renderer dinâmico, a view
 * read-only, o editor de settings e os helpers de schema. DynamicFieldsForm é
 * consumido por F5-S09 (create/edit deal) e F5-S10 (drawer) — contrato estável. */
export { DynamicFieldsForm } from './DynamicFieldsForm';
export type { DynamicFieldsFormProps } from './DynamicFieldsForm';
export { CustomFieldsView } from './CustomFieldsView';
export type { CustomFieldsViewProps } from './CustomFieldsView';
export { CustomFieldsEditor } from './CustomFieldsEditor';
export type { CustomFieldsEditorProps } from './CustomFieldsEditor';
export { buildCustomFieldsSchema, validateCustomFields, orphanValueKeys } from './schema';
export { FIELD_TYPE_LABELS } from './types';
export type {
  CustomFieldDef,
  CustomFieldType,
  CustomFieldValue,
  CustomFieldValues,
} from './types';
