// Upload targets need not exist yet. Only missing-object errors may omit the
// download URL; authentication/network/storage failures must still propagate.
export async function checkpointMediaUrls(storage,path){
 const upload=await storage.createSignedUploadUrl(path);
 if(upload.error)throw upload.error;
 const download=await storage.createSignedUrl(path,900);
 if(download.error){
  const e=download.error;
  if(!['NoSuchKey','not_found','notFound'].includes(e.code)&&!/^object not found\.?$/i.test(e.message||''))throw e;
  return {uploadUrl:upload.data.signedUrl};
 }
 return {uploadUrl:upload.data.signedUrl,downloadUrl:download.data.signedUrl};
}
