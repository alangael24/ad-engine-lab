-- Batch existing owner/revision/idempotency checks with the context read.
-- Keep snapshots for undo in the database, not in the HTTP response.
create function public.studio_chat_prepare(p_user uuid,p_id uuid,p_project uuid,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare record jsonb; context jsonb; history jsonb;
begin
 record:=public.studio_chat_write(p_user,'reserve',p_id,p_project,p_data);
 if not coalesce((record->>'claimed')::boolean,false) then
  return jsonb_build_object('record',record-'before_data');
 end if;
 context:=public.studio_read(p_user,p_project);
 select coalesce(jsonb_agg(to_jsonb(h) order by h.created_at),'[]'::jsonb) into history
 from (select id,status,request_payload,result,applied_revision,created_at
       from public.studio_chat_edits where user_id=p_user and project_id=p_project
       order by created_at desc limit 8) h;
 return jsonb_build_object('record',record-'before_data','context',context,'history',history);
end $$;
create function public.studio_chat_commit(p_user uuid,p_action text,p_id uuid,p_project uuid,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if p_action not in ('complete','fail') then raise exception 'CHAT_INVALID'; end if;
 return public.studio_chat_write(p_user,p_action,p_id,p_project,p_data)-'before_data';
end $$;
revoke all on function public.studio_chat_prepare(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.studio_chat_commit(uuid,text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.studio_chat_prepare(uuid,uuid,uuid,jsonb) to service_role;
grant execute on function public.studio_chat_commit(uuid,text,uuid,uuid,jsonb) to service_role;
