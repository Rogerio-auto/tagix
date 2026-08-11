import { templateValidationError, type MetaTemplateValidationIssue } from './errors';
import type { MetaTemplateCreateInput } from './types';

const NAME_PATTERN = /^[a-z0-9_]{1,512}$/;
const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:_[A-Z]{2})?$/;
const VARIABLE_PATTERN = /\{\{(\d+)\}\}/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  maxLength: number,
  issues: MetaTemplateValidationIssue[],
): string | undefined {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push({ path, code: 'required_string' });
    return undefined;
  }
  if (value.length > maxLength) issues.push({ path, code: 'too_long' });
  return value;
}

function positionalVariables(
  text: string,
  path: string,
  issues: MetaTemplateValidationIssue[],
): number {
  const found = [...text.matchAll(VARIABLE_PATTERN)].map((match) => Number(match[1]));
  const withoutValidVariables = text.replace(VARIABLE_PATTERN, '');
  if (withoutValidVariables.includes('{{') || withoutValidVariables.includes('}}')) {
    issues.push({ path, code: 'invalid_variable_syntax' });
  }
  const distinct = [...new Set(found)].sort((left, right) => left - right);
  for (let index = 0; index < distinct.length; index += 1) {
    if (distinct[index] !== index + 1) {
      issues.push({ path, code: 'variables_not_sequential' });
      break;
    }
  }
  return distinct.length;
}

function validateStringArray(
  value: unknown,
  path: string,
  expectedLength: number | undefined,
  issues: MetaTemplateValidationIssue[],
): void {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== 'string' || item.length === 0)
  ) {
    issues.push({ path, code: 'invalid_example' });
    return;
  }
  if (expectedLength !== undefined && value.length !== expectedLength) {
    issues.push({ path, code: 'example_count_mismatch' });
  }
}

function validateHeader(
  component: Record<string, unknown>,
  path: string,
  issues: MetaTemplateValidationIssue[],
): void {
  const format = component['format'];
  if (format === 'TEXT') {
    const text = requiredString(component, 'text', `${path}.text`, 60, issues);
    if (text === undefined) return;
    const variableCount = positionalVariables(text, `${path}.text`, issues);
    if (variableCount > 1) issues.push({ path: `${path}.text`, code: 'too_many_header_variables' });
    if (variableCount > 0) {
      const example = component['example'];
      if (!isRecord(example))
        issues.push({ path: `${path}.example.header_text`, code: 'example_required' });
      else
        validateStringArray(
          example['header_text'],
          `${path}.example.header_text`,
          variableCount,
          issues,
        );
    }
    return;
  }
  if (format === 'IMAGE' || format === 'VIDEO' || format === 'DOCUMENT') {
    const example = component['example'];
    if (!isRecord(example))
      issues.push({ path: `${path}.example.header_handle`, code: 'example_required' });
    else
      validateStringArray(
        example['header_handle'],
        `${path}.example.header_handle`,
        undefined,
        issues,
      );
    return;
  }
  issues.push({ path: `${path}.format`, code: 'unsupported_header_format' });
}

function validateBody(
  component: Record<string, unknown>,
  path: string,
  issues: MetaTemplateValidationIssue[],
): void {
  const text = requiredString(component, 'text', `${path}.text`, 1024, issues);
  if (text === undefined) return;
  const variableCount = positionalVariables(text, `${path}.text`, issues);
  if (variableCount === 0) return;
  const example = component['example'];
  const bodyText = isRecord(example) ? example['body_text'] : undefined;
  if (!Array.isArray(bodyText) || bodyText.length === 0) {
    issues.push({ path: `${path}.example.body_text`, code: 'example_required' });
    return;
  }
  for (let row = 0; row < bodyText.length; row += 1) {
    validateStringArray(bodyText[row], `${path}.example.body_text.${row}`, variableCount, issues);
  }
}

function validateButtons(
  component: Record<string, unknown>,
  path: string,
  issues: MetaTemplateValidationIssue[],
): void {
  const buttons = component['buttons'];
  if (!Array.isArray(buttons) || buttons.length === 0 || buttons.length > 10) {
    issues.push({ path: `${path}.buttons`, code: 'invalid_button_count' });
    return;
  }
  for (let index = 0; index < buttons.length; index += 1) {
    const buttonPath = `${path}.buttons.${index}`;
    const button = buttons[index];
    if (!isRecord(button)) {
      issues.push({ path: buttonPath, code: 'invalid_button' });
      continue;
    }
    const type = button['type'];
    requiredString(button, 'text', `${buttonPath}.text`, 25, issues);
    if (type === 'QUICK_REPLY') continue;
    if (type === 'PHONE_NUMBER') {
      const phone = requiredString(
        button,
        'phone_number',
        `${buttonPath}.phone_number`,
        20,
        issues,
      );
      if (phone !== undefined && !/^\+[1-9]\d{6,14}$/.test(phone)) {
        issues.push({ path: `${buttonPath}.phone_number`, code: 'invalid_phone_number' });
      }
      continue;
    }
    if (type === 'URL') {
      const url = requiredString(button, 'url', `${buttonPath}.url`, 2000, issues);
      if (url === undefined) continue;
      const variableCount = positionalVariables(url, `${buttonPath}.url`, issues);
      if (variableCount > 1)
        issues.push({ path: `${buttonPath}.url`, code: 'too_many_url_variables' });
      if (variableCount > 0)
        validateStringArray(button['example'], `${buttonPath}.example`, variableCount, issues);
      continue;
    }
    issues.push({ path: `${buttonPath}.type`, code: 'unsupported_button_type' });
  }
}

/** Valida completamente antes de qualquer chamada HTTP. */
export function validateMetaTemplateCreateInput(input: MetaTemplateCreateInput): void {
  const issues: MetaTemplateValidationIssue[] = [];
  const candidate: unknown = input;
  if (!isRecord(candidate))
    throw templateValidationError([{ path: 'template', code: 'required_object' }]);

  const name = candidate['name'];
  if (typeof name !== 'string' || !NAME_PATTERN.test(name))
    issues.push({ path: 'name', code: 'invalid_name' });
  const language = candidate['language'];
  if (typeof language !== 'string' || !LANGUAGE_PATTERN.test(language))
    issues.push({ path: 'language', code: 'invalid_language' });
  const category = candidate['category'];
  if (category !== 'MARKETING' && category !== 'UTILITY' && category !== 'AUTHENTICATION') {
    issues.push({ path: 'category', code: 'invalid_category' });
  }

  const components = candidate['components'];
  if (!Array.isArray(components) || components.length === 0) {
    issues.push({ path: 'components', code: 'required_array' });
  } else {
    const seen = new Set<string>();
    let bodyCount = 0;
    for (let index = 0; index < components.length; index += 1) {
      const path = `components.${index}`;
      const component = components[index];
      if (!isRecord(component) || typeof component['type'] !== 'string') {
        issues.push({ path, code: 'invalid_component' });
        continue;
      }
      const type = component['type'];
      if (seen.has(type)) issues.push({ path: `${path}.type`, code: 'duplicate_component' });
      seen.add(type);
      switch (type) {
        case 'HEADER':
          validateHeader(component, path, issues);
          break;
        case 'BODY':
          bodyCount += 1;
          validateBody(component, path, issues);
          break;
        case 'FOOTER': {
          const footer = requiredString(component, 'text', `${path}.text`, 60, issues);
          if (footer !== undefined && positionalVariables(footer, `${path}.text`, issues) > 0) {
            issues.push({ path: `${path}.text`, code: 'footer_variables_not_allowed' });
          }
          break;
        }
        case 'BUTTONS':
          validateButtons(component, path, issues);
          break;
        default:
          issues.push({ path: `${path}.type`, code: 'unsupported_component_type' });
      }
    }
    if (bodyCount !== 1) issues.push({ path: 'components', code: 'exactly_one_body_required' });
  }

  if (issues.length > 0) throw templateValidationError(issues);
}
