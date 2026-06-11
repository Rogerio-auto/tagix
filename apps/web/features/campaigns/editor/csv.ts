/** Parse + validacao de CSV de recipients no client (CAMPAIGNS.md 12.3). */

export interface CsvRow {
  phone: string;
  name?: string;
  valid: boolean;
  duplicate: boolean;
}

const E164 = /^\+[1-9]\d{6,14}$/;
export function isE164(phone: string): boolean {
  return E164.test(phone.trim());
}

/** Parseia CSV (header phone[,name]). Marca E.164 invalido + duplicados por phone. */
export function parseRecipientsCsv(csv: string): CsvRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = (lines[0] ?? '').split(',').map((h) => h.trim().toLowerCase());
  const phoneIdx = header.indexOf('phone');
  const nameIdx = header.indexOf('name');
  const hasHeader = phoneIdx >= 0;
  const start = hasHeader ? 1 : 0;
  const seen = new Set<string>();
  const rows: CsvRow[] = [];
  for (let i = start; i < lines.length; i++) {
    const cols = (lines[i] ?? '').split(',').map((c) => c.trim());
    const phone = hasHeader ? cols[phoneIdx] ?? '' : cols[0] ?? '';
    if (!phone) continue;
    const name = hasHeader && nameIdx >= 0 ? cols[nameIdx] : cols[1];
    const valid = isE164(phone);
    const duplicate = seen.has(phone);
    seen.add(phone);
    rows.push({ phone, name: name || undefined, valid, duplicate });
  }
  return rows;
}
