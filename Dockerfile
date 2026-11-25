FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx next build

FROM node:20-bookworm-slim
ENV NODE_ENV=production PORT=8000 SOFFICE_PATH=/usr/bin/soffice CHROME_PATH=/usr/bin/chromium
# LibreOffice (PDF), Chromium (job-link Fill), fonts matching the resume styles:
# MS core fonts (Arial/Times/Georgia/Trebuchet), Carlito/Caladea (Calibri/Cambria metrics), EB Garamond.
RUN sed -i 's/Components: main/Components: main contrib/' /etc/apt/sources.list.d/debian.sources \
 && echo "ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true" | debconf-set-selections \
 && apt-get update \
 && apt-get install -y --no-install-recommends libreoffice-writer-nogui chromium \
      ttf-mscorefonts-installer fonts-crosextra-carlito fonts-crosextra-caladea fonts-ebgaramond \
      fonts-liberation fonts-dejavu-core ca-certificates \
 && fc-cache -f && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
RUN npm prune --omit=dev
EXPOSE 8000
CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "8000"]
