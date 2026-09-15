"""Pinned H3 bootstrap. No RunPod account key or public ports inside the GPU."""
import json, os, shutil, subprocess, time, urllib.request
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
        os.environ.update(HF_HUB_OFFLINE='0',HF_HUB_CACHE='/workspace/.cache/huggingface',
            HF_XET_CACHE='/workspace/.cache/xet',HF_XET_HIGH_PERFORMANCE='1',
            HF_XET_NUM_CONCURRENT_RANGE_GETS='32')
        from huggingface_hub import snapshot_download
        root = Path('/workspace/ComfyUI')
        if not root.exists():
            shutil.copytree('/opt/ComfyUI', root, symlinks=True)
        manifest = json.loads(Path('/opt/creativerush/workers/serverless/model-manifest.json').read_text())
        stage = 'models'
        report('boot_progress', stage=stage)
        started = time.time()
        snapshot_download(manifest['sourceRepo'], revision=manifest['sourceRevision'],
            allow_patterns=list(manifest['files']), local_dir=str(root/'models'), max_workers=4)
        for name, spec in manifest['files'].items():
            if (root/'models'/name).stat().st_size != spec['bytes']:
                raise RuntimeError('MODEL_SIZE_MISMATCH')
        print(json.dumps({'event':'h3_models_ready','seconds':time.time()-started,
                         'bytes':sum(f['bytes'] for f in manifest['files'].values())}), flush=True)
        os.environ['HF_HUB_OFFLINE'] = '1'
        stage = 'cuda'
        report('boot_progress', stage=stage)
        subprocess.run(['python','-c','import torch; assert "5090" in torch.cuda.get_device_name(0); assert (torch.ones(1,device="cuda")+1).item()==2'],check=True)
        stage = 'comfy'
        report('boot_progress', stage=stage)
        comfy = subprocess.Popen(['python','main.py','--listen','127.0.0.1','--port','8188',
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
        while comfy.poll() is None and worker.poll() is None:
            time.sleep(2)
        raise RuntimeError('H3_PROCESS_EXITED')
    except Exception as error:
        # Only class name, never exception text, URLs or credentials.
        try:
            report('boot_progress', stage=stage, error=type(error).__name__)
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
