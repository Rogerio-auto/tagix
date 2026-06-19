import { Container } from "../components/ui/Container";
import { usePageMeta } from "../hooks/usePageMeta";

const Privacy = () => {
  usePageMeta({
    title: "Política de Privacidade",
    description: "Como a Leadium coleta, usa, compartilha e protege dados, incluindo Dados de Plataforma da Meta (WhatsApp e Instagram), em conformidade com a LGPD.",
  });

  return (
    <section className="py-20">
      <Container>
        <div className="mx-auto max-w-3xl">
          <h1 className="text-4xl font-bold text-foreground mb-3">Política de Privacidade</h1>
          <p className="text-sm text-muted-foreground/70 mb-10">Última atualização: 18 de junho de 2026</p>

          <div className="space-y-10 text-muted-foreground leading-relaxed">
            <p>
              Esta Política de Privacidade descreve como a <strong className="text-foreground">Leadium</strong> ("Leadium", "nós") coleta, utiliza, compartilha e protege informações ao fornecer sua plataforma de atendimento, vendas conversacionais e automação ("Serviço"). Ao utilizar o Serviço, você concorda com as práticas aqui descritas. Tratamos dados pessoais em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018 — "LGPD").
            </p>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">1. Papéis no tratamento de dados</h2>
              <p>
                A Leadium atua como <strong className="text-foreground">controladora</strong> em relação aos dados de cadastro e uso dos clientes que contratam o Serviço. Em relação às mensagens e aos dados de clientes finais que trafegam pelos canais de atendimento (por exemplo, conversas de WhatsApp e Instagram), a Leadium atua como <strong className="text-foreground">operadora</strong>, tratando esses dados em nome e sob as instruções do cliente, que é a controladora desses dados.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">2. Dados que coletamos</h2>
              <ul className="list-disc pl-5 mt-2 space-y-3">
                <li><strong className="text-foreground">Dados de conta:</strong> nome, e-mail, dados de login, função (papel) no workspace e preferências.</li>
                <li><strong className="text-foreground">Dados de comunicação (Dados de Plataforma):</strong> mensagens, contatos, identificadores e metadados recebidos por meio das APIs da Meta (WhatsApp Business e Instagram) e demais canais conectados, necessários para prestar o atendimento.</li>
                <li><strong className="text-foreground">Dados de uso e técnicos:</strong> registros de acesso, endereço IP, tipo de dispositivo/navegador, eventos de uso e cookies estritamente necessários à autenticação e ao funcionamento.</li>
                <li><strong className="text-foreground">Dados de conversão e negócio:</strong> informações inseridas pelos clientes para gestão de leads, pipelines, agendamentos e campanhas.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">3. Como usamos os dados</h2>
              <ul className="list-disc pl-5 mt-2 space-y-3">
                <li>Operar, manter e melhorar o Serviço e suas funcionalidades.</li>
                <li>Encaminhar, processar e responder mensagens nos canais conectados.</li>
                <li>Executar automações, fluxos e agentes de inteligência artificial configurados pelo cliente.</li>
                <li>Autenticar usuários, prevenir fraude e abuso e garantir a segurança.</li>
                <li>Cumprir obrigações legais e regulatórias.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">4. Dados de Plataforma da Meta (WhatsApp e Instagram)</h2>
              <p>
                Quando um cliente conecta uma conta do WhatsApp Business ou do Instagram, a Leadium acessa e processa Dados de Plataforma <strong className="text-foreground">exclusivamente</strong> para prestar o Serviço solicitado pelo cliente. Cumprimos os Termos da Plataforma da Meta e as políticas aplicáveis. Não vendemos Dados de Plataforma, não os usamos para publicidade direcionada e não os utilizamos para finalidades incompatíveis com o atendimento contratado. O acesso é limitado ao necessário e revogável a qualquer momento pelo cliente, desconectando o canal.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">5. Inteligência artificial</h2>
              <p>
                O Serviço pode utilizar modelos de linguagem para gerar respostas, classificar mensagens e apoiar o atendimento. Conteúdos de conversa podem ser enviados a provedores de modelos de IA (sub-operadores) estritamente para gerar a resposta solicitada. Esses provedores são contratados sob obrigações de confidencialidade e não utilizam o conteúdo para treinar modelos próprios quando assim configurado.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">6. Compartilhamento</h2>
              <p>
                Não vendemos dados pessoais. Podemos compartilhar dados com: (a) <strong className="text-foreground">sub-operadores</strong> que viabilizam o Serviço (hospedagem, provedores de modelos de IA, infraestrutura de mensageria); (b) a <strong className="text-foreground">Meta Platforms</strong>, na medida necessária para operar os canais; (c) <strong className="text-foreground">autoridades</strong>, quando exigido por lei. Todos os sub-operadores estão sujeitos a obrigações contratuais de proteção de dados.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">7. Retenção</h2>
              <p>
                Retemos dados pelo tempo necessário para prestar o Serviço, cumprir obrigações legais e resolver disputas. Encerrada a relação, os dados do cliente são excluídos ou anonimizados em prazo razoável, salvo retenção exigida por lei.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">8. Segurança</h2>
              <p>
                Adotamos medidas técnicas e organizacionais para proteger os dados, incluindo criptografia de credenciais sensíveis, controle de acesso baseado em função, isolamento multi-tenant (Row-Level Security) e transporte sob TLS. Nenhum sistema é totalmente imune a riscos, mas trabalhamos continuamente para mitigá-los.
              </p>
            </section>

            <section id="exclusao-de-dados" className="scroll-mt-24 rounded-3xl border border-primary/20 bg-primary/5 p-6">
              <h2 className="text-2xl font-semibold text-foreground mb-4">9. Seus direitos e exclusão de dados</h2>
              <p>
                Nos termos da LGPD, você pode solicitar confirmação de tratamento, acesso, correção, anonimização, portabilidade, eliminação e informações sobre compartilhamento dos seus dados pessoais.
              </p>
              <p className="mt-4">
                <strong className="text-foreground">Para solicitar a exclusão dos seus dados</strong>, envie um e-mail para{" "}
                <a href="mailto:contato@leadium.com.br" className="text-primary hover:underline">contato@leadium.com.br</a>{" "}
                com o assunto "Exclusão de dados" e a identificação da conta ou do número/perfil associado. Processaremos a solicitação em prazo razoável e confirmaremos a conclusão. Clientes também podem desconectar canais e remover dados diretamente no painel do Serviço.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">10. Transferências internacionais</h2>
              <p>
                Alguns sub-operadores podem processar dados fora do Brasil. Nesses casos, adotamos salvaguardas adequadas, conforme exigido pela LGPD.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">11. Crianças</h2>
              <p>
                O Serviço não se destina a menores de 18 anos e não coletamos intencionalmente dados de crianças e adolescentes sem o consentimento dos responsáveis.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">12. Alterações</h2>
              <p>
                Podemos atualizar esta Política periodicamente. A data de "Última atualização" reflete a versão vigente. Mudanças relevantes serão comunicadas pelos canais apropriados.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">13. Contato</h2>
              <p>
                Para dúvidas sobre privacidade ou para exercer seus direitos, fale com o nosso Encarregado de Proteção de Dados (DPO):
              </p>
              <p className="mt-4">
                <strong className="text-foreground">E-mail:</strong>{" "}
                <a href="mailto:contato@leadium.com.br" className="text-primary hover:underline">contato@leadium.com.br</a>
              </p>
            </section>
          </div>
        </div>
      </Container>
    </section>
  );
};

export default Privacy;
