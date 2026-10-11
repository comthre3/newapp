# Umbra relay + static game. Build:  docker build -t umbra .   Run:  docker run -p 3000:3000 umbra
# Put it behind any HTTPS host (the camera needs a secure context on phones); it honours $PORT.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY public ./public
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
USER node
HEALTHCHECK CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1
CMD ["node", "server.js"]
