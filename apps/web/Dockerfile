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

# Build
WORKDIR /app/apps/web
ARG VITE_CATASTRO_MODE=api
ENV VITE_CATASTRO_MODE=${VITE_CATASTRO_MODE}
# VITE_API_URL: dejar vacío para usar el proxy nginx interno (docker-compose)
# Setear a la URL pública del backend cuando los servicios están separados en la nube
# Ej: --build-arg VITE_API_URL=https://katastik-back.tu-dominio.com
ARG VITE_API_URL=
ENV VITE_API_URL=${VITE_API_URL}
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
