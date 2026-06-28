# ============================================================
# Imagen n8n personalizada para Health AI / MediScribe
#
# Extiende la imagen oficial de n8n agregando el workflow y la
# credencial de OpenAI, que se importan y activan automáticamente
# al iniciar el contenedor (ver docker-entrypoint.sh).
# ============================================================
FROM n8nio/n8n:latest

USER root

RUN mkdir -p /setup

COPY workflow.json /setup/workflow.json
COPY credentials.template.json /setup/credentials.template.json
COPY docker-entrypoint.sh /setup/docker-entrypoint.sh

RUN chmod +x /setup/docker-entrypoint.sh \
    && chown -R node:node /setup

# Carpeta donde se guarda el historial clínico (montada como volumen Docker
# para que persista entre reinicios). Se crea aquí, con dueño "node", para
# que cuando Docker monte el volumen encima conserve estos permisos.
RUN mkdir -p /data/historial && chown -R node:node /data

# ID del workflow importado (debe coincidir con el "id" dentro de workflow.json)
ENV MEDISCRIBE_WORKFLOW_ID=cW9xR2saDpI3IRg1

USER node

ENTRYPOINT ["/setup/docker-entrypoint.sh"]
