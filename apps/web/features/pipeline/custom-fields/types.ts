/**
 * Custom fields por pipeline (F5-S11, PIPELINE.md §8). As defs vivem em
 * `pipelines.settings.custom_fields[]` (jsonb) — espelho do tipo de @hm/db.
 */
export type CustomFieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'select'
  | 'multiselect'
  | 'boolean'
  | 'currency';

export interface CustomFieldDef {
  key: string;
  label: string;
  type: CustomFieldType;
  required: boolean;
  options?: string[];
  defaultValue?: string | number | boolean | null;
  position: number;
}

export type CustomFieldValue = string | number | boolean | string[] | null | undefined;
export type CustomFieldValues = Record<string, CustomFieldValue>;

export const FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Texto',
  number: 'Número',
  date: 'Data',
  select: 'Seleção',
  multiselect: 'Multi-seleção',
  boolean: 'Sim/Não',
  currency: 'Moeda (R$)',
};
