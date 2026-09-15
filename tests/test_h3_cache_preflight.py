import importlib.util
from pathlib import Path
from types import SimpleNamespace as N
import unittest

spec = importlib.util.spec_from_file_location('preflight', Path(__file__).resolve().parents[1] / 'scripts/preflight-h3-cache.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class PreflightTests(unittest.TestCase):
    def test_wrong_revision_and_weight_fail_before_download(self):
        manifest = {'files': {'model': {'bytes': 10, 'sha256': 'expected'}}}
        info = N(sha='rev', siblings=[N(rfilename='model', size=10, lfs=N(sha256='wrong'))])
        with self.assertRaisesRegex(ValueError, 'REVISION_MISMATCH'):
            m.verify_metadata(info, manifest, 'other')
        with self.assertRaisesRegex(ValueError, 'MODEL_METADATA_MISMATCH'):
            m.verify_metadata(info, manifest, 'rev')

    def test_cdn_does_not_receive_hf_token(self):
        class Response:
            status = 206
            headers = {'Content-Range': 'bytes 0-0/10'}
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, n): return b'x'
        def opener(req, **kwargs):
            self.assertIsNone(req.get_header('Authorization'))
            return Response()
        self.assertEqual(m.probe_file('https://cdn.huggingface.co/model', 'private', 10, opener)['sampleBytes'], 1)

    def test_ignored_range_never_reads_large_body(self):
        class Response:
            status = 200
            headers = {}
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, n): raise AssertionError('Must not read a full weight')
        with self.assertRaisesRegex(ValueError, 'RANGE_NOT_VERIFIED'):
            m.probe_file('https://cdn.huggingface.co/model', 'private', 10, lambda *a, **k: Response())

    def test_insecure_or_embedded_credentials_rejected(self):
        for url in ['http://huggingface.co/model', 'https://user:secret@huggingface.co/model']:
            with self.assertRaisesRegex(ValueError, 'UNSAFE_DOWNLOAD_URL'):
                m.probe_file(url, 'private', 10)

    def test_redirect_strips_credentials_outside_huggingface(self):
        request = m.urllib.request.Request('https://huggingface.co/model', headers={'Authorization': 'Bearer private'})
        redirected = m.SafeRedirect().redirect_request(request, None, 302, 'Found', {}, 'https://cdn.example/model')
        self.assertIsNone(redirected.get_header('Authorization'))
        with self.assertRaisesRegex(ValueError, 'UNSAFE_REDIRECT'):
            m.SafeRedirect().redirect_request(request, None, 302, 'Found', {}, 'http://cdn.example/model')


if __name__ == '__main__':
    unittest.main()
