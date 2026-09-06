import test from 'node:test';
import assert from 'node:assert/strict';
import {versionReferences} from '../scripts/version-static-assets.mjs';
test('a release versions the full local module graph while preserving remote imports',()=>{
 const source=`import {x} from './panel.js'; import '../shared.js'; const y=import('./lazy.js'); import z from 'https://cdn.test/z.js';`;
 assert.equal(versionReferences(source,'abc'),`import {x} from './panel.js?v=abc'; import '../shared.js?v=abc'; const y=import('./lazy.js?v=abc'); import z from 'https://cdn.test/z.js';`);
 assert.equal(versionReferences('<script src="/assets/app.js"></script><link href="/assets/app.css"><script src="https://cdn.test/a.js"></script>','abc',true),'<script src="/assets/app.js?v=abc"></script><link href="/assets/app.css?v=abc"><script src="https://cdn.test/a.js"></script>');
});
