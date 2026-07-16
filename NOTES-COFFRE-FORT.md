# MOTSA — Coffre-fort de preuves Qualiopi (schéma Supabase)

Même remarque que pour l'inscription : ces requêtes sont à exécuter vous-même dans
l'éditeur SQL de Supabase et dans Storage → Buckets. Je n'ai pas les identifiants
d'administration de votre projet.

## 1. Bucket de stockage

Dans Supabase → Storage : créez un bucket **`vault-documents`**, **privé** (ne pas
cocher "Public bucket" — les fichiers ne doivent être accessibles que via URL signée
de courte durée, jamais par URL publique directe).

## 2. Table

```sql
create table vault_documents (
  id              uuid primary key default gen_random_uuid(),
  certificate_id  uuid not null references certificates(id),
  organization_id uuid not null references organizations(id),
  storage_path    text not null,               -- '{organization_id}/{certificate_id}.pdf'
  fse_cofinanced  boolean not null default false,
  retention_until date not null,               -- calculée par trigger, jamais fournie par le client
  created_at      timestamptz not null default now()
);

alter table vault_documents enable row level security;

-- Calcul serveur de la durée de rétention : 5 ans par défaut, 10 ans si FSE.
-- Le client ne peut pas choisir cette date lui-même.
create or replace function compute_retention_until()
returns trigger
language plpgsql
as $$
begin
  new.retention_until := (now() + case when new.fse_cofinanced then interval '10 years' else interval '5 years' end)::date;
  return new;
end;
$$;

create trigger trg_compute_retention
  before insert on vault_documents
  for each row execute function compute_retention_until();
```

## 3. RLS — un établissement ne voit que ses propres documents

```sql
create policy "org_select_own_vault_documents" on vault_documents
  for select to authenticated
  using (organization_id = (select organization_id from profiles where id = auth.uid() and account_type = 'issuer'));

create policy "org_insert_own_vault_documents" on vault_documents
  for insert to authenticated
  with check (organization_id = (select organization_id from profiles where id = auth.uid() and account_type = 'issuer'));
```

## 4. Policies sur le bucket (Storage → vault-documents → Policies)

```sql
-- Lecture : uniquement les fichiers dont le premier segment du chemin
-- correspond à l'organisation de l'utilisateur connecté.
create policy "org_read_own_vault_files"
on storage.objects for select to authenticated
using (
  bucket_id = 'vault-documents'
  and (storage.foldername(name))[1] = (
    select organization_id::text from profiles where id = auth.uid() and account_type = 'issuer'
  )
);

create policy "org_write_own_vault_files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'vault-documents'
  and (storage.foldername(name))[1] = (
    select organization_id::text from profiles where id = auth.uid() and account_type = 'issuer'
  )
);
```

## 5. Purge à l'échéance légale

Pas d'automatisation à l'ouverture — vous pouvez exécuter cette requête manuellement
une fois par mois (elle liste ce qui est arrivé à échéance, sans rien supprimer
automatiquement tant que vous n'avez pas vérifié la liste) :

```sql
select id, certificate_id, storage_path, retention_until
from vault_documents
where retention_until <= current_date;
```

Une fois vérifié, supprimez le fichier correspondant dans Storage puis la ligne en
base. Si votre projet Supabase est sur un plan payant avec l'extension `pg_cron`,
cette requête peut être automatisée pour générer un rapport hebdomadaire — demandez-le
si vous voulez que je prépare ce cron.

## 6. Ce qui est branché côté site, et ce qui ne l'est pas encore

`auth.js` contient désormais `uploadToVault()` et `fetchVaultDocuments()`.
`certif.html` propose la case "Conserver ce document dans le Coffre-fort" + la case
FSE. Ce qui **n'existe pas encore** : l'interface façon Gmail pour parcourir tous les
documents du coffre (liste, recherche par titulaire) — pour l'instant, `dashboard.html`
affiche seulement si un certificat a un document associé dans le coffre, sans vue
dédiée. C'est la prochaine brique si vous voulez aller plus loin.
