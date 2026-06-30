# Build context: katastik/ (raíz del proyecto)
# Stage 1: build
FROM node:20-alpine AS builder
WORKDIR /app

# Instalar todas las deps desde la raíz del workspace
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
RUN npm install --workspace=apps/web

# Copiar fuentes y public
COPY apps/web ./apps/web

# Build (VITE_CATASTRO_MODE=api para producción; el proxy de runtime lo manejará nginx)
WORKDIR /app/apps/web
ARG VITE_CATASTRO_MODE=api
ENV VITE_CATASTRO_MODE=${VITE_CATASTRO_MODE}
RUN npx vite build

# Stage 2: serve con nginx
FROM nginx:alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/web/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
# API_UPSTREAM puede sobreescribirse en runtime (ej. Railway/Render/Fly)
ENV API_UPSTREAM=api:8000
ENTRYPOINT ["/docker-entrypoint.sh"]
