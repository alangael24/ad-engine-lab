FROM pytorch/pytorch:2.10.0-cuda13.0-cudnn9-runtime@sha256:1f57418aedd9a4d0d3a59646619e1d4f82cacc33817247cead4f749e1f452d4b
ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends git curl xz-utils ca-certificates ffmpeg libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://nodejs.org/dist/v22.18.0/node-v22.18.0-linux-x64.tar.xz | tar -xJ -C /usr/local --strip-components=1
RUN git init /opt/ComfyUI && cd /opt/ComfyUI && git remote add origin https://github.com/Comfy-Org/ComfyUI.git && git fetch --depth 1 origin 15eb748b3ec5f8a0a2d470b7fb280e2d7579f916 && git checkout FETCH_HEAD && rm -rf .git
RUN printf 'torch==2.10.0\ntorchvision==0.25.0\ntorchaudio==2.10.0\ntransformers<5\nhuggingface-hub<1\n' > /tmp/constraints.txt && pip install -c /tmp/constraints.txt -r /opt/ComfyUI/requirements.txt runpod==1.12.0
RUN cd /opt/ComfyUI && python main.py --quick-test-for-ci --cpu
WORKDIR /opt/creativerush
COPY workers/h3-adapter.mjs workers/h3-adapter.mjs
COPY workers/workflows/h3.json workers/workflows/h3.json
COPY workers/serverless workers/serverless
ENV HF_HUB_OFFLINE=1 HF_HUB_CACHE=/runpod-volume/huggingface-cache/hub COMFY_ROOT=/opt/ComfyUI
CMD ["python", "workers/serverless/handler.py"]
