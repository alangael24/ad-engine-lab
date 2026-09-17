// Product intent is independent of provider/model routing. Missing = frozen baseline.
export const CONTINUITY_PRODUCT='continuity-v1';
export const SALES_PRODUCT='ads-sales-v1';
export const CREATOR_PRODUCT='creator-v1';
export function productProfile(data={}){
 const profile=data.productProfile??CONTINUITY_PRODUCT;
 if(![CONTINUITY_PRODUCT,SALES_PRODUCT,CREATOR_PRODUCT].includes(profile))throw Object.assign(Error('STUDIO_INVALID'),{code:'STUDIO_INVALID'});
 return profile;
}
export const isSalesProduct=data=>productProfile(data)===SALES_PRODUCT;
export const isCreatorProduct=data=>productProfile(data)===CREATOR_PRODUCT;
export const productPath=data=>isCreatorProduct(data)?'/crear/':isSalesProduct(data)?'/anuncios-lab/':'/estudio/';
