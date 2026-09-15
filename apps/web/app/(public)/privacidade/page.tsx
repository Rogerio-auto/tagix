import type * as React from 'react';

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

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="font-head text-h3 text-text">{titulo}</h2>
      <div className="mt-3 space-y-3 text-body leading-relaxed text-text-2">{children}</div>
    </section>
  );
}

export default function PrivacidadePage(): React.JSX.Element {
  return (
    <article>
      <h1 className="font-head text-h1">Política de privacidade</h1>
      <p className="mt-2 text-small text-text-3">Atualizada em {ATUALIZADO_EM}</p>

      <Secao titulo="Quem somos">
        <p>
          O Leadium é uma plataforma de atendimento, vendas e marketing usada por empresas para
          conversar com os próprios clientes. As empresas que usam o Leadium são as responsáveis
          pelos dados dos clientes delas; o Leadium trata esses dados em nome delas, para prestar o
          serviço contratado.
        </p>
        <p>
          Contato para assuntos de privacidade:{' '}
          <a className="text-brand" href="mailto:suporte@leadium.com.br">
            suporte@leadium.com.br
          </a>
          .
        </p>
      </Secao>

      <Secao titulo="Dados que recebemos da Meta, e para quê">
        <p>
          Só recebemos dados das contas que a própria empresa conecta ao Leadium, com as permissões
          que ela concede no login da Meta. Para cada uso:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong className="text-text">WhatsApp:</strong> mensagens enviadas e recebidas pelo
            número da empresa, e o nome de perfil de quem escreve, para exibir e responder as
            conversas.
          </li>
          <li>
            <strong className="text-text">Instagram:</strong> mensagens diretas e comentários nos
            posts da própria empresa, para responder e moderar; e publicação de conteúdo que a
            empresa agendar.
          </li>
          <li>
            <strong className="text-text">Leads de anúncios:</strong> as respostas que a pessoa
            enviou no formulário do anúncio da empresa, incluindo o texto de consentimento exibido,
            para que a empresa possa atender o pedido.
          </li>
          <li>
            <strong className="text-text">Anúncios:</strong> dados de desempenho das campanhas da
            empresa (gasto, alcance, leads), para mostrar resultados; e, quando a empresa autoriza,
            alterações de status e orçamento feitas por membros dela.
          </li>
        </ul>
        <p>Não vendemos dados. Não usamos dados de uma empresa para atender outra.</p>
      </Secao>

      <Secao titulo="Com quem compartilhamos">
        <p>
          Com provedores que operam partes do serviço, sob contrato e só para esse fim: hospedagem e
          armazenamento de arquivos, provedores de modelos de inteligência artificial usados nas
          respostas automáticas que a empresa ativar, e a própria Meta, ao enviar mensagens e
          eventos em nome da empresa.
        </p>
      </Secao>

      <Secao titulo="Por quanto tempo guardamos">
        <p>
          Enquanto a empresa mantiver a conta ativa, ou pelo prazo que a lei exigir. Tokens de
          acesso são guardados cifrados e apagados quando a conexão é removida ou o acesso é
          revogado.
        </p>
      </Secao>

      <Secao titulo="Seus direitos">
        <p>
          Você pode pedir acesso, correção ou exclusão dos seus dados. Se você é cliente de uma
          empresa que usa o Leadium, o pedido pode ser feito à própria empresa ou a nós, pelo
          contato acima.
        </p>
      </Secao>

      <Secao titulo="Exclusão de dados vindos do Facebook e do Instagram">
        <p>
          Se você conectou uma conta da Meta ao Leadium, pode pedir a exclusão pelas configurações
          do Facebook, em <em>Configurações › Apps e sites</em>, removendo o Leadium e pedindo a
          exclusão dos dados. Você recebe um código de confirmação e pode acompanhar o pedido na
          página indicada.
        </p>
        <p>
          Também é possível pedir por e-mail, em{' '}
          <a className="text-brand" href="mailto:suporte@leadium.com.br">
            suporte@leadium.com.br
          </a>
          .
        </p>
      </Secao>
    </article>
  );
}
