#!/bin/sh
# Patch VITE_API_URL into the built JS bundle at runtime.
# This lets EasyPanel/Render/Railway inject the backend URL via env vars
# without requiring a rebuild — Vite normally bakes vars at build time,
# but we replace the placeholder string directly in the output bundle.
if [ -n "$VITE_API_URL" ]; then
  echo "[entrypoint] Patching VITE_API_URL=$VITE_API_URL into JS bundle..."
  find /usr/share/nginx/html/assets -name "*.js" | xargs sed -i "s|__VITE_API_URL_PLACEHOLDER__|${VITE_API_URL}|g"
fi

exec nginx -g "daemon off;"
