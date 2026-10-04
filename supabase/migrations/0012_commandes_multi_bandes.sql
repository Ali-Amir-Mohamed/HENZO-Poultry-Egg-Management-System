-- =====================================================================
-- HENZO – Une commande de poussins pour plusieurs bandes
-- À exécuter une fois dans Supabase > SQL Editor, après 0011.
--
-- Une commande au couvoir peut couvrir 2 ou 3 bandes lancées en même temps
-- (ex. 3 000 poussins = B1 1 000 + B2 1 000 + B3 1 000). Chaque bande garde
-- sa ligne de commande et ses livraisons ; les lignes d'une même commande
-- partagent la même référence. Un code de bande ne peut servir qu'une fois.
-- =====================================================================

alter table public.commandes_poussins add column reference text;
create index on public.commandes_poussins (ferme_id, reference);

-- Lignes déjà créées : chacune devient sa propre commande
update public.commandes_poussins
set reference = 'CMD-' || to_char(date_commande, 'YYYYMMDD') || '-' || left(id::text, 4)
where reference is null;
alter table public.commandes_poussins alter column reference set not null;

-- Le code de la future bande doit être libre (ni bande existante, ni autre commande active)
create function public.controle_code_commande()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.code_bande := trim(new.code_bande);
  if exists (select 1 from public.bandes where ferme_id = new.ferme_id and lower(code) = lower(new.code_bande)) then
    raise exception 'Le code % est déjà utilisé par une bande', new.code_bande;
  end if;
  if exists (select 1 from public.commandes_poussins
             where ferme_id = new.ferme_id and lower(code_bande) = lower(new.code_bande)
               and statut in ('en_attente', 'partielle') and id <> new.id) then
    raise exception 'Le code % est déjà prévu dans une autre commande', new.code_bande;
  end if;
  return new;
end;
$$;
create trigger controle_code before insert on public.commandes_poussins
  for each row execute function public.controle_code_commande();
