import type * as React from 'react';
import { LegalDocument, proseLinkClass, type LegalSection } from '../LegalDocument';

export const metadata = { title: 'Política de privacidade · Leadium' };

/**
 * Política de privacidade pública (F69-S01).
 *
 * Descreve o que o produto de fato faz com dados vindos da Meta, caso de uso por
 * caso de uso — o revisor do App Review compara este texto com o screencast, e
 * política genérica que não cita o uso real é motivo comum de reprovação.
 *
 * PENDENTE ANTES DA SUBMISSÃO: razão social, CNPJ/EIN e endereço do controlador,
 * e revisão jurídica (LGPD e leis estaduais americanas). Este texto não substitui
 * essa revisão.
 */

const ATUALIZADO_EM = '14 de setembro de 2026';

const SECOES: readonly LegalSection[] = [
  {
    id: 'quem-somos',
    title: 'Quem somos',
    body: (
      <>
        <p>
          O Leadium é uma plataforma de atendimento, vendas e marketing usada por empresas para
          conversar com os próprios clientes. As empresas que usam o Leadium são as responsáveis
          pelos dados dos clientes delas; o Leadium trata esses dados em nome delas, para prestar o
          serviço contratado.
        </p>
        <p>
          Contato para assuntos de privacidade:{' '}
          <a className={proseLinkClass} href="mailto:suporte@leadium.com.br">
            suporte@leadium.com.br
          </a>
          .
        </p>
      </>
    ),
  },
  {
    id: 'dados-da-meta',
    title: 'Dados que recebemos da Meta, e para quê',
    body: (
      <>
        <p>
          Só recebemos dados das contas que a própria empresa conecta ao Leadium, com as permissões
          que ela concede no login da Meta. Para cada uso:
        </p>
        <ul>
          <li>
            <strong>WhatsApp:</strong> mensagens enviadas e recebidas pelo número da empresa, e o
            nome de perfil de quem escreve, para exibir e responder as conversas.
          </li>
          <li>
            <strong>Instagram:</strong> mensagens diretas e comentários nos posts da própria
            empresa, para responder e moderar; e publicação de conteúdo que a empresa agendar.
          </li>
          <li>
            <strong>Leads de anúncios:</strong> as respostas que a pessoa enviou no formulário do
            anúncio da empresa, incluindo o texto de consentimento exibido, para que a empresa possa
            atender o pedido.
          </li>
          <li>
            <strong>Anúncios:</strong> dados de desempenho das campanhas da empresa (gasto, alcance,
            leads), para mostrar resultados; e, quando a empresa autoriza, alterações de status e
            orçamento feitas por membros dela.
          </li>
        </ul>
        <p>Não vendemos dados. Não usamos dados de uma empresa para atender outra.</p>
      </>
    ),
  },
  {
    id: 'compartilhamento',
    title: 'Com quem compartilhamos',
    body: (
      <p>
        Com provedores que operam partes do serviço, sob contrato e só para esse fim: hospedagem e
        armazenamento de arquivos, provedores de modelos de inteligência artificial usados nas
        respostas automáticas que a empresa ativar, e a própria Meta, ao enviar mensagens e eventos
        em nome da empresa.
      </p>
    ),
  },
  {
    id: 'retencao',
    title: 'Por quanto tempo guardamos',
    body: (
      <p>
        Enquanto a empresa mantiver a conta ativa, ou pelo prazo que a lei exigir. Tokens de acesso
        são guardados cifrados e apagados quando a conexão é removida ou o acesso é revogado.
      </p>
    ),
  },
  {
    id: 'seus-direitos',
    title: 'Seus direitos',
    body: (
      <p>
        Você pode pedir acesso, correção ou exclusão dos seus dados. Se você é cliente de uma
        empresa que usa o Leadium, o pedido pode ser feito à própria empresa ou a nós, pelo contato
        acima.
      </p>
    ),
  },
  {
    id: 'exclusao-de-dados',
    title: 'Exclusão de dados vindos do Facebook e do Instagram',
    body: (
      <>
        <p>
          Se você conectou uma conta da Meta ao Leadium, pode pedir a exclusão pelas configurações
          do Facebook, em <em>Configurações › Apps e sites</em>, removendo o Leadium e pedindo a
          exclusão dos dados. Você recebe um código de confirmação e pode acompanhar o pedido na
          página indicada.
        </p>
        <p>
          Também é possível pedir por e-mail, em{' '}
          <a className={proseLinkClass} href="mailto:suporte@leadium.com.br">
            suporte@leadium.com.br
          </a>
          .
        </p>
      </>
    ),
  },
];

export default function PrivacidadePage(): React.JSX.Element {
  return (
    <LegalDocument
      eyebrow="Documento público"
      title="Política de privacidade"
      updated={`Atualizada em ${ATUALIZADO_EM}`}
      sections={SECOES}
    />
  );
}
