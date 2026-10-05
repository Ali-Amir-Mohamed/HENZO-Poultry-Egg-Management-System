-- =====================================================================
-- HENZO – La finance voit le stock mais n'y touche pas
-- Fiches produits et achats qui entrent en stock (aliment, médicaments) :
-- directeur et exploitation seulement. La finance garde les dépenses
-- générales, les paiements et la validation des grosses dépenses.
-- À exécuter une fois dans Supabase > SQL Editor, après 0015.
-- =====================================================================

drop policy if exists articles_write on public.articles;
create policy articles_write on public.articles for all to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation'));

create function public.controle_achat_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and (new.categorie in ('aliment', 'medicament') or new.article_id is not null)
     and not public.a_role('directeur', 'exploitation') then
    raise exception 'Les achats qui entrent en stock (aliment, médicaments) sont saisis par l''exploitation ou le directeur';
  end if;
  return new;
end;
$$;
create trigger controle_achat_stock before insert on public.depenses
  for each row execute function public.controle_achat_stock();
revoke execute on function public.controle_achat_stock() from public, anon, authenticated;
