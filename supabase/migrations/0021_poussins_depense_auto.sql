-- =====================================================================
-- HENZO – Réception de poussins : la dépense est créée automatiquement
-- À chaque livraison cochée « Livré », HENZO crée la dépense des poussins
-- reçus (nombre reçu × prix de la commande), liée à la bande et au
-- fournisseur. Elle suit les règles habituelles : saisie par
-- l'exploitation → « à valider » par la finance (seuil de la ferme) ;
-- payée en espèces / Mobile Money / banque, ou à crédit (dette fournisseur).
-- Sans prix ou sans fournisseur (au-delà du seuil), pas de dépense : la
-- finance et le directeur sont prévenus de la saisir.
-- À exécuter une fois dans Supabase > SQL Editor, après 0020.
-- =====================================================================

alter table public.livraisons_poussins add column depense_id uuid references public.depenses (id);

drop function public.receptionner_livraison(uuid, integer, date, date);

create function public.receptionner_livraison(p_livraison uuid, p_nombre integer, p_date date,
                                              p_date_reste date default null, p_paiement text default 'credit')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.livraisons_poussins;
  c public.commandes_poussins;
  v_bande uuid;
  v_reste integer;
  v_montant numeric;
  v_depense uuid;
  v_seuil numeric;
begin
  if not public.a_role('directeur', 'exploitation') then
    raise exception 'Seuls l''exploitation et le directeur réceptionnent les poussins';
  end if;
  if coalesce(p_paiement, 'credit') not in ('especes', 'mobile_money', 'banque', 'credit') then
    raise exception 'Mode de paiement inconnu';
  end if;
  select * into l from public.livraisons_poussins where id = p_livraison and ferme_id = public.ferme_actuelle() for update;
  if l.id is null or l.statut <> 'prevue' then
    raise exception 'Cette livraison n''est plus en attente';
  end if;
  if p_nombre is null or p_nombre <= 0 then raise exception 'Indiquez le nombre de poussins reçus'; end if;
  select * into c from public.commandes_poussins where id = l.commande_id for update;
  v_reste := greatest(l.nombre - p_nombre, 0);

  if c.bande_id is null then
    perform set_config('henzo.reception_commande', 'on', true);
    insert into public.bandes (ferme_id, code, fournisseur_id, souche, date_arrivee, nombre_initial, batiment_id)
    values (c.ferme_id, c.code_bande, c.fournisseur_id, c.souche, p_date, p_nombre, c.batiment_id)
    returning id into v_bande;
    perform set_config('henzo.reception_commande', 'off', true);
    update public.commandes_poussins set bande_id = v_bande where id = c.id;
  else
    v_bande := c.bande_id;
  end if;

  -- Dépense des poussins reçus
  v_montant := round(p_nombre * coalesce(c.prix_unitaire, 0));
  select seuil_tiers_obligatoire into v_seuil from public.fermes where id = c.ferme_id;
  if v_montant > 0 and (c.fournisseur_id is not null or v_montant <= v_seuil) then
    insert into public.depenses (ferme_id, date_depense, portee, activite, bande_id, categorie, libelle, montant,
                                 fournisseur_id, a_credit, mode_paiement, notes)
    values (c.ferme_id, p_date, 'ferme', 'chair', v_bande, 'poussins',
            format('Poussins %s : %s × %s FCFA', c.code_bande, p_nombre, c.prix_unitaire), v_montant,
            c.fournisseur_id, coalesce(p_paiement, 'credit') = 'credit',
            case when coalesce(p_paiement, 'credit') = 'credit' then null else p_paiement::public.mode_paiement end,
            'Créée automatiquement à la réception (commande ' || c.reference || ')')
    returning id into v_depense;
  else
    perform public.notifier(c.ferme_id, r, 'depense_poussins',
      format('Poussins reçus pour %s (%s) : dépense à saisir (%s)', c.code_bande, p_nombre,
             case when v_montant = 0 then 'pas de prix dans la commande' else 'fournisseur manquant' end), '/argent')
    from unnest(array['finance', 'directeur']::public.role_utilisateur[]) r;
  end if;

  update public.livraisons_poussins
  set statut = 'livree', nombre = p_nombre, date_livraison = p_date, bande_id = v_bande, depense_id = v_depense,
      notes = format('Livrée (%s prévus le %s)', l.nombre, to_char(l.date_prevue, 'DD/MM/YYYY'))
  where id = l.id;
  update public.taches set statut = 'fait' where id = l.tache_id and statut = 'a_faire';

  if v_reste > 0 and p_date_reste is not null then
    perform public.prevoir_livraison(c.id, v_reste, p_date_reste, v_bande);
  end if;
  perform public.maj_statut_commande(c.id);
  return v_bande;
end;
$$;
revoke execute on function public.receptionner_livraison(uuid, integer, date, date, text) from public, anon;
grant execute on function public.receptionner_livraison(uuid, integer, date, date, text) to authenticated;
