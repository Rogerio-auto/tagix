/**
 * Niche Blueprint — Varejo (`retail`).
 *
 * Funil catálogo → pedido → recompra. Agente vendedor (`sales_retail`).
 * Flows POPULADOS (boas-vindas/catálogo/fechamento/recompra) — F43-S09.
 */
import type { NicheBlueprint } from '../types';

export const retailBlueprint: NicheBlueprint = {
  key: 'retail',
  name: 'Varejo',
  industry: 'retail',
  pipeline: {
    name: 'Funil de Vendas Varejo',
    description: 'Pipeline para vendas pelo catálogo e recompra.',
    customFields: [
      { key: 'product_interest', label: 'Produto de interesse', type: 'text', required: false, position: 0 },
      { key: 'order_value_brl', label: 'Valor do pedido (R$)', type: 'currency', required: false, position: 1 },
      { key: 'payment_method', label: 'Forma de pagamento', type: 'select', required: false, options: ['Pix', 'Cartão', 'Boleto', 'Dinheiro'], position: 2 },
      { key: 'delivery', label: 'Entrega ou retirada', type: 'select', required: false, options: ['Entrega', 'Retirada'], position: 3 },
    ],
    stages: [
      { name: 'Novo contato', color: '#1FFF13', position: 0, probability: 10 },
      { name: 'Catálogo enviado', color: '#13C7FF', position: 1, probability: 30 },
      { name: 'Carrinho/negociação', color: '#FFB413', position: 2, probability: 55 },
      { name: 'Pedido fechado', color: '#13FF6B', position: 3, isWon: true, probability: 100 },
      { name: 'Recompra', color: '#9B13FF', position: 4, probability: 90 },
      { name: 'Não comprou', color: '#FF4136', position: 5, isLost: true, probability: 0 },
    ],
  },
  agents: [{ templateKey: 'sales_retail' }],
  tags: [
    { name: 'Novo cliente', color: '#1FFF13' },
    { name: 'Recorrente', color: '#13C7FF' },
    { name: 'Atacado', color: '#9B13FF' },
    { name: 'Promoção', color: '#FFB413' },
    { name: 'Carrinho abandonado', color: '#FF8C13' },
  ],
  conversionTypes: [
    { key: 'catalog_sent', label: 'Catálogo enviado', icon: 'list', color: '#13C7FF', position: 0 },
    { key: 'order', label: 'Pedido', icon: 'shopping-cart', color: '#13FF6B', valueRequired: true, valueLabel: 'Valor do pedido (R$)', isDefault: true, position: 1 },
    { key: 'repurchase', label: 'Recompra', icon: 'repeat', color: '#9B13FF', valueRequired: true, valueLabel: 'Valor da recompra (R$)', position: 2 },
  ],
  departments: [
    { name: 'Vendas', description: 'Atendimento de catálogo e pedidos.' },
    { name: 'Pós-venda', description: 'Recompra, trocas e suporte ao cliente.' },
  ],
  quickReplies: [
    { title: 'Boas-vindas', body: 'Olá! Bem-vindo(a). Quer ver nosso catálogo ou já sabe o que procura?', departmentName: 'Vendas', position: 0 },
    { title: 'Enviar catálogo', body: 'Aqui está nosso catálogo atualizado. Me avisa qual produto te interessou que eu reservo!', departmentName: 'Vendas', position: 1 },
    { title: 'Formas de pagamento', body: 'Aceitamos Pix, cartão, boleto e dinheiro. Como prefere pagar?', departmentName: 'Vendas', position: 2 },
    { title: 'Recompra', body: 'Oi! Chegaram novidades que combinam com sua última compra. Quer dar uma olhada?', departmentName: 'Pós-venda', position: 3 },
  ],
  flows: [
    {
      name: 'Boas-vindas Varejo',
      description: 'Acolhe o cliente e oferece o catálogo.',
      status: 'active',
      triggerType: 'new_lead',
      nodes: [
        { id: 'start', type: 'trigger', data: { label: 'Novo contato' } },
        { id: 'welcome', type: 'send_message', data: { text: 'Olá! Bem-vindo(a) à nossa loja. Quer ver o catálogo ou já sabe o que procura?' } },
        { id: 'ask_interest', type: 'send_message', data: { text: 'Me conta qual produto ou categoria te interessa que eu te ajudo.' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'welcome' },
        { id: 'e2', source: 'welcome', target: 'ask_interest' },
      ],
    },
    {
      name: 'Catálogo e Qualificação',
      description: 'Envia o catálogo e identifica o produto de interesse.',
      status: 'active',
      triggerType: 'keyword',
      triggerConfig: { keywords: ['catálogo', 'catalogo', 'preço', 'preco', 'produto', 'comprar', 'promoção', 'promocao'] },
      nodes: [
        { id: 'start', type: 'trigger', data: { label: 'Palavra-chave' } },
        { id: 'send_catalog', type: 'send_message', data: { text: 'Aqui está nosso catálogo atualizado. Qual produto chamou sua atenção?' } },
        { id: 'ask_payment', type: 'send_message', data: { text: 'Como prefere pagar: Pix, cartão, boleto ou dinheiro? E é entrega ou retirada?' } },
        { id: 'tag', type: 'add_tag', data: { tag: 'Novo cliente' } },
        { id: 'move', type: 'move_stage', data: { stage: 'Catálogo enviado' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'send_catalog' },
        { id: 'e2', source: 'send_catalog', target: 'ask_payment' },
        { id: 'e3', source: 'ask_payment', target: 'tag' },
        { id: 'e4', source: 'tag', target: 'move' },
      ],
    },
    {
      name: 'Fechamento de Pedido',
      description: 'Confirma itens, pagamento e fecha o pedido.',
      status: 'active',
      triggerType: 'manual',
      nodes: [
        { id: 'start', type: 'trigger', data: { label: 'Manual' } },
        { id: 'confirm', type: 'send_message', data: { text: 'Vou confirmar seu pedido: itens, valor e forma de pagamento. Posso fechar?' } },
        { id: 'order', type: 'register_conversion', data: { conversionType: 'order' } },
        { id: 'move', type: 'move_stage', data: { stage: 'Pedido fechado' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'confirm' },
        { id: 'e2', source: 'confirm', target: 'order' },
        { id: 'e3', source: 'order', target: 'move' },
      ],
    },
    {
      name: 'Recompra e Recuperação de Carrinho',
      description: 'Reengaja carrinho abandonado e incentiva a recompra.',
      status: 'active',
      triggerType: 'manual',
      nodes: [
        { id: 'start', type: 'trigger', data: { label: 'Manual' } },
        { id: 'wait', type: 'wait', data: { duration: '1d' } },
        { id: 'nudge', type: 'send_message', data: { text: 'Oi! Você deixou itens no carrinho. Quer que eu finalize seu pedido? Tenho uma condição especial pra hoje.' } },
        { id: 'tag', type: 'add_tag', data: { tag: 'Carrinho abandonado' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'wait' },
        { id: 'e2', source: 'wait', target: 'nudge' },
        { id: 'e3', source: 'nudge', target: 'tag' },
      ],
    },
  ],
};
