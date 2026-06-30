#!/bin/sh
# Reemplaza API_UPSTREAM en nginx.conf con la variable de entorno en runtime.
# Esto permite apuntar al backend sin rebuilds, útil en plataformas cloud.
#   API_UPSTREAM=api:8000        → docker-compose (default)
#   API_UPSTREAM=localhost:8000  → single-container
#   API_UPSTREAM=my-api.fly.dev  → plataforma cloud con dominio propio

UPSTREAM="${API_UPSTREAM:-api:8000}"
sed -i "s|API_UPSTREAM|${UPSTREAM}|g" /etc/nginx/conf.d/default.conf
exec nginx -g "daemon off;"
