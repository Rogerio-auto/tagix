import type * as React from 'react';

export const metadata = { title: 'Termos de uso · Leadium' };

/**
 * Termos de uso públicos (F69-S01).
 *
 * PENDENTE ANTES DA SUBMISSÃO: razão social e foro do contratante, e revisão
 * jurídica. Este texto registra as regras de uso que o produto já aplica em
 * código — consentimento, supressão, aprovação humana de gasto — para que o termo
 * e o comportamento não se contradigam.
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

export default function TermosPage(): React.JSX.Element {
  return (
    <article>
      <h1 className="font-head text-h1">Termos de uso</h1>
      <p className="mt-2 text-small text-text-3">Atualizados em {ATUALIZADO_EM}</p>

      <Secao titulo="O serviço">
        <p>
          O Leadium oferece ferramentas para empresas atenderem, venderem e fazerem marketing pelos
          próprios canais: WhatsApp, Instagram, e-mail e anúncios. A empresa contratante é
          responsável pelas contas que conecta e pelo que envia por elas.
        </p>
      </Secao>

      <Secao titulo="Uso permitido">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Mensagens de marketing só podem ser enviadas a quem consentiu recebê-las, e o
            consentimento deve ser registrado com a origem.
          </li>
          <li>
            Quem pedir para não receber mais mensagens é bloqueado de imediato, e a empresa não pode
            contornar esse bloqueio.
          </li>
          <li>
            É proibido usar o serviço para spam, para contatar listas compradas ou para qualquer
            finalidade que viole as políticas da Meta ou a lei aplicável.
          </li>
        </ul>
      </Secao>

      <Secao titulo="Anúncios e automações">
        <p>
          Alterações de orçamento e de status de campanhas são feitas por membros autorizados da
          empresa e ficam registradas. Sugestões geradas por inteligência artificial só são
          aplicadas depois de aprovadas por uma pessoa.
        </p>
      </Secao>

      <Secao titulo="Contas de terceiros">
        <p>
          Ao conectar uma conta da Meta, a empresa declara ter autorização para operá-la. O acesso
          pode ser revogado a qualquer momento pelas configurações da Meta ou do Leadium.
        </p>
      </Secao>

      <Secao titulo="Privacidade">
        <p>
          O tratamento de dados segue a{' '}
          <a className="text-brand" href="/privacidade">
            política de privacidade
          </a>
          .
        </p>
      </Secao>

      <Secao titulo="Contato">
        <p>
          <a className="text-brand" href="mailto:suporte@leadium.com.br">
            suporte@leadium.com.br
          </a>
        </p>
      </Secao>
    </article>
  );
}
