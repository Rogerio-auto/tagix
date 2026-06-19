import { FAQS } from "../../utils/constants";
import { Container } from "../ui/Container";
import { SectionHeading } from "../ui/SectionHeading";

export const FAQSection = () => (
  <section className="py-16">
    <Container>
      <SectionHeading
        eyebrow="FAQ"
        title="Dúvidas frequentes"
        description="Tudo o que você precisa saber sobre canais oficiais, IA, automação e segurança. Ficou alguma dúvida? Fale com o nosso time."
        align="center"
      />
      <div className="mx-auto max-w-3xl divide-y divide-border rounded-3xl border border-border bg-card/50 backdrop-blur-sm">
        {FAQS.map((faq) => (
          <details key={faq.question} className="group">
            <summary className="cursor-pointer list-none px-6 py-5 text-left text-base font-semibold text-foreground">
              {faq.question}
            </summary>
            <p className="px-6 pb-6 text-sm text-muted-foreground">{faq.answer}</p>
          </details>
        ))}
      </div>
    </Container>
  </section>
);
