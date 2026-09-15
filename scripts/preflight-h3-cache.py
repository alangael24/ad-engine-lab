#!/usr/bin/env python3
"""Read-only H3 cache preflight. No GPU, model generation or full downloads.

Use HF_TOKEN or --keychain-service on macOS. Reports never include credentials,
signed URLs or raw provider exceptions. Requires scripts/h3-cache-requirements.txt.
"""
import argparse
import json
from pathlib import Path
import re
import subprocess
import urllib.parse
import urllib.request


def verify_metadata(info, manifest, revision):
    if info.sha != revision:
        raise ValueError('REVISION_MISMATCH')
    files = {f.rfilename: f for f in info.siblings}
    for name, expected in manifest['files'].items():
        f = files.get(name)
        if f is None or f.size != expected['bytes'] or not f.lfs or f.lfs.sha256 != expected['sha256']:
            raise ValueError('MODEL_METADATA_MISMATCH')


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urllib.parse.urlparse(newurl)
        if parsed.scheme != 'https' or parsed.username or parsed.password:
            raise ValueError('UNSAFE_REDIRECT')
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if parsed.hostname != 'huggingface.co':
            redirected.remove_header('Authorization')
        return redirected


def probe_file(location, token, expected_bytes, opener=None):
    url = urllib.parse.urlparse(location)
    # Location comes from authenticated HF metadata, never from a model prompt.
    if url.scheme != 'https' or url.username or url.password:
        raise ValueError('UNSAFE_DOWNLOAD_URL')
    headers = {'Range': 'bytes=0-0'}
    if url.hostname == 'huggingface.co':
        headers['Authorization'] = 'Bearer ' + token
    opener = opener or urllib.request.build_opener(SafeRedirect()).open
    with opener(urllib.request.Request(location, headers=headers), timeout=30) as response:
        if response.status != 206 or response.headers.get('Content-Range') != f'bytes 0-0/{expected_bytes}':
            raise ValueError('RANGE_NOT_VERIFIED')
        if len(response.read(2)) != 1:
            raise ValueError('RANGE_BODY_INVALID')
    return {'rangeStatus': 206, 'sampleBytes': 1}


def main():
    from huggingface_hub import HfApi, get_token, hf_hub_url, get_hf_file_metadata
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--keychain-service')
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    report = {'repo': args.repo, 'revision': args.revision, 'gpuStarted': False,
              'fullFilesHashedLocally': False, 'files': [], 'passed': False}
    try:
        if not re.fullmatch(r'[\w.-]+/[\w.-]+', args.repo) or not re.fullmatch(r'[a-f0-9]{40}', args.revision):
            raise ValueError('INVALID_MODEL_REFERENCE')
        if args.keychain_service:
            result = subprocess.run(['security', 'find-generic-password', '-s', args.keychain_service, '-w'], capture_output=True, text=True)
            if result.returncode:
                raise ValueError('KEYCHAIN_UNAVAILABLE')
            token = result.stdout.strip()
        else:
            token = get_token()
        if not token:
            raise ValueError('HF_TOKEN_MISSING')
        manifest = json.loads((Path(__file__).resolve().parents[1] / 'workers/serverless/model-manifest.json').read_text())
        info = HfApi(token=token).model_info(args.repo, revision=args.revision, files_metadata=True)
        verify_metadata(info, manifest, args.revision)
        for name, spec in manifest['files'].items():
            metadata = get_hf_file_metadata(hf_hub_url(args.repo, name, revision=args.revision), token=token, timeout=30)
            if metadata.size != spec['bytes']:
                raise ValueError('DOWNLOAD_SIZE_MISMATCH')
            report['files'].append({'file': name, 'publishedHashMatches': True,
                                    **probe_file(metadata.location, token, spec['bytes'])})
        report['passed'] = True
    except Exception as error:
        report['errorType'] = type(error).__name__
        if isinstance(error, ValueError) and re.fullmatch(r'[A-Z_]+', str(error)):
            report['errorCode'] = str(error)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
