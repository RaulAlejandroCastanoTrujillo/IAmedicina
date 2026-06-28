# ============================================================
# Imagen de la app Health AI (frontend estático servido con nginx)
# ============================================================
FROM nginx:alpine

COPY index.html /usr/share/nginx/html/index.html
COPY css/ /usr/share/nginx/html/css/
COPY js/ /usr/share/nginx/html/js/
COPY data/ /usr/share/nginx/html/data/

# Genera js/config.js con la URL real de n8n antes de iniciar nginx
COPY docker-entrypoint.sh /docker-entrypoint.d/40-generate-config.sh
RUN chmod +x /docker-entrypoint.d/40-generate-config.sh

EXPOSE 80
