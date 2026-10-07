/**
 * Modelos de exemplo no formato sincronizado da Meta — usados pelos testes da
 * etapa Mensagem. Ficam num arquivo próprio para os testes de regra e de
 * renderização falarem dos MESMOS modelos.
 */
import type { TemplateOption } from './model';

export const CHANNEL = '00000000-0000-4000-8000-000000000001';

/** Sem nenhum campo para preencher. */
export const PLAIN: TemplateOption = {
  id: '10000000-0000-4000-8000-000000000001',
  channelId: CHANNEL,
  name: 'aviso_loja_aberta',
  language: 'pt_BR',
  category: 'UTILITY',
  components: [{ type: 'BODY', text: 'Olá! A loja já está *aberta* hoje.' }],
};

/** Título com variável, corpo com duas, rodapé e dois botões (um com link variável). */
export const RICH: TemplateOption = {
  id: '10000000-0000-4000-8000-000000000002',
  channelId: CHANNEL,
  name: 'pedido_confirmado',
  language: 'pt_BR',
  category: 'MARKETING',
  components: [
    { type: 'HEADER', format: 'TEXT', text: 'Pedido {{1}}', example: { header_text: ['PED-7'] } },
    {
      type: 'BODY',
      text: 'Olá {{1}}, seu pedido chega em {{2}}.',
      example: { body_text: [['Ana', '3 dias']] },
    },
    { type: 'FOOTER', text: 'Loja Exemplo' },
    {
      type: 'BUTTONS',
      buttons: [
        { type: 'QUICK_REPLY', text: 'Falar com atendente' },
        {
          type: 'URL',
          text: 'Ver pedido',
          url: 'https://loja.exemplo/p/{{1}}',
          example: ['https://loja.exemplo/p/abc'],
        },
      ],
    },
  ],
};

/** Cabeçalho com imagem. */
export const MEDIA: TemplateOption = {
  id: '10000000-0000-4000-8000-000000000003',
  channelId: CHANNEL,
  name: 'promo_marco',
  language: 'pt_BR',
  category: 'MARKETING',
  components: [
    { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['https://cdn.externo/x.jpg'] } },
    { type: 'BODY', text: 'Promoção de março para {{1}}!' },
    {
      type: 'BUTTONS',
      buttons: [{ type: 'PHONE_NUMBER', text: 'Ligar', phone_number: '+5511999990000' }],
    },
  ],
};

/** Mesmo nome em inglês — dois idiomas do mesmo modelo. */
export const PLAIN_EN: TemplateOption = {
  ...PLAIN,
  id: '10000000-0000-4000-8000-000000000004',
  language: 'en_US',
  components: [{ type: 'BODY', text: 'Hi! The store is open today.' }],
};

export const APPROVED: readonly TemplateOption[] = [PLAIN, RICH, MEDIA, PLAIN_EN];
