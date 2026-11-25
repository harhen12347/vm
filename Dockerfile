FROM node:22-bookworm-slim

RUN apt-get update \
	&& apt-get install -y --no-install-recommends qemu-system-x86 qemu-utils ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV AETHER_DATA_DIR=/var/data/.aether-desktop
EXPOSE 3001
CMD ["node", "server.js"]
