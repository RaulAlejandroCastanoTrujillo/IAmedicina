/* ======================================================
   Health AI — Configuración de conexión con n8n
   ------------------------------------------------------
   Este archivo define a qué URL de n8n debe conectarse la app.

   - Uso local (sin Docker): deja el valor por defecto o cámbialo
     manualmente por la IP de tu instancia de n8n.
   - Uso con Docker: este archivo se REGENERA automáticamente al
     iniciar el contenedor, usando la variable de entorno
     N8N_PUBLIC_URL (ver docker-entrypoint.sh de la app).
   ====================================================== */
window.HEALTHAI_CONFIG = {
  N8N_BASE_URL: "http://localhost:5678"
};
