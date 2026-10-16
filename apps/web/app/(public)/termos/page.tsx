import type * as React from 'react';
import { LegalDocument, proseLinkClass, type LegalSection } from '../LegalDocument';

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

const SECOES: readonly LegalSection[] = [
  {
    id: 'servico',
    title: 'O serviço',
    body: (
      <p>
        O Leadium oferece ferramentas para empresas atenderem, venderem e fazerem marketing pelos
        próprios canais: WhatsApp, Instagram, e-mail e anúncios. A empresa contratante é
        responsável pelas contas que conecta e pelo que envia por elas.
      </p>
    ),
  },
  {
    id: 'uso-permitido',
    title: 'Uso permitido',
    body: (
      <ul>
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
    ),
  },
  {
    id: 'anuncios-e-automacoes',
    title: 'Anúncios e automações',
    body: (
      <p>
        Alterações de orçamento e de status de campanhas são feitas por membros autorizados da
        empresa e ficam registradas. Sugestões geradas por inteligência artificial só são
        aplicadas depois de aprovadas por uma pessoa.
      </p>
    ),
  },
  {
    id: 'contas-de-terceiros',
    title: 'Contas de terceiros',
    body: (
      <p>
        Ao conectar uma conta da Meta, a empresa declara ter autorização para operá-la. O acesso
        pode ser revogado a qualquer momento pelas configurações da Meta ou do Leadium.
      </p>
    ),
  },
  {
    id: 'privacidade',
    title: 'Privacidade',
    body: (
      <p>
        O tratamento de dados segue a{' '}
        <a className={proseLinkClass} href="/privacidade">
          política de privacidade
        </a>
        .
      </p>
    ),
  },
  {
    id: 'contato',
    title: 'Contato',
    body: (
      <p>
        <a className={proseLinkClass} href="mailto:suporte@leadium.com.br">
          suporte@leadium.com.br
        </a>
      </p>
    ),
  },
];

export default function TermosPage(): React.JSX.Element {
  return (
    <LegalDocument
      eyebrow="Documento público"
      title="Termos de uso"
      updated={`Atualizados em ${ATUALIZADO_EM}`}
      sections={SECOES}
    />
  );
}
