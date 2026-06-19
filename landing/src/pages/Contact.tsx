import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import axios from "axios";

import { Container } from "../components/ui/Container";
import { SectionHeading } from "../components/ui/SectionHeading";
import { Button } from "../components/ui/Button";
import { CONTACT_CHANNELS } from "../utils/constants";
import { usePageMeta } from "../hooks/usePageMeta";

const contactSchema = z.object({
  name: z.string().min(3, "Informe seu nome"),
  email: z.string().email("Email inválido"),
  phone: z.string().min(10, "Inclua DDD"),
  company: z.string().min(2),
  message: z.string().min(10, "Conte mais sobre sua operação"),
});

type ContactFormData = z.infer<typeof contactSchema>;

const Contact = () => {
  usePageMeta({
    title: "Fale com o time",
    description: "Canal direto para dúvidas, parcerias e suporte sobre a plataforma Leadium.",
  });

  const apiUrl = useMemo(() => import.meta.env.VITE_API_URL ?? "http://localhost:5000", []);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ContactFormData>({
    resolver: zodResolver(contactSchema),
  });

  const onSubmit = async (data: ContactFormData) => {
    setStatus("idle");
    try {
      await axios.post(`${apiUrl}/api/public/leads`, {
        ...data,
        source: "landing",
        page: "contact",
      });
      setStatus("success");
      reset();
    } catch (error) {
      console.error("Erro ao enviar lead", error);
      setStatus("error");
    }
  };

  return (
    <section className="py-16">
      <Container>
        <SectionHeading
          eyebrow="Contato"
          title="Times de vendas, operações e parceiros falam direto com especialistas"
          description="Preencha o formulário ou escolha um canal de alto toque para conversar agora."
        />
        <div className="grid gap-8 lg:grid-cols-2">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 rounded-3xl border border-border/50 bg-card/50 backdrop-blur-sm p-6 shadow-sm">
            <div>
              <label className="text-sm font-semibold text-foreground/80">Nome completo</label>
              <input
                className="mt-2 w-full rounded-2xl border border-border bg-background/50 px-4 py-3 text-sm focus:border-primary focus:outline-none"
                placeholder="Nome"
                {...register("name")}
              />
              {errors.name && <p className="mt-1 text-xs text-rose-500">{errors.name.message}</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-semibold text-foreground/80">Email corporativo</label>
                <input
                  className="mt-2 w-full rounded-2xl border border-border bg-background/50 px-4 py-3 text-sm focus:border-primary focus:outline-none"
                  placeholder="email@empresa.com"
                  {...register("email")}
                />
                {errors.email && <p className="mt-1 text-xs text-rose-500">{errors.email.message}</p>}
              </div>
              <div>
                <label className="text-sm font-semibold text-foreground/80">WhatsApp</label>
                <input
                  className="mt-2 w-full rounded-2xl border border-border bg-background/50 px-4 py-3 text-sm focus:border-primary focus:outline-none"
                  placeholder="(DDD) número"
                  {...register("phone")}
                />
                {errors.phone && <p className="mt-1 text-xs text-rose-500">{errors.phone.message}</p>}
              </div>
            </div>
            <div>
              <label className="text-sm font-semibold text-foreground/80">Empresa</label>
              <input
                className="mt-2 w-full rounded-2xl border border-border bg-background/50 px-4 py-3 text-sm focus:border-primary focus:outline-none"
                placeholder="Razão social"
                {...register("company")}
              />
              {errors.company && <p className="mt-1 text-xs text-rose-500">{errors.company.message}</p>}
            </div>
            <div>
              <label className="text-sm font-semibold text-foreground/80">Mensagem</label>
              <textarea
                rows={4}
                className="mt-2 w-full rounded-2xl border border-border bg-background/50 px-4 py-3 text-sm focus:border-primary focus:outline-none"
                placeholder="Conte sobre o seu volume, metas e desafios"
                {...register("message")}
              />
              {errors.message && <p className="mt-1 text-xs text-rose-500">{errors.message.message}</p>}
            </div>
            <Button type="submit" size="lg" disabled={isSubmitting}>
              {isSubmitting ? "Enviando..." : "Enviar para o time"}
            </Button>
            {status === "success" && <p className="text-sm text-primary">Recebemos suas informações. Em breve entraremos em contato.</p>}
            {status === "error" && <p className="text-sm text-rose-600">Não foi possível enviar. Tente novamente em instantes.</p>}
          </form>
          <div className="rounded-3xl border border-border/50 bg-card/30 backdrop-blur-sm p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-foreground">Fale direto com o time</h3>
            <p className="mt-2 text-sm text-muted-foreground">Respondemos em horário comercial (BRT). Para suporte, use a Central de Ajuda dentro da plataforma.
            </p>
            <ul className="mt-6 space-y-4">
              {CONTACT_CHANNELS.map((channel) => (
                <li key={channel.label} className="rounded-2xl border border-border bg-background/50 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-primary">{channel.label}</p>
                  <p className="text-lg font-semibold text-foreground">{channel.value}</p>
                  {channel.href && (
                    <a href={channel.href} target="_blank" rel="noreferrer" className="text-sm text-primary">
                      Abrir canal
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Container>
    </section>
  );
};

export default Contact;
