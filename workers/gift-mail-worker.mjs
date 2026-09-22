import {getSupabaseAdmin} from '../src/backend.js';
import {sendGiftMail} from '../src/gift-mail.js';
export default {async scheduled(_event,env){const result=await sendGiftMail(getSupabaseAdmin(env),env);console.log('gift_mail',JSON.stringify(result));}};
