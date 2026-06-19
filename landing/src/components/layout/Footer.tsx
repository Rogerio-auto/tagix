import { Link } from "react-router-dom";
import { CONTACT_CHANNELS, NAV_LINKS } from "../../utils/constants";
import { Container } from "../ui/Container";
import { Wordmark } from "../ui/Wordmark";

export const Footer = () => (
  <footer className="border-t border-border bg-card text-card-foreground">
    <Container className="py-12">
      <div className="grid gap-10 md:grid-cols-2">
        <div>
          <Wordmark className="text-xl" />
          <p className="mt-3 max-w-md text-sm text-muted-foreground">
            Atendimento, vendas e IA em um só lugar. WhatsApp e Instagram oficiais, uma IA que responde por você e automações que não deixam venda escapar.
          </p>
          <p className="mt-6 text-xs uppercase tracking-[0.3em] text-muted-foreground/60">© {new Date().getFullYear()} Leadium.</p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <h4 className="text-sm font-semibold text-foreground">Navegação</h4>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              {NAV_LINKS.map((link) => (
                <li key={link.label}>
                  <Link to={link.path}>{link.label}</Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-foreground">Contato</h4>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              {CONTACT_CHANNELS.map((item) => (
                <li key={item.label}>
                  {item.href ? (
                    <a href={item.href} target="_blank" rel="noreferrer">
                      <span className="block text-foreground font-medium">{item.label}</span>
                      <span className="text-muted-foreground">{item.value}</span>
                    </a>
                  ) : (
                    <div>
                      <span className="block text-foreground font-medium">{item.label}</span>
                      <span className="text-muted-foreground">{item.value}</span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6 text-xs text-muted-foreground/60">
        <div className="flex gap-4">
          <Link to="/termos" className="hover:text-primary transition-colors">Termos</Link>
          <span className="text-border">•</span>
          <Link to="/privacidade" className="hover:text-primary transition-colors">Privacidade</Link>
          <span className="text-border">•</span>
          <Link to="/lgpd" className="hover:text-primary transition-colors">LGPD</Link>
        </div>
        <span>WhatsApp e Instagram oficiais · Aprovado pela Meta · LGPD</span>
      </div>
    </Container>
  </footer>
);
