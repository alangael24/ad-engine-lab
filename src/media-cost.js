// Usage-derived values, never inferred from account balance. Snapshot 2026-09-11.
export function imageCost(model,usage){
 if(model!=='gpt-image-2'||!usage)return {costUsd:null,costBasis:'unknown; retain admission reservation'};
 const text=usage.input_tokens_details?.text_tokens,image=usage.input_tokens_details?.image_tokens,output=usage.output_tokens;
 if([text,image,output].some(n=>!Number.isFinite(n)||n<0))return {costUsd:null,costBasis:'incomplete token breakdown; retain admission reservation'};
 return {costUsd:(text*5+image*8+output*30)/1e6,costBasis:'GPT Image 2 API token usage, including reference-image inputs; standard rate snapshot 2026-09-11'};
}
