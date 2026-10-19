-- =====================================================================
-- HENZO – Relance des dettes des clients
--   * Les créances regroupées par client : combien il doit, depuis
--     combien de jours (sa plus ancienne vente impayée), combien de
--     ventes, la date de la dernière relance.
--   * Chaque rappel envoyé (WhatsApp) est noté : on sait qui a été
--     relancé, quand, et pour quel montant.
-- À exécuter une fois dans Supabase > SQL Editor, après 0054.
-- =====================================================================

create table public.relances_clients (
  id           uuid primary key default gen_random_uuid(),
  ferme_id     uuid not null references public.fermes (id),
  client_id    uuid not null references public.tiers (id),
  montant      numeric(16, 0) not null check (montant >= 0),
  canal        text not null default 'whatsapp' check (canal in ('whatsapp', 'appel', 'visite')),
  saisi_par    uuid not null default auth.uid() references public.profiles (id),
  created_at   timestamptz not null default now()
);
create index on public.relances_clients (client_id, created_at desc);

create function public.noter_relance(p_client uuid, p_montant numeric, p_canal text default 'whatsapp')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.a_role('directeur', 'exploitation', 'finance') then raise exception 'Vous ne pouvez pas relancer les clients'; end if;
  if not exists (select 1 from public.tiers where id = p_client and ferme_id = public.ferme_actuelle()) then raise exception 'Client introuvable'; end if;
  insert into public.relances_clients (ferme_id, client_id, montant, canal)
  values (public.ferme_actuelle(), p_client, round(coalesce(p_montant, 0)), coalesce(p_canal, 'whatsapp'));
end;
$$;

-- What each client owes, oldest first
create view public.creances_par_client with (security_invoker = true) as
select c.client_id, c.ferme_id, c.client, t.telephone, t.ferme_liee_id is not null as societe_groupe,
       sum(c.reste) as reste, count(*) as ventes, min(c.date_vente) as plus_ancienne,
       current_date - min(c.date_vente) as jours, bool_or(c.en_retard) as en_retard,
       (select max(r.created_at) from public.relances_clients r where r.client_id = c.client_id) as derniere_relance,
       (select count(*) from public.relances_clients r where r.client_id = c.client_id) as relances
from public.creances_clients c
join public.tiers t on t.id = c.client_id
group by c.client_id, c.ferme_id, c.client, t.telephone, t.ferme_liee_id;

alter table public.relances_clients enable row level security;
create policy relances_select on public.relances_clients for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'));
revoke all on public.relances_clients, public.creances_par_client from anon;
revoke execute on function public.noter_relance(uuid, numeric, text) from public, anon;
grant execute on function public.noter_relance(uuid, numeric, text) to authenticated;
