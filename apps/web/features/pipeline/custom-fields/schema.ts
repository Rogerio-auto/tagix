/**
 * Construção de Zod dinâmico + helpers de validação a partir de CustomFieldDef[]
 * (F5-S11, PIPELINE.md §8.2). Usado pelo DynamicFieldsForm (create/edit do deal).
 */
import { z } from 'zod';
import type { CustomFieldDef, CustomFieldValues } from './types';

/** Constrói um schema Zod que valida `deals.custom_fields` contra as defs. */
export function buildCustomFieldsSchema(defs: readonly CustomFieldDef[]): z.ZodType<CustomFieldValues> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const def of defs) {
    let field: z.ZodTypeAny;
    switch (def.type) {
      case 'number':
      case 'currency':
        field = z.number({ invalid_type_error: 'Informe um número.' });
        break;
      case 'boolean':
        field = z.boolean();
        break;
      case 'multiselect':
        field = z.array(z.string());
        break;
      case 'select':
        field = def.options && def.options.length > 0 ? z.enum([def.options[0]!, ...def.options.slice(1)]) : z.string();
        break;
      case 'date':
      case 'text':
      default:
        field = z.string();
        break;
    }
    if (def.required) {
      if (def.type === 'multiselect') field = (field as z.ZodArray<z.ZodString>).min(1, 'Selecione ao menos um.');
      else if (def.type === 'text' || def.type === 'date' || def.type === 'select')
        field = (field as z.ZodString).min(1, 'Campo obrigatório.');
    } else {
      field = field.optional().nullable();
    }
    shape[def.key] = field;
  }
  return z.object(shape).passthrough() as unknown as z.ZodType<CustomFieldValues>;
}

/** Valida valores contra as defs; retorna erros por key (vazio = ok). */
export function validateCustomFields(
  defs: readonly CustomFieldDef[],
  values: CustomFieldValues,
): Record<string, string> {
  const schema = buildCustomFieldsSchema(defs);
  const result = schema.safeParse(values);
  if (result.success) return {};
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? '');
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}

/**
 * Detecta keys presentes nos valores que não existem mais nas defs (schema
 * mudou) — usado p/ warning graceful (§14), sem quebrar o form.
 */
export function orphanValueKeys(
  defs: readonly CustomFieldDef[],
  values: CustomFieldValues,
): string[] {
  const known = new Set(defs.map((d) => d.key));
  return Object.keys(values).filter((k) => !known.has(k) && values[k] != null && values[k] !== '');
}
