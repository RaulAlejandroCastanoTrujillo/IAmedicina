#!/bin/sh
# ============================================================
# Regenera js/config.js con la URL pública de n8n antes de que
# nginx arranque. Se ejecuta automáticamente porque vive en
# /docker-entrypoint.d/ (comportamiento estándar de nginx:alpine).
# ============================================================
set -e

CONFIG_FILE=/usr/share/nginx/html/js/config.js
N8N_URL="${N8N_PUBLIC_URL:-http://localhost:5678}"

cat > "$CONFIG_FILE" <<EOF
// Generado automáticamente al iniciar el contenedor (docker-entrypoint.sh)
window.HEALTHAI_CONFIG = {
  N8N_BASE_URL: "${N8N_URL}"
};
EOF

echo "✅ config.js generado — N8N_BASE_URL=${N8N_URL}"
