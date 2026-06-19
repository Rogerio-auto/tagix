import { Link } from "react-router-dom";
import { Container } from "../components/ui/Container";
import { Button } from "../components/ui/Button";
import { usePageMeta } from "../hooks/usePageMeta";

const NotFound = () => {
  usePageMeta({ title: "Página não encontrada" });

  return (
    <section className="py-32">
      <Container className="text-center">
        <p className="text-xs uppercase tracking-[0.4em] text-primary">404</p>
        <h1 className="mt-4 text-4xl font-semibold text-foreground">Conteúdo não disponível</h1>
        <p className="mt-2 text-sm text-muted-foreground">Verifique o endereço ou retorne para a página inicial.</p>
        <div className="mt-6 flex justify-center">
          <Button asChild>
            <Link to="/">Voltar</Link>
          </Button>
        </div>
      </Container>
    </section>
  );
};

export default NotFound;
