"""Pinned H3 bootstrap. No RunPod account key or public ports inside the GPU."""
import json, os, shutil, subprocess, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

def report(action, **fields):
    payload = dict(action=action, runId=os.environ['H3_POD_RUN_ID'],
                   workerId=os.environ['H3_WORKER_ID'], **fields)
    request = urllib.request.Request(os.environ['CREATIVE_RUSH_URL']+'/api/gpu-pod',
        data=json.dumps(payload).encode(), headers={
            'Authorization':'Bearer '+os.environ['GENERATION_WORKER_TOKEN'],
            'Content-Type':'application/json','User-Agent':'CreativeRush-Worker/1.0'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=15):
                return
        except OSError:
            if attempt == 2:
                raise
            time.sleep(1)

def main():
    stage = 'starting'
    comfy = worker = None
    try:
        print(json.dumps({'event':'h3_boot','stage':stage}), flush=True)
        # Notify before heavy imports/downloads, distinguishing container startup.
        report('boot_progress', stage=stage)
        stage = 'cuda'
        report('boot_progress', stage=stage)
        subprocess.run([sys.executable,'-c','import os,torch; assert torch.cuda.get_device_name(0)==os.environ.get("H3_EXPECTED_GPU","NVIDIA GeForce RTX 5090"); assert torch.cuda.get_device_properties(0).total_memory>=float(os.environ.get("H3_MIN_VRAM_GB","31"))*1024**3; assert (torch.ones(1,device="cuda")+1).item()==2'],check=True)
        os.environ.update(HF_HUB_OFFLINE='0',HF_HUB_CACHE='/workspace/.cache/huggingface',
            HF_XET_CACHE='/workspace/.cache/xet',HF_XET_HIGH_PERFORMANCE='1',
            HF_XET_NUM_CONCURRENT_RANGE_GETS='32')
        from huggingface_hub import hf_hub_download
        root = Path('/workspace/ComfyUI')
        if not root.exists():
            shutil.copytree('/opt/ComfyUI', root, symlinks=True)
        manifest = json.loads(Path('/opt/creativerush/workers/serverless/model-manifest.json').read_text())
        stage = 'models'
        report('boot_progress', stage=stage)
        started = time.time()
        def download(name):
            return hf_hub_download(manifest['sourceRepo'], filename=name,
                revision=manifest['sourceRevision'], local_dir=str(root/'models'))
        completed_bytes = 0
        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = {pool.submit(download, name):name for name in manifest['files']}
            for future in as_completed(futures):
                name = futures[future]
                path = Path(future.result())
                if path.stat().st_size != manifest['files'][name]['bytes']:
                    raise RuntimeError('MODEL_SIZE_MISMATCH')
                completed_bytes += path.stat().st_size
                report('download_progress', bytes=completed_bytes)
        for name, spec in manifest['files'].items():
            if (root/'models'/name).stat().st_size != spec['bytes']:
                raise RuntimeError('MODEL_SIZE_MISMATCH')
        print(json.dumps({'event':'h3_models_ready','seconds':time.time()-started,
                         'bytes':sum(f['bytes'] for f in manifest['files'].values())}), flush=True)
        os.environ['HF_HUB_OFFLINE'] = '1'
        stage = 'comfy'
        report('boot_progress', stage=stage)
        comfy = subprocess.Popen([sys.executable,'main.py','--listen','127.0.0.1','--port','8188',
            '--disable-pinned-memory','--fp16-intermediates','--cache-none'], cwd=root)
        for _ in range(120):
            if comfy.poll() is not None:
                raise RuntimeError('COMFY_EXITED')
            try:
                urllib.request.urlopen('http://127.0.0.1:8188/system_stats',timeout=2).close()
                break
            except OSError:
                time.sleep(2)
        else:
            raise RuntimeError('COMFY_NOT_READY')
        stage = 'ready_callback'
        report('boot_progress', stage=stage)
        report('ready')
        worker = subprocess.Popen(['node','workers/h3-worker.mjs'],cwd='/opt/creativerush')
        stage = 'runtime'
        while comfy.poll() is None and worker.poll() is None:
            time.sleep(2)
        raise RuntimeError('H3_PROCESS_EXITED')
    except Exception as error:
        # An allowlisted classification, never URLs, credentials or arbitrary text.
        code = type(error).__name__
        if isinstance(error, subprocess.CalledProcessError) and stage == 'cuda':
            code = 'CUDA_HOST_FAILED'
        elif isinstance(error, urllib.error.HTTPError) and error.code in (401,403):
            code = 'CREDENTIALS_INVALID'
        elif str(error) in ('MODEL_SIZE_MISMATCH','COMFY_EXITED','COMFY_NOT_READY','H3_PROCESS_EXITED'):
            code = str(error)
        try:
            report('boot_progress', stage=stage, error=code)
        except Exception:
            pass
        raise
    finally:
        if comfy:
            comfy.terminate()
        if worker:
            worker.terminate()

if __name__ == '__main__':
    main()
