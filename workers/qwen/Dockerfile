FROM runpod/pytorch:2.8.0-py3.11-cuda12.8.1-cudnn-devel-ubuntu22.04
RUN pip install --no-cache-dir transformers==5.17.0 accelerate==1.15.0 pillow==11.3.0 json-repair==0.63.4 'huggingface_hub[hf_xet]==1.32.0' https://github.com/huggingface/diffusers/archive/80c7ed262aeffbeb43ef13ae04baeb9b84515a69.zip
COPY workers/qwen /opt/qwen
ENV HF_HUB_CACHE=/workspace/hf-cache HF_XET_HIGH_PERFORMANCE=1 PYTHONUNBUFFERED=1
ENTRYPOINT ["python", "/opt/qwen/worker.py"]
