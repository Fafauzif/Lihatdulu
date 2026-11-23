# The judging host: one Node process that serves the built app and the scan
# backend on the same origin. FFmpeg is part of the image because Android
# records WebM and KIRI only accepts MP4.
#
#   docker build -t lihatdulu .
#   docker run -p 8787:8787 \
#     -e KIRI_API_KEY=... \
#     -e KIRI_SERVE_DIST=1 \
#     -e KIRI_HOST=0.0.0.0 \
#     -v lihatdulu-jobs:/app/var/kiri \
#     lihatdulu
#
# Without KIRI_API_KEY the app still runs: the scan page falls back to
# KIRI_MOCK=1 only when you ask for it, and otherwise explains that the server
# has no key configured.
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

ENV NODE_ENV=production \
    KIRI_HOST=0.0.0.0 \
    KIRI_PORT=8787 \
    KIRI_SERVE_DIST=1 \
    KIRI_JOBS_ROOT=/app/var/kiri

EXPOSE 8787

# The job store is the only thing that has to survive a restart, so mount a
# volume at /app/var/kiri. Jobs are plain JSON plus artifacts, no database.
VOLUME ["/app/var/kiri"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:8787/api/kiri/config').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/kiri-server.mjs"]
