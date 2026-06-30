#!/bin/sh
# 1. Replace API_UPSTREAM placeholder in nginx.conf
UPSTREAM="${API_UPSTREAM:-api:8000}"
sed -i "s|API_UPSTREAM|${UPSTREAM}|g" /etc/nginx/conf.d/default.conf

# 2. If VITE_API_URL is set at runtime, patch it into the built JS bundle.
#    This handles platforms (EasyPanel, Render, Railway) that inject env vars
#    at runtime rather than build time — Vite normally requires build-time vars,
#    but we can safely replace the placeholder string in the output bundle.
if [ -n "$VITE_API_URL" ]; then
  echo "[entrypoint] Patching VITE_API_URL=$VITE_API_URL into JS bundle..."
  find /usr/share/nginx/html/assets -name "*.js" | xargs sed -i "s|__VITE_API_URL_PLACEHOLDER__|${VITE_API_URL}|g"
fi

exec nginx -g "daemon off;"
