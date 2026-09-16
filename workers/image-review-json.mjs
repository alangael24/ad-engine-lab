// Complete only missing final object/array delimiters. Never invent keys, strings,
// checks, verdicts or evidence. Callers MUST still validate full scoped coverage.
export function parseImageReviewJSON(raw){
 const text=raw.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');
 try{return {value:JSON.parse(text),normalization:null};}catch(original){
  const stack=[];let quoted=false,escaped=false;
  for(const c of text){
   if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
   if(c==='"')quoted=true;
   else if(c==='{'||c==='[')stack.push(c==='{'?'}':']');
   else if(c==='}'||c===']'){if(stack.pop()!==c)throw original;}
  }
  if(quoted||escaped||!stack.length||stack.length>8)throw original;
  const suffix=stack.reverse().join(''),value=JSON.parse(text+suffix);
  return {value,normalization:{kind:'missing_final_delimiters',appended:suffix}};
 }
}
