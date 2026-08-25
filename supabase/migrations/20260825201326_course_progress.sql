begin;

create table if not exists public.course_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_slug text not null check (lesson_slug ~ '^[a-z0-9-]{2,80}$'),
  completed_at timestamptz not null default now(),
  primary key (user_id, lesson_slug)
);

alter table public.course_progress enable row level security;

drop policy if exists "students_read_own_progress" on public.course_progress;
create policy "students_read_own_progress"
on public.course_progress for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "students_add_own_progress" on public.course_progress;
create policy "students_add_own_progress"
on public.course_progress for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "students_delete_own_progress" on public.course_progress;
create policy "students_delete_own_progress"
on public.course_progress for delete to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.course_progress from anon, authenticated;
grant select, insert, delete on table public.course_progress to authenticated;
grant all on table public.course_progress to service_role;

commit;
