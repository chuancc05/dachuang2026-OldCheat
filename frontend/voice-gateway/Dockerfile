FROM node:20-alpine

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.mjs ./server.mjs

ENV NODE_ENV=production
ENV VOICE_GATEWAY_HOST=0.0.0.0
EXPOSE 8787

CMD ["node", "server.mjs"]
