# Landing do apex leadium.com.br — nginx servindo HTML estático (landing + legais).
# Substituível pela landing real depois (basta trocar o conteúdo de ./site).
FROM nginx:1.27-alpine
COPY default.conf /etc/nginx/conf.d/default.conf
COPY site/ /usr/share/nginx/html/
# Healthcheck simples (nginx responde 200 em /).
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
