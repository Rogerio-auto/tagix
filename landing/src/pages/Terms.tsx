import { Link } from "react-router-dom";
import { Container } from "../components/ui/Container";
import { usePageMeta } from "../hooks/usePageMeta";

const Terms = () => {
  usePageMeta({
    title: "Termos de Uso",
    description: "Condições para utilização da plataforma de atendimento, vendas conversacionais e automação da Leadium.",
  });

  return (
    <section className="py-20">
      <Container>
        <div className="mx-auto max-w-3xl">
          <h1 className="text-4xl font-bold text-foreground mb-3">Termos de Uso</h1>
          <p className="text-sm text-muted-foreground/70 mb-10">Última atualização: 18 de junho de 2026</p>

          <div className="space-y-10 text-muted-foreground leading-relaxed">
            <p>
              Estes Termos de Uso ("Termos") regem o acesso e a utilização da plataforma <strong className="text-foreground">Leadium</strong> ("Serviço"). Ao criar uma conta ou utilizar o Serviço, você ("Cliente") concorda com estes Termos. Caso não concorde, não utilize o Serviço.
            </p>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">1. Descrição do Serviço</h2>
              <p>
                A Leadium oferece uma plataforma de atendimento, vendas conversacionais e automação, com integração a canais de mensageria (incluindo WhatsApp e Instagram via APIs oficiais da Meta), construtor de fluxos, agentes de inteligência artificial, gestão de leads, agendamentos e campanhas.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">2. Cadastro e conta</h2>
              <p>
                Para usar o Serviço, é necessário fornecer informações verdadeiras e manter suas credenciais em sigilo. Você é responsável por todas as atividades realizadas em sua conta. O Cliente deve ter pelo menos 18 anos e capacidade legal para contratar.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">3. Uso aceitável</h2>
              <p>Você concorda em <strong className="text-foreground">não</strong>:</p>
              <ul className="list-disc pl-5 mt-4 space-y-3">
                <li>Enviar spam, mensagens não solicitadas ou conteúdo enganoso, ilegal, difamatório ou que viole direitos de terceiros;</li>
                <li>Violar as políticas da Meta, do WhatsApp Business ou do Instagram, incluindo regras de opt-in, qualidade e modelos de mensagem;</li>
                <li>Tentar burlar limites técnicos, acessar áreas não autorizadas, realizar engenharia reversa ou comprometer a segurança do Serviço;</li>
                <li>Utilizar o Serviço para finalidades que infrinjam a legislação aplicável.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">4. Responsabilidades do Cliente</h2>
              <p>
                O Cliente é o controlador dos dados de seus clientes finais e é responsável por: (a) obter o consentimento e a base legal adequada para as comunicações; (b) cumprir a LGPD e as políticas das plataformas conectadas; (c) o conteúdo das mensagens enviadas; e (d) o uso que faz das automações e dos agentes de IA configurados.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">5. Serviços de terceiros</h2>
              <p>
                O Serviço integra-se a plataformas de terceiros (como a Meta e provedores de modelos de IA). O uso dessas integrações também está sujeito aos termos e políticas desses terceiros. A Leadium não se responsabiliza por indisponibilidades, mudanças ou restrições impostas por esses provedores.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">6. Propriedade intelectual</h2>
              <p>
                O Serviço, sua marca, software, design e conteúdos são de titularidade da Leadium e protegidos por lei. Estes Termos não transferem qualquer direito de propriedade intelectual ao Cliente, exceto a licença limitada e revogável de uso do Serviço. Os dados e o conteúdo inseridos pelo Cliente permanecem de sua titularidade.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">7. Planos e pagamento</h2>
              <p>
                O acesso a determinadas funcionalidades pode depender de plano contratado. Valores, ciclos e condições de cobrança, quando aplicáveis, são informados no momento da contratação. O não pagamento pode resultar em suspensão ou encerramento do acesso.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">8. Isenções e limitação de responsabilidade</h2>
              <p>
                O Serviço é fornecido "no estado em que se encontra". Na máxima extensão permitida pela lei, a Leadium não será responsável por danos indiretos, incidentais ou lucros cessantes. A responsabilidade total da Leadium fica limitada aos valores efetivamente pagos pelo Cliente nos 12 meses anteriores ao evento que originou a reclamação.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">9. Indenização</h2>
              <p>
                O Cliente concorda em indenizar a Leadium por perdas decorrentes do uso indevido do Serviço, da violação destes Termos ou da violação de direitos de terceiros e da legislação aplicável.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">10. Suspensão e encerramento</h2>
              <p>
                Podemos suspender ou encerrar o acesso em caso de violação destes Termos, risco à segurança ou exigência legal. O Cliente pode encerrar sua conta a qualquer momento. Após o encerramento, os dados serão tratados conforme a{" "}
                <Link to="/privacidade" className="text-primary hover:underline">Política de Privacidade</Link>.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">11. Alterações</h2>
              <p>
                Podemos atualizar estes Termos periodicamente. A data de "Última atualização" reflete a versão vigente. O uso continuado do Serviço após mudanças relevantes constitui aceitação.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">12. Lei aplicável e foro</h2>
              <p>
                Estes Termos são regidos pelas leis da República Federativa do Brasil. Fica eleito o foro do domicílio do Cliente para dirimir controvérsias, quando aplicável a legislação consumerista.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">13. Contato</h2>
              <p>
                Dúvidas sobre estes Termos:{" "}
                <a href="mailto:contato@leadium.com.br" className="text-primary hover:underline">contato@leadium.com.br</a>.
              </p>
            </section>
          </div>
        </div>
      </Container>
    </section>
  );
};

export default Terms;
