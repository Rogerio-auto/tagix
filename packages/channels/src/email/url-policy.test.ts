/**
 * F60-S10 — política de URL vinda de e-mail.
 *
 * A pergunta de cada caso: "um desconhecido consegue, escrevendo esta URL num
 * e-mail, fazer alguém de dentro bater na rede interna?"
 */
import { describe, expect, it } from 'vitest';
import { checkEmailNetworkUrl, isInternalHost } from './url-policy';

describe('isInternalHost', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.8.8.8', 'loopback (toda a /8)'],
    ['[::1]', 'loopback v6'],
    ['169.254.169.254', 'metadados AWS/GCP/Azure'],
    ['[fd00:ec2::254]', 'metadados AWS v6 (unique-local)'],
    ['10.0.0.5', 'RFC1918'],
    ['172.16.4.4', 'RFC1918'],
    ['192.168.0.1', 'RFC1918 (roteador doméstico)'],
    ['100.64.0.1', 'CGNAT'],
    ['0.0.0.0', 'this-network'],
    ['[::ffff:127.0.0.1]', 'v4 mapeado em v6'],
    ['localhost', 'nome de loopback'],
    ['app.localhost', 'subdomínio de loopback'],
    ['metadata.google.internal', 'metadados GCP por nome'],
    ['metadata', 'atalho de metadados'],
    ['printer.local', 'mDNS'],
    ['jenkins', 'nome de uma palavra (search domain)'],
    ['router.home.arpa', 'rede doméstica'],
    ['', 'vazio'],
  ])('%s é interno (%s)', (host) => {
    expect(isInternalHost(host)).toBe(true);
  });

  it.each(['example.com', 'cdn.cliente.com.br', '8.8.8.8', '[2606:4700::1111]'])(
    '%s é público',
    (host) => {
      expect(isInternalHost(host)).toBe(false);
    },
  );
});

describe('checkEmailNetworkUrl', () => {
  it('aceita https e http públicos', () => {
    expect(checkEmailNetworkUrl('https://cliente.com/a.png').ok).toBe(true);
    expect(checkEmailNetworkUrl('http://cliente.com/a.png').ok).toBe(true);
  });

  it.each([
    ['http://169.254.169.254/latest/meta-data/iam/', 'internal_host'],
    ['http://127.0.0.1:6379/', 'internal_host'],
    ['http://localhost:3000/api/v1/members', 'internal_host'],
    ['http://[::1]/', 'internal_host'],
    // O parser WHATWG canoniza as formas alternativas de IP: é por isso que a
    // decisão é tomada sobre `URL.hostname`, nunca sobre a string crua.
    ['http://2130706433/', 'internal_host'],
    ['http://0x7f.1/', 'internal_host'],
    ['http://0177.0.0.1/', 'internal_host'],
    ['https://user:senha@cliente.com/', 'credentials'],
    ['ftp://cliente.com/a', 'scheme'],
    ['file:///etc/passwd', 'scheme'],
    ['gopher://127.0.0.1:6379/_FLUSHALL', 'scheme'],
    ['não é url', 'invalid_url'],
  ])('%s → %s', (url, motivo) => {
    const r = checkEmailNetworkUrl(url);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(motivo);
  });
});
