// Enrich only before creating a new sales project. Existing project snapshots
// and client-edited brand fields remain intact.
export async function enrichSalesBrand(brand,{api,saveBrand}){
 if(!brand?.data.sourceUrl||brand.data.salesSource)return brand;
 const result=await api('/api/store-import',{method:'POST',body:{action:'inspect',url:brand.data.sourceUrl,productProfile:'ads-sales-v1'}});
 const page=result.products.find(p=>p.salesSource?.url===result.url);
 if(!page?.salesSource?.text)return brand;
 return saveBrand(brand.id,{...brand.data,salesSource:page.salesSource},brand.revision);
}
