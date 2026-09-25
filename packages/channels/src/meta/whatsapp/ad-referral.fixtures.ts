/**
 * Fixtures de webhook com `referral` (F70-S05), no formato da documentação da
 * Meta — WhatsApp Cloud API, "Webhooks > messages > Received message triggered
 * by Click to WhatsApp ads" — e Instagram Messaging (Click-to-Instagram-Direct).
 * Identificadores trocados por valores fictícios com o mesmo formato.
 */

/** Click-to-WhatsApp: primeira mensagem de texto depois do clique num anúncio. */
export const CTWA_TEXT_WEBHOOK = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '102290129340398',
      changes: [
        {
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: '5511987654321',
              phone_number_id: '106540352242922',
            },
            contacts: [{ profile: { name: 'Marina Souza' }, wa_id: '5521991234567' }],
            messages: [
              {
                referral: {
                  source_url: 'https://fb.me/3cr4Wqqkv',
                  source_id: '120210000000000123',
                  source_type: 'ad',
                  headline: 'Site profissional para clínicas em 5 dias',
                  body: 'Fale com a gente pelo WhatsApp e receba o portfólio.',
                  media_type: 'image',
                  image_url: 'https://scontent.xx.fbcdn.net/v/t45.1600-4/ad_image.jpg',
                  thumbnail_url: 'https://scontent.xx.fbcdn.net/v/t45.1600-4/ad_thumb.jpg',
                  ctwa_clid:
                    'ARAkLkA8rmlFeiCktEJQ-QTwRiyYHAFDLMNDBH0CD3qpjd0HR4irJ6LEkR7JwFF4XvnO2E4Nx0-eM-GABDLOPaOdRMv-_zfUQ2a',
                  welcome_message: { text: 'Olá! Quer ver nosso portfólio?' },
                },
                from: '5521991234567',
                id: 'wamid.HBgNNTUyMTk5MTIzNDU2NxUCABIYFjNFQjBDMEQ4RjYzQjFBQzM1RTg5AA==',
                timestamp: '1758720000',
                type: 'text',
                text: { body: 'Olá! Tenho interesse e queria mais informações, por favor.' },
              },
            ],
          },
          field: 'messages',
        },
      ],
    },
  ],
} as const;

/** CTWA de post impulsionado, com vídeo, chegando como imagem (tipo de mídia na mensagem). */
export const CTWA_POST_IMAGE_WEBHOOK = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '102290129340398',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '5511987654321', phone_number_id: '106540352242922' },
            contacts: [{ profile: { name: 'Carlos' }, wa_id: '5531988887777' }],
            messages: [
              {
                referral: {
                  source_url: 'https://www.instagram.com/p/C9xYzAbCdEf/',
                  source_id: '17912345678901234',
                  source_type: 'post',
                  headline: 'Antes e depois',
                  media_type: 'video',
                  video_url: 'https://video.xx.fbcdn.net/v/t42.1790-2/ad_video.mp4',
                },
                from: '5531988887777',
                id: 'wamid.POST_IMAGE',
                timestamp: '1758723600',
                type: 'image',
                image: { id: 'MEDIA_ID_1', mime_type: 'image/jpeg', sha256: 'abc' },
              },
            ],
          },
        },
      ],
    },
  ],
} as const;

/** Instagram: primeira DM vinda de anúncio (referral dentro de `message`). */
export const IG_AD_MESSAGE_WEBHOOK = {
  object: 'instagram',
  entry: [
    {
      id: '17841400000000000',
      time: 1758720000000,
      messaging: [
        {
          sender: { id: '7010000000000001' },
          recipient: { id: '17841400000000000' },
          timestamp: 1758720000000,
          message: {
            mid: 'aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE3ODQx',
            text: 'Quero saber o valor do site',
            referral: {
              ref: 'arcada_setembro',
              ad_id: '120210000000000456',
              source: 'ADS',
              type: 'OPEN_THREAD',
              ads_context_data: {
                ad_title: 'Seu consultório com site em 5 dias',
                photo_url: 'https://scontent.cdninstagram.com/v/ad_photo.jpg',
                post_id: '17999999999999999',
              },
            },
          },
        },
      ],
    },
  ],
} as const;
