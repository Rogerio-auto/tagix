/**
 * Testes dos parsers de coexistência WhatsApp Business (F39-S03). Puros (sem
 * rede/Meta real): envelopes sintéticos por field (echo/history/app_state),
 * idempotência por id externo e tolerância a shapes desconhecidos.
 */
import { describe, expect, it } from 'vitest';

import {
  parseCoexistence,
  hasCoexistenceFields,
  isCoexistenceField,
} from './coexistence';
import { parseWhatsAppWebhook } from './webhook.parser';

const PHONE_ID = '109876543210987';

/** Monta um envelope WABA com um único change `field`/`value`. */
function envelope(field: string, value: Record<string, unknown>): Record<string, unknown> {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA_ID', changes: [{ field, value }] }],
  };
}

const metadata = { metadata: { display_phone_number: '15551234567', phone_number_id: PHONE_ID } };

describe('isCoexistenceField', () => {
  it('reconhece os 3 grupos e rejeita o resto', () => {
    expect(isCoexistenceField('smb_message_echoes')).toBe(true);
    expect(isCoexistenceField('message_echoes')).toBe(true);
    expect(isCoexistenceField('history')).toBe(true);
    expect(isCoexistenceField('smb_app_state_sync')).toBe(true);
    expect(isCoexistenceField('messages')).toBe(false);
    expect(isCoexistenceField(undefined)).toBe(false);
    expect(isCoexistenceField(42)).toBe(false);
  });
});

describe('parseCoexistence — echoes', () => {
  it('extrai eco de texto com id/to/timestamp', () => {
    const result = parseCoexistence(
      envelope('smb_message_echoes', {
        ...metadata,
        message_echoes: [
          {
            id: 'wamid.ECHO1',
            to: '5511999999999',
            type: 'text',
            timestamp: '1700000000',
            text: { body: 'enviado pelo app' },
          },
        ],
      }),
    );

    expect(result.echoes).toHaveLength(1);
    expect(result.echoes[0]).toMatchObject({
      phoneNumberId: PHONE_ID,
      externalId: 'wamid.ECHO1',
      to: '5511999999999',
      type: 'text',
      text: 'enviado pelo app',
      timestamp: 1700000000,
    });
    expect(result.history).toHaveLength(0);
    expect(result.appStates).toHaveLength(0);
  });

  it('usa recipient_id como fallback de `to` e caption de mídia como texto', () => {
    const result = parseCoexistence(
      envelope('message_echoes', {
        ...metadata,
        message_echoes: [
          {
            id: 'wamid.ECHO2',
            recipient_id: '5511888888888',
            type: 'image',
            image: { id: 'MEDIA1', caption: 'foto' },
          },
        ],
      }),
    );
    expect(result.echoes[0]).toMatchObject({
      externalId: 'wamid.ECHO2',
      to: '5511888888888',
      type: 'image',
      text: 'foto',
    });
    expect(result.echoes[0]?.timestamp).toBeUndefined();
  });

  it('descarta ecos sem id ou sem destinatário', () => {
    const result = parseCoexistence(
      envelope('smb_message_echoes', {
        ...metadata,
        message_echoes: [{ type: 'text' }, { id: 'x', type: 'text' }],
      }),
    );
    expect(result.echoes).toHaveLength(0);
  });
});

describe('parseCoexistence — history', () => {
  it('normaliza batch com contacts/messages direto', () => {
    const result = parseCoexistence(
      envelope('history', {
        ...metadata,
        history: {
          phase: 'initial',
          contacts: [{ wa_id: '5511777777777', profile: { name: 'Maria' } }],
          messages: [
            {
              id: 'wamid.HIST1',
              from: '5511777777777',
              type: 'text',
              timestamp: 1699999000,
              text: { body: 'oi antigo' },
            },
            { id: 'wamid.HIST2', from_me: true, to: '5511777777777', type: 'text' },
          ],
        },
      }),
    );

    expect(result.history).toHaveLength(1);
    const batch = result.history[0]!;
    expect(batch.phoneNumberId).toBe(PHONE_ID);
    expect(batch.phase).toBe('initial');
    expect(batch.contacts).toEqual([
      { waId: '5511777777777', name: 'Maria', raw: expect.any(Object) },
    ]);
    expect(batch.messages[0]).toMatchObject({
      externalId: 'wamid.HIST1',
      from: '5511777777777',
      text: 'oi antigo',
      timestamp: 1699999000,
    });
    expect(batch.messages[1]).toMatchObject({ externalId: 'wamid.HIST2', fromMe: true });
  });

  it('achata o shape alternativo de threads', () => {
    const result = parseCoexistence(
      envelope('history', {
        ...metadata,
        history: {
          threads: [
            {
              contact: { wa_id: '5511666666666', name: 'João' },
              messages: [{ id: 'wamid.T1', direction: 'inbound', type: 'text' }],
            },
          ],
        },
      }),
    );
    const batch = result.history[0]!;
    expect(batch.contacts[0]?.waId).toBe('5511666666666');
    expect(batch.messages[0]).toMatchObject({ externalId: 'wamid.T1', fromMe: false });
  });
});

describe('parseCoexistence — app_state', () => {
  it('extrai estado de smb_app_state_sync', () => {
    const result = parseCoexistence(
      envelope('smb_app_state_sync', { ...metadata, smb_app_state_sync: { state: 'CONNECTED' } }),
    );
    expect(result.appStates).toEqual([
      { phoneNumberId: PHONE_ID, state: 'CONNECTED', raw: { state: 'CONNECTED' } },
    ]);
  });

  it('aceita status/event como aliases de state', () => {
    const r1 = parseCoexistence(
      envelope('smb_app_state_sync', { ...metadata, smb_app_state_sync: { status: 'SYNCING' } }),
    );
    expect(r1.appStates[0]?.state).toBe('SYNCING');
    const r2 = parseCoexistence(
      envelope('smb_app_state_sync', { ...metadata, event: 'LINKED' }),
    );
    expect(r2.appStates[0]?.state).toBe('LINKED');
  });

  it('descarta quando não há estado nem phone_number_id', () => {
    expect(
      parseCoexistence(envelope('smb_app_state_sync', { ...metadata, smb_app_state_sync: {} }))
        .appStates,
    ).toHaveLength(0);
    expect(
      parseCoexistence(envelope('smb_app_state_sync', { smb_app_state_sync: { state: 'X' } }))
        .appStates,
    ).toHaveLength(0);
  });
});

describe('parseCoexistence — tolerância', () => {
  it('ignora envelopes não-WABA e campos desconhecidos', () => {
    expect(parseCoexistence(null)).toEqual({ echoes: [], history: [], appStates: [] });
    expect(parseCoexistence({ object: 'instagram', entry: [] })).toEqual({
      echoes: [],
      history: [],
      appStates: [],
    });
    expect(
      parseCoexistence(envelope('messages', { ...metadata, messages: [] })),
    ).toEqual({ echoes: [], history: [], appStates: [] });
  });

  it('hasCoexistenceFields detecta presença/ausência', () => {
    expect(
      hasCoexistenceFields(envelope('history', { ...metadata, history: {} })),
    ).toBe(true);
    expect(hasCoexistenceFields(envelope('messages', { ...metadata, messages: [] }))).toBe(false);
    expect(hasCoexistenceFields(null)).toBe(false);
  });
});

describe('parseWhatsAppWebhook — não confunde coexistência com inbound', () => {
  it('não emite InboundEvent para fields de coexistência', () => {
    expect(
      parseWhatsAppWebhook(
        envelope('smb_message_echoes', {
          ...metadata,
          message_echoes: [{ id: 'wamid.E', to: '5511999999999', type: 'text' }],
        }),
      ),
    ).toEqual([]);
  });

  it('ainda parseia messages inbound normalmente', () => {
    const events = parseWhatsAppWebhook(
      envelope('messages', {
        ...metadata,
        messages: [
          { from: '5511999999999', id: 'wamid.IN', timestamp: '1700000000', type: 'text', text: { body: 'oi' } },
        ],
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'message', externalId: 'wamid.IN' });
  });
});
