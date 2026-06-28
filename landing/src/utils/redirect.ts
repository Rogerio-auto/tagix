const APP_URL = import.meta.env.VITE_APP_URL ?? "http://localhost:3000";
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:5000";

// O cadastro vive dentro do app (apps/web), na rota /signup. Por padrão usa o
// mesmo host do app; VITE_CADASTRO_URL permite apontar para outro host se um dia
// o signup for servido separadamente.
const CADASTRO_URL = import.meta.env.VITE_CADASTRO_URL ?? APP_URL;

const signupUrl = (plan: string) => `${CADASTRO_URL}/signup?plan=${plan}`;

export const REDIRECT_URLS = {
  free: signupUrl("free"),
  starter: signupUrl("starter"),
  pro: signupUrl("pro"),
  business: signupUrl("business"),
  app: APP_URL,
  api: API_URL,
  whatsapp: "https://wa.me/?text=Quero%20conhecer%20a%20Leadium",
};

export const getSignupUrl = (planId: string) => {
  const key = planId.toLowerCase() as keyof typeof REDIRECT_URLS;
  return REDIRECT_URLS[key] ?? signupUrl("free");
};
