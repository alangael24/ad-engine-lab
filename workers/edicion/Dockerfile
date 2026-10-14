# Worker de /edicion para Render (Background Worker, Docker). Construir desde la raíz del repo:
#   docker build -f workers/edicion/Dockerfile -t creativerush-edicion .
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg python3 python3-pip python3-numpy python3-opencv python3-pil ca-certificates \
      fonts-dejavu-core fonts-liberation2 fonts-noto-core fonts-roboto fonts-lato fonts-urw-base35 \
    && rm -rf /var/lib/apt/lists/*
RUN pip3 install --no-cache-dir --break-system-packages yt-dlp==2026.8.19
RUN npm install -g @anthropic-ai/claude-code && claude --version
RUN useradd -m -u 1000 editor
WORKDIR /app
COPY workers/edicion-worker.mjs workers/edicion-worker.mjs
COPY workers/edicion workers/edicion
USER editor
ENV EDICION_WORKDIR=/home/editor/jobs NODE_ENV=production
CMD ["node", "workers/edicion-worker.mjs"]
