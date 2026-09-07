FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir Pillow==11.3.0 numpy==2.2.6 requests==2.32.5
COPY vendor /opt/video-use
ENV PYTHONDONTWRITEBYTECODE=1
WORKDIR /job
