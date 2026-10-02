FROM mcr.microsoft.com/playwright:v1.63.0-jammy

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY screenshot.js ./

WORKDIR /work
ENTRYPOINT ["node", "/app/screenshot.js"]
