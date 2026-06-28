#!/bin/sh
# ============================================================
# Entrypoint del contenedor n8n para Health AI / MediScribe
#
# Antes de levantar el servidor n8n:
#   1. Inyecta OPENAI_API_KEY en la credencial "OpenAI account"
#   2. Importa esa credencial
#   3. Importa el workflow "PROYECTO FINAL | Consulta Médica SOAP"
#   4. Activa el workflow
#
# Es seguro reiniciar el contenedor: las importaciones son
# idempotentes (actualizan por ID en vez de duplicar).
# ============================================================
set -e

SETUP_DIR=/setup
CRED_TEMPLATE="$SETUP_DIR/credentials.template.json"
CRED_FILE="$SETUP_DIR/credentials.json"
WORKFLOW_FILE="$SETUP_DIR/workflow.json"
WORKFLOW_ID="${MEDISCRIBE_WORKFLOW_ID:-cW9xR2saDpI3IRg1}"

if [ -z "$OPENAI_API_KEY" ]; then
  echo "⚠️  ADVERTENCIA: OPENAI_API_KEY no está definida."
  echo "    MediScribe no podrá transcribir audio ni generar notas SOAP."
  echo "    Define la variable en tu archivo .env y reinicia el contenedor."
fi

echo "🔧 Preparando credencial de OpenAI..."
sed "s|__OPENAI_API_KEY__|${OPENAI_API_KEY}|g" "$CRED_TEMPLATE" > "$CRED_FILE"

echo "📥 Importando credencial 'OpenAI account'..."
n8n import:credentials --input="$CRED_FILE" || echo "⚠️  Falló la importación de credenciales (revisa el log anterior)."

echo "📥 Importando workflow 'PROYECTO FINAL | Consulta Médica SOAP'..."
n8n import:workflow --input="$WORKFLOW_FILE" || echo "⚠️  Falló la importación del workflow."

echo "⚡ Activando workflow ($WORKFLOW_ID)..."
n8n update:workflow --id="$WORKFLOW_ID" --active=true || echo "⚠️  No se pudo activar automáticamente. Actívalo manualmente en la UI."

# No dejar la API key en texto plano en el filesystem del contenedor
rm -f "$CRED_FILE"

echo "✅ Setup completo. Iniciando servidor n8n..."
exec n8n start
