import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ideaIntent,storeProductData} from '../assets/idea-intent.js';
import {brandData} from '../assets/studio-model.js';
test('store links keep the accompanying idea and support bare domains',()=>{
 const r=ideaIntent('Quiero un anuncio corto https://tienda.example/products/filtro');
 assert.equal(r.kind,'store');assert.equal(r.idea,'Quiero un anuncio corto');
 assert.equal(ideaIntent('tienda.example/products/filtro').url,'https://tienda.example/products/filtro');
 assert.equal(ideaIntent('Solo un anuncio corto').kind,'idea');
});
test('video links are references, never silently sent to the store importer',()=>{
 for(const url of ['https://www.tiktok.com/@alguien/video/123','https://youtu.be/123','https://m.youtube.com/watch?v=123','https://cdn.example/video.mp4'])assert.equal(ideaIntent('Quiero algo como '+url).kind,'reference');
 assert.equal(ideaIntent('https://tiktok.com.evil.example/product').kind,'store');
});
test('automatically imported product fits existing brand contract and preserves source text',()=>{
 const p={brand:'Marca',name:'Filtro',description:'Descripción de la tienda',url:'https://tienda.example/products/filtro',sourceText:'Texto original'};
 const b=brandData(storeProductData(p));assert.equal(b.product,'Filtro. Descripción de la tienda');assert.equal(b.sourceText,p.sourceText);assert.equal(b.sourceUrl,p.url);assert.equal(b.claims,'');assert.equal(b.productAssetId,null);
});
