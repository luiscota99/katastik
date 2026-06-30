# Build context: katastik/ (raíz del proyecto)
FROM node:20-alpine
WORKDIR /app

# Datos demo (read-only en RAM, no hay BD)
COPY data/demo ./data/demo

# API
WORKDIR /app/apps/api
COPY apps/api/package.json ./
RUN npm install --omit=dev
COPY apps/api/src ./src

EXPOSE 8000
ENV PORT=8000
ENV DATA_DIR=/app/data/demo

CMD ["node", "src/index.js"]
