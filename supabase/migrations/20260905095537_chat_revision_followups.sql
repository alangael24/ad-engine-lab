begin;
-- Undo also recognizes revisions written by the edit's completed production.
create or replace function public.studio_chat_write_before_production(p_user uuid,p_action text,p_id uuid,p_project uuid,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.studio_projects; e public.studio_chat_edits; prior public.studio_chat_edits;
 answer jsonb; updated jsonb; render_result jsonb; render_error text; op text;
begin
 perform pg_advisory_xact_lock(hashtext('studio:'||p_user::text));
 select * into p from public.studio_projects where id=p_project and user_id=p_user for update;
 if not found then raise exception 'STUDIO_NOT_FOUND'; end if;
 select * into e from public.studio_chat_edits where id=p_id;
 if e.id is not null and (e.user_id<>p_user or e.project_id<>p_project) then raise exception 'STUDIO_NOT_FOUND'; end if;
 if p_action='reserve' then
  if e.id is not null then
   if e.request_payload<>p_data-'enabled' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
   return to_jsonb(e)||jsonb_build_object('claimed',false);
  end if;
  if not coalesce((p_data->>'enabled')::boolean,false) then raise exception 'CHAT_OFFLINE'; end if;
  if p.revision is distinct from (p_data->>'expected')::integer then raise exception 'STUDIO_CONFLICT'; end if;
  update public.studio_chat_edits set status='uncertain' where user_id=p_user and status='running' and created_at<now()-interval '3 minutes';
  if exists(select 1 from public.studio_chat_edits where user_id=p_user and status='running') then raise exception 'CHAT_BUSY'; end if;
  if (select count(*) from public.studio_chat_edits where user_id=p_user and created_at>now()-interval '24 hours')>=30
   or (select count(*) from public.studio_chat_edits where created_at>now()-interval '24 hours')>=300 then raise exception 'CHAT_LIMIT'; end if;
  insert into public.studio_chat_edits(id,user_id,project_id,request_payload,before_data) values(p_id,p_user,p_project,p_data-'enabled',p.data) returning * into e;
  return to_jsonb(e)||jsonb_build_object('claimed',true);
 end if;
 if e.id is null then raise exception 'STUDIO_NOT_FOUND'; end if;
 if e.status<>'running' then return to_jsonb(e); end if;
 if p_action='fail' then
  update public.studio_chat_edits set status='failed',result=p_data where id=e.id returning * into e;return to_jsonb(e);
 end if;
 if p_action<>'complete' then raise exception 'CHAT_INVALID'; end if;
 if e.created_at<now()-interval '3 minutes' then
  update public.studio_chat_edits set status='uncertain' where id=e.id returning * into e;return to_jsonb(e);
 end if;
 if p.revision is distinct from (e.request_payload->>'expected')::integer or e.before_data<>p.data then raise exception 'STUDIO_CONFLICT'; end if;
 op:=p_data->'edit'->>'operation';
 if op='undo' then
  select * into prior from public.studio_chat_edits where project_id=p.id and user_id=p_user and status='succeeded' and (applied_revision=p.revision or exists(select 1 from public.studio_productions job where job.id=studio_chat_edits.id and job.user_id=p_user and job.project_id=p.id and job.expected_revision=p.revision and job.status in ('succeeded','failed','uncertain'))) and undone_at is null and operation not in ('undo','clarify','render') order by created_at desc limit 1;
  if not found then raise exception 'CHAT_NO_UNDO'; end if;
  updated:=public.studio_write(p_user,'save_project',p.id,prior.before_data,p.revision);
  update public.studio_chat_edits set undone_at=now() where id=prior.id;
 elsif p_data->'nextData' is not null and p_data->'nextData'<>'null'::jsonb then
  updated:=public.studio_write(p_user,'save_project',p.id,p_data->'nextData',p.revision);
 end if;
 if updated is not null then select * into p from public.studio_projects where id=p.id; end if;
 if op in ('remove_scene','move_scene','select_version','undo','render') then
  begin
   render_result:=public.studio_write(p_user,'render',p.id,jsonb_build_object('requestId',e.id),p.revision);
  exception when others then
   if sqlerrm in ('STUDIO_WORKER_OFFLINE','STUDIO_NOT_READY','STUDIO_NARRATION_REQUIRED','STUDIO_AUDIO_TIMING','STUDIO_RENDER_BUSY','STUDIO_CLIP_TOO_SHORT') then render_error:=sqlerrm; else raise; end if;
  end;
 end if;
 answer:=jsonb_build_object('message',p_data->'edit'->>'message','operation',op,'render',render_result,'renderError',render_error,'usage',p_data->'usage');
 update public.studio_chat_edits set status='succeeded',operation=op,applied_revision=case when updated is not null then p.revision else null end,result=answer where id=e.id returning * into e;
 return to_jsonb(e);
end $$;

-- Save the whole validated edit once, then queue work against that exact revision.
-- Replay never launches a second job; unavailable generation never discards edits.
create or replace function public.studio_chat_write(p_user uuid,p_action text,p_id uuid,p_project uuid,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e jsonb; j jsonb; prior_status text; followup text; extra jsonb;
begin
 perform pg_advisory_xact_lock(hashtext('studio:'||p_user::text));
 select status into prior_status from public.studio_chat_edits where id=p_id and user_id=p_user and project_id=p_project;
 if p_action='reserve' and not exists(select 1 from public.studio_chat_edits where id=p_id) and exists(select 1 from public.studio_productions where project_id=p_project and user_id=p_user and status in ('queued','running')) then raise exception 'PRODUCTION_BUSY'; end if;
 e:=public.studio_chat_write_before_production(p_user,p_action,p_id,p_project,p_data);
 if p_action<>'complete' or prior_status is distinct from 'running' or e->>'status'<>'succeeded' then return e; end if;
 if e->>'operation'='produce' then
  j:=public.studio_production_start(p_user,p_id,p_project,(e->'request_payload'->>'expected')::integer,coalesce((p_data->>'productionEnabled')::boolean,false));
  extra:=jsonb_build_object('productionId',j->>'id','message','Producción iniciada. Puedes consultar el avance y volver cuando esté lista.');
 elsif e->>'applied_revision' is not null then
  followup:=p_data->>'followup';
  if followup='produce' then
   begin
    j:=public.studio_production_start(p_user,p_id,p_project,(e->>'applied_revision')::integer,coalesce((p_data->>'productionEnabled')::boolean,false));
    extra:=jsonb_build_object('productionId',j->>'id');
   exception when others then
    if sqlerrm in ('PRODUCTION_OFFLINE','PRODUCTION_PRODUCT','PRODUCTION_SCRIPT','PRODUCTION_BUSY','PRODUCTION_LIMIT') then
     extra:=jsonb_build_object('productionError',sqlerrm);
    else raise; end if;
   end;
  elsif followup='render' and e->>'operation'='batch' then
   begin
    j:=public.studio_write(p_user,'render',p_project,jsonb_build_object('requestId',p_id),(e->>'applied_revision')::integer);
    extra:=jsonb_build_object('render',j);
   exception when others then
    if sqlerrm in ('STUDIO_WORKER_OFFLINE','STUDIO_NOT_READY','STUDIO_NARRATION_REQUIRED','STUDIO_AUDIO_TIMING','STUDIO_RENDER_BUSY','STUDIO_CLIP_TOO_SHORT') then extra:=jsonb_build_object('renderError',sqlerrm); else raise; end if;
   end;
  end if;
 end if;
 update public.studio_chat_edits set result=studio_chat_edits.result||coalesce(extra,'{}'::jsonb)||jsonb_build_object('changes',p_data->'edit'->'changes','visualReview',p_data->'visualReview') where id=p_id returning to_jsonb(studio_chat_edits) into e;
 return e;
end $$;
revoke all on function public.studio_chat_write(uuid,text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.studio_chat_write(uuid,text,uuid,uuid,jsonb) to service_role;
commit;
