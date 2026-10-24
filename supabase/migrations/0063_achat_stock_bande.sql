-- =====================================================================
-- HENZO – Achat envoyé directement dans le stock d'une bande
--   * Quand Kenfack achète de l'aliment ou un médicament et choisit une
--     bande, la marchandise entre dans le stock de la ferme et va tout de
--     suite dans le stock de cette bande (plus besoin de « Mettre dans le
--     stock » ensuite). Sans bande : elle reste dans le stock général.
--   * Si l'achat est annulé ou refusé, ce qu'il avait mis dans le stock de
--     la bande en est retiré (ce qui y reste encore).
-- À exécuter dans Supabase > SQL Editor, après 0062 (peut être relancée sans erreur).
-- =====================================================================

alter table public.affectations_stock add column if not exists depense_id uuid references public.depenses (id);

create or replace function public.achat_vers_stock_bande()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reste numeric;
begin
  if new.article_id is null or new.bande_id is null or coalesce(new.quantite, 0) <= 0 then return null; end if;
  if tg_op = 'INSERT' then
    if new.annulee or new.statut = 'rejetee' then return null; end if;
    if exists (select 1 from public.bandes where id = new.bande_id and statut <> 'cloturee') then
      insert into public.affectations_stock (ferme_id, bande_id, article_id, quantite, date_affectation, depense_id, saisi_par)
      values (new.ferme_id, new.bande_id, new.article_id, round(new.quantite, 3), new.date_depense, new.id, new.saisi_par);
    end if;
  elsif (new.annulee and not old.annulee) or (new.statut = 'rejetee' and old.statut <> 'rejetee') then
    -- take back from the flock's stock what this purchase had put there (what is still left of it)
    if exists (select 1 from public.affectations_stock where depense_id = new.id and quantite > 0) then
      v_reste := least(new.quantite, greatest(public.stock_bande(new.bande_id, new.article_id), 0));
      if v_reste > 0 then
        insert into public.affectations_stock (ferme_id, bande_id, article_id, quantite, date_affectation, depense_id, saisi_par)
        values (new.ferme_id, new.bande_id, new.article_id, -round(v_reste, 3), current_date, new.id, coalesce(auth.uid(), new.saisi_par));
      end if;
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists achat_vers_stock_bande on public.depenses;
create trigger achat_vers_stock_bande after insert or update of annulee, statut on public.depenses
  for each row execute function public.achat_vers_stock_bande();
