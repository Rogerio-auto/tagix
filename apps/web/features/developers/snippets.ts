/** Snippets de codigo do Portal do Desenvolvedor (F38-S13). Strings cruas,
 *  separadas do JSX para evitar ruido de escape no componente. */
export const BASE = 'https://api.leadium.app';

export const CURL_AUTH = [
  `curl ${BASE}/api/v1/contacts \\`,
  '  -H "Authorization: Bearer SUA_API_KEY"',
].join('\n');

export const WEBHOOK_VERIFY = [
  '// Verificacao da assinatura HMAC (Node.js)',
  "import crypto from 'node:crypto';",
  '',
  'function verify(rawBody, signatureHeader, secret) {',
  "  const expected = crypto.createHmac('sha256', secret)",
  '    .update(rawBody)',
  "    .digest('hex');",
  '  return crypto.timingSafeEqual(',
  '    Buffer.from(signatureHeader),',
  '    Buffer.from(expected),',
  '  );',
  '}',
].join('\n');

export const CURL = [
  `curl -X POST ${BASE}/api/v1/conversions \\`,
  '  -H "Authorization: Bearer SUA_API_KEY" \\',
  '  -H "Content-Type: application/json" \\',
  `  -d '{"contactId":"...","conversionTypeKey":"venda","valueCents":19900}'`,
].join('\n');

export const JS = [
  `const res = await fetch('${BASE}/api/v1/conversions', {`,
  "  method: 'POST',",
  '  headers: {',
  "    Authorization: `Bearer ${process.env.LEADIUM_API_KEY}`,",
  "    'Content-Type': 'application/json',",
  '  },',
  "  body: JSON.stringify({ contactId: '...', conversionTypeKey: 'venda', valueCents: 19900 }),",
  '});',
  'const data = await res.json();',
].join('\n');

export const PY = [
  'import os, requests',
  '',
  'res = requests.post(',
  `    '${BASE}/api/v1/conversions',`,
  "    headers={'Authorization': f\"Bearer {os.environ['LEADIUM_API_KEY']}\"},",
  "    json={'contactId': '...', 'conversionTypeKey': 'venda', 'valueCents': 19900},",
  ')',
  'data = res.json()',
].join('\n');
