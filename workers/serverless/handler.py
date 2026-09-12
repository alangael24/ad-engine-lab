"""Only MiniMax H3. Model downloads are delegated to Runpod's host cache."""
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request

MODEL_SIZES = {
    'diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors': 20970379616,
    'diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors': 20970379616,
    'text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors': 15687142551,
    'vae/minimax_h3_video_vae_fp16.safetensors': 5207808496,
    'vae/minimax_h3_audio_vae_fp32.safetensors': 605254808,
    'loras/minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors': 1956192992,
    'loras/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors': 1956193000,
    'loras/minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors': 1956193000,
}


def link_models(root, cache):
    snapshots = sorted((cache / 'models--Comfy-Org--MiniMax-H3' / 'snapshots').glob('*'))
    for relative, size in MODEL_SIZES.items():
        source = next((s / relative for s in snapshots if (s / relative).is_file()
                       and (s / relative).stat().st_size == size), None)
        if source is None:
            raise RuntimeError('H3_CACHE_MISSING: ' + relative)
        target = root / 'models' / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.is_symlink():
            target.unlink()
        target.symlink_to(source)


def start_comfy():
    root = Path(os.environ.get('COMFY_ROOT', '/opt/ComfyUI'))
    link_models(root, Path(os.environ.get('HF_HUB_CACHE', '/runpod-volume/huggingface-cache/hub')))
    child = subprocess.Popen(['python', 'main.py', '--listen', '127.0.0.1', '--port', '8188',
                              '--disable-pinned-memory', '--fp16-intermediates', '--cache-none'], cwd=root)
    for _ in range(120):
        if child.poll() is not None:
            raise RuntimeError('H3_STARTUP_FAILED')
        try:
            with urllib.request.urlopen('http://127.0.0.1:8188/system_stats', timeout=2):
                return child
        except OSError:
            time.sleep(2)
    child.terminate()
    raise RuntimeError('H3_STARTUP_TIMEOUT')


def handler(job):
    # No arbitrary workflows, commands, or code from API callers.
    try:
        result = subprocess.run(['node', 'workers/serverless/run-job.mjs'],
                                input=json.dumps(job['input']), text=True,
                                stdout=subprocess.PIPE, timeout=1140)
        if result.returncode:
            return {'error': 'H3_JOB_FAILED'}
        return json.loads(result.stdout)
    except (ValueError, KeyError, subprocess.TimeoutExpired):
        return {'error': 'H3_JOB_FAILED'}
    finally:
        # One job at a time. Keep models loaded; remove only per-job inputs/outputs.
        root = Path(os.environ.get('COMFY_ROOT', '/opt/ComfyUI'))
        for folder in ['input', 'output', 'temp']:
            for file in (root / folder).rglob('*'):
                if file.is_file() and not file.is_symlink():
                    file.unlink(missing_ok=True)


if __name__ == '__main__':
    import runpod
    comfy = start_comfy()
    try:
        runpod.serverless.start({'handler': handler})
    finally:
        comfy.terminate()
