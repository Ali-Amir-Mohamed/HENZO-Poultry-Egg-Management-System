-- =====================================================================
-- HENZO – Employés et salaires (directeur, finance)
--   * fiche employé : poste, activité (caisse qui paie), salaire mensuel ;
--   * avance sur salaire : l'argent sort tout de suite (dépense « salaires ») ;
--   * paie du mois : salaire + primes − retenues − avances non déduites =
--     net payé (dépense « salaires ») ; les avances sont alors déduites ;
--   * annuler la dépense d'une avance ou d'une paie (directeur) l'annule
--     aussi ici (et remet les avances à déduire).
-- Les salaires restent confidentiels : seuls le directeur et la finance voient.
-- À exécuter une fois dans Supabase > SQL Editor, après 0021.
-- =====================================================================

create table public.employes (
  id               uuid primary key default gen_random_uuid(),
  ferme_id         uuid not null default public.ferme_actuelle() references public.fermes (id),
  nom              text not null check (trim(nom) <> ''),
  telephone        text,
  poste            text,
  activite         public.activite not null default 'chair',          -- caisse qui paie le salaire
  salaire_mensuel  numeric(14, 0) not null check (salaire_mensuel >= 0),
  date_embauche    date,
  actif            boolean not null default true,
  notes            text,
  created_at       timestamptz not null default now()
);

create table public.avances_salaire (
  id                uuid primary key default gen_random_uuid(),
  ferme_id          uuid not null default public.ferme_actuelle() references public.fermes (id),
  employe_id        uuid not null references public.employes (id),
  date_avance       date not null default current_date,
  montant           numeric(14, 0) not null check (montant > 0),
  motif             text,
  depense_id        uuid references public.depenses (id),
  paie_id           uuid,                                             -- paie qui l'a déduite
  annulee           boolean not null default false,
  saisi_par         uuid not null default auth.uid() references public.profiles (id),
  created_at        timestamptz not null default now()
);
create index on public.avances_salaire (employe_id);

create table public.paies (
  id                uuid primary key default gen_random_uuid(),
  ferme_id          uuid not null default public.ferme_actuelle() references public.fermes (id),
  employe_id        uuid not null references public.employes (id),
  mois              date not null check (extract(day from mois) = 1),  -- 1er jour du mois payé
  salaire_base      numeric(14, 0) not null check (salaire_base >= 0),
  primes            numeric(14, 0) not null default 0 check (primes >= 0),
  retenues          numeric(14, 0) not null default 0 check (retenues >= 0),
  motif_retenues    text,
  avances           numeric(14, 0) not null default 0 check (avances >= 0),
  net               numeric(14, 0) generated always as (salaire_base + primes - retenues - avances) stored,
  mode_paiement     public.mode_paiement,
  depense_id        uuid references public.depenses (id),
  annulee           boolean not null default false,
  saisi_par         uuid not null default auth.uid() references public.profiles (id),
  created_at        timestamptz not null default now(),
  check (salaire_base + primes - retenues - avances >= 0)
);
create unique index paies_unique on public.paies (employe_id, mois) where not annulee;
alter table public.avances_salaire add constraint avances_paie_fk foreign key (paie_id) references public.paies (id);

create trigger journal after insert or update on public.employes for each row execute function public.journaliser();
create trigger journal after insert or update on public.avances_salaire for each row execute function public.journaliser();
create trigger journal after insert or update on public.paies for each row execute function public.journaliser();

alter table public.employes enable row level security;
alter table public.avances_salaire enable row level security;
alter table public.paies enable row level security;
create policy employes_all on public.employes for all to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'finance'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'finance'));
create policy avances_select on public.avances_salaire for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'finance'));
create policy paies_select on public.paies for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'finance'));
-- Avances et paies passent par les fonctions ci-dessous (dépense + enregistrement ensemble)

-- Avance sur salaire : l'argent sort tout de suite
create function public.verser_avance(p_employe uuid, p_montant numeric, p_mode public.mode_paiement,
                                     p_motif text default null, p_date date default current_date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.employes;
  v_dep uuid;
  v_id uuid;
begin
  if not public.a_role('directeur', 'finance') then raise exception 'Seuls le directeur et la finance gèrent les salaires'; end if;
  select * into e from public.employes where id = p_employe and ferme_id = public.ferme_actuelle();
  if e.id is null then raise exception 'Employé introuvable'; end if;
  if coalesce(p_montant, 0) <= 0 then raise exception 'Indiquez le montant de l''avance'; end if;
  insert into public.depenses (ferme_id, date_depense, portee, activite, categorie, libelle, montant, mode_paiement, notes)
  values (e.ferme_id, coalesce(p_date, current_date), 'generale', e.activite, 'salaires',
          'Avance sur salaire – ' || e.nom, p_montant, p_mode, nullif(trim(coalesce(p_motif, '')), ''))
  returning id into v_dep;
  insert into public.avances_salaire (ferme_id, employe_id, date_avance, montant, motif, depense_id)
  values (e.ferme_id, e.id, coalesce(p_date, current_date), p_montant, nullif(trim(coalesce(p_motif, '')), ''), v_dep)
  returning id into v_id;
  return v_id;
end;
$$;

-- Paie du mois : net = salaire + primes − retenues − avances non déduites
create function public.payer_salaire(p_employe uuid, p_mois date, p_mode public.mode_paiement,
                                     p_primes numeric default 0, p_retenues numeric default 0, p_motif_retenues text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.employes;
  v_mois date := date_trunc('month', p_mois)::date;
  v_avances numeric;
  v_net numeric;
  v_paie uuid;
  v_dep uuid;
begin
  if not public.a_role('directeur', 'finance') then raise exception 'Seuls le directeur et la finance gèrent les salaires'; end if;
  select * into e from public.employes where id = p_employe and ferme_id = public.ferme_actuelle();
  if e.id is null then raise exception 'Employé introuvable'; end if;
  if exists (select 1 from public.paies where employe_id = e.id and mois = v_mois and not annulee) then
    raise exception 'Le salaire de % pour ce mois est déjà payé', e.nom;
  end if;
  if coalesce(p_retenues, 0) > 0 and coalesce(trim(p_motif_retenues), '') = '' then
    raise exception 'Indiquez le motif de la retenue';
  end if;
  select coalesce(sum(montant), 0) into v_avances from public.avances_salaire
  where employe_id = e.id and not annulee and paie_id is null;
  v_net := e.salaire_mensuel + coalesce(p_primes, 0) - coalesce(p_retenues, 0) - v_avances;
  if v_net < 0 then
    raise exception 'Les avances et retenues (% FCFA) dépassent le salaire du mois', v_avances + coalesce(p_retenues, 0);
  end if;
  insert into public.paies (ferme_id, employe_id, mois, salaire_base, primes, retenues, motif_retenues, avances, mode_paiement)
  values (e.ferme_id, e.id, v_mois, e.salaire_mensuel, coalesce(p_primes, 0), coalesce(p_retenues, 0),
          nullif(trim(coalesce(p_motif_retenues, '')), ''), v_avances, p_mode)
  returning id into v_paie;
  if v_net > 0 then
    insert into public.depenses (ferme_id, date_depense, portee, activite, categorie, libelle, montant, mode_paiement, notes)
    values (e.ferme_id, current_date, 'generale', e.activite, 'salaires',
            format('Salaire %s – %s', to_char(v_mois, 'MM/YYYY'), e.nom), v_net, p_mode,
            case when v_avances > 0 then format('Avances déduites : %s FCFA', v_avances) end)
    returning id into v_dep;
    update public.paies set depense_id = v_dep where id = v_paie;
  end if;
  update public.avances_salaire set paie_id = v_paie where employe_id = e.id and not annulee and paie_id is null;
  return v_paie;
end;
$$;

-- Dépense d'une avance ou d'une paie annulée (directeur) → annulée ici aussi
create function public.annulation_salaire()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paie uuid;
begin
  if new.annulee and not old.annulee and new.categorie = 'salaires' then
    update public.avances_salaire set annulee = true where depense_id = new.id;
    for v_paie in update public.paies set annulee = true where depense_id = new.id and not annulee returning id loop
      update public.avances_salaire set paie_id = null where paie_id = v_paie;   -- à déduire de nouveau
    end loop;
  end if;
  return null;
end;
$$;
create trigger annulation_salaire after update on public.depenses
  for each row execute function public.annulation_salaire();

revoke execute on function public.annulation_salaire() from public, anon, authenticated;
grant execute on function public.verser_avance(uuid, numeric, public.mode_paiement, text, date),
                          public.payer_salaire(uuid, date, public.mode_paiement, numeric, numeric, text) to authenticated;
revoke all on public.employes, public.avances_salaire, public.paies from anon;
