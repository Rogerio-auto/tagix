const CADASTRO_URL = import.meta.env.VITE_CADASTRO_URL ?? "http://localhost:3002";
const APP_URL = import.meta.env.VITE_APP_URL ?? "http://localhost:3000";
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:5000";

export const REDIRECT_URLS = {
  free: `${CADASTRO_URL}/cadastro?plan=free`,
  starter: `${CADASTRO_URL}/cadastro?plan=starter`,
  pro: `${CADASTRO_URL}/cadastro?plan=pro`,
  business: `${CADASTRO_URL}/cadastro?plan=business`,
  app: APP_URL,
  api: API_URL,
  whatsapp: "https://wa.me/?text=Quero%20conhecer%20a%20Leadium",
};

export const getSignupUrl = (planId: string) => {
  const key = planId.toLowerCase() as keyof typeof REDIRECT_URLS;
  return REDIRECT_URLS[key] ?? `${CADASTRO_URL}/cadastro?plan=free`;
};
