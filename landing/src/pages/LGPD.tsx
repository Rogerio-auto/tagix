import { Container } from "../components/ui/Container";
import { usePageMeta } from "../hooks/usePageMeta";

const LGPD = () => {
  usePageMeta({
    title: "Conformidade LGPD",
    description: "Como a Leadium trata privacidade e segurança de dados sob a Lei Geral de Proteção de Dados.",
  });

  return (
    <section className="py-20">
      <Container>
        <div className="mx-auto max-w-3xl">
          <div className="mb-10 text-center">
            <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary mb-4">
              Conformidade LGPD
            </span>
            <h1 className="text-4xl font-bold text-foreground mb-4">Proteção de dados e transparência</h1>
            <p className="text-lg text-muted-foreground">
              Como a Leadium protege a sua operação e a privacidade dos seus clientes finais.
            </p>
          </div>

          <div className="space-y-12 text-muted-foreground leading-relaxed">
            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">O que é a LGPD?</h2>
              <p>
                A Lei Geral de Proteção de Dados (Lei nº 13.709/2018) regulamenta o tratamento de dados pessoais no Brasil, garantindo direitos fundamentais de liberdade e privacidade. Na Leadium, a privacidade é uma decisão de arquitetura — não um ajuste de última hora.
              </p>
            </section>

            <section className="grid gap-6 md:grid-cols-2">
              <div className="p-6 bg-card/40 backdrop-blur-sm rounded-2xl border border-border/50">
                <h3 className="text-lg font-bold text-foreground mb-2">Finalidade específica</h3>
                <p className="text-sm">Tratamos apenas os dados necessários para operar o atendimento e as automações configuradas pelo cliente.</p>
              </div>
              <div className="p-6 bg-card/40 backdrop-blur-sm rounded-2xl border border-border/50">
                <h3 className="text-lg font-bold text-foreground mb-2">Isolamento por workspace</h3>
                <p className="text-sm">Os dados de cada cliente ficam isolados e separados no banco de dados, sem se misturar com os de outras empresas.</p>
              </div>
              <div className="p-6 bg-card/40 backdrop-blur-sm rounded-2xl border border-border/50">
                <h3 className="text-lg font-bold text-foreground mb-2">Credenciais criptografadas</h3>
                <p className="text-sm">As credenciais dos canais conectados são armazenadas de forma criptografada e o transporte ocorre sob TLS.</p>
              </div>
              <div className="p-6 bg-card/40 backdrop-blur-sm rounded-2xl border border-border/50">
                <h3 className="text-lg font-bold text-foreground mb-2">Controle do titular</h3>
                <p className="text-sm">Clientes podem desconectar canais e solicitar a exclusão de dados a qualquer momento.</p>
              </div>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">Nossa base de proteção</h2>
              <ul className="list-disc pl-5 space-y-2">
                <li><strong className="text-foreground">Canais oficiais da Meta:</strong> WhatsApp e Instagram pela API oficial, sem intermediários não autorizados.</li>
                <li><strong className="text-foreground">Autenticação dedicada:</strong> controle de acesso e identidade gerenciados sobre uma camada especializada, com provedores contratados sob obrigações de proteção de dados.</li>
                <li><strong className="text-foreground">Isolamento de dados:</strong> separação dos dados de cada cliente diretamente no banco de dados.</li>
                <li><strong className="text-foreground">Provedores de IA como sub-operadores:</strong> contratados sob obrigações de confidencialidade.</li>
              </ul>
            </section>

            <section className="rounded-3xl border border-border/50 bg-card/40 backdrop-blur-sm p-8">
              <h2 className="text-2xl font-semibold text-foreground mb-4">Central de privacidade</h2>
              <p className="text-muted-foreground mb-6">
                Dúvidas sobre como tratamos dados, exercício de direitos ou solicitação de exclusão? Fale com o nosso Encarregado de Proteção de Dados (DPO).
              </p>
              <a
                href="mailto:contato@leadium.com.br"
                className="inline-block px-6 py-3 bg-primary text-primary-foreground font-semibold rounded-full glow-primary transition-colors"
              >
                Falar com o DPO
              </a>
            </section>
          </div>
        </div>
      </Container>
    </section>
  );
};

export default LGPD;
