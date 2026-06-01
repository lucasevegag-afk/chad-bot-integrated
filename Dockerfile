# Imagen base liviana con Node 22 LTS (Supabase requiere WebSocket nativo, agregado en Node 22)
FROM node:22-alpine

WORKDIR /app

# Instalar deps primero (mejor caching de capas)
COPY package*.json ./
RUN npm ci --omit=dev

# Copiar el resto del proyecto
COPY . .

# Puerto interno (fly.io lo mapea a 80/443 vía proxy)
EXPOSE 3000

# Healthcheck simple (opcional, fly lo hace por http)
ENV NODE_ENV=production

CMD ["node", "server.js"]
