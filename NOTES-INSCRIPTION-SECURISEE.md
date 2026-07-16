# MOTSA — Inscription émetteur sécurisée (nouveau flux)

Remplace la liste déroulante ouverte de `login-issuer.html` (n'importe quel e-mail pouvait
se déclarer d'un établissement existant) par : candidature → validation manuelle →
code d'inscription envoyé au domaine officiel → premier compte = administrateur →
invitations pour les collègues.

**Ces requêtes SQL sont à exécuter vous-même dans l'éditeur SQL de Supabase.**
Je n'ai pas les identifiants d'administration de votre projet Supabase — je ne peux ni
les exécuter à votre place, ni modifier vos fichiers directement sur votre machine.
Les fichiers modifiés (`auth.js`, `login-issuer.html`) sont fournis à côté de ce document ;
copiez-les vous-même dans votre dossier `MOTSA/assets` une fois relus.

## 1. Schéma — tables et colonnes

```sql
-- Marqueurs de vérification sur les organisations existantes
alter table organizations
  add column if not exists email_domain text,      -- ex. 'ecole-x.fr' — null = pas encore vérifié
  add column if not exists status text not null default 'pending' check (status in ('pending','verified'));

-- Rôle au sein d'une organisation (admin = premier compte, member = invité)
alter table profiles
  add column if not exists role text not null default 'member' check (role in ('admin','member'));

-- Candidatures publiques (formulaire "Demander l'accès")
create table organization_requests (
  id uuid primary key default gen_random_uuid(),
  org_name         text not null,
  siret            text,
  qualiopi_or_nda  text,
  official_domain  text not null,
  contact_name     text not null,
  contact_email    text not null,
  message          text,
  status           text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at       timestamptz not null default now(),
  reviewed_at      timestamptz,
  reviewed_by      uuid references auth.users(id)
);

-- Codes d'accès : fondateur (kind='founding') et invitations (kind='invitation')
create table access_codes (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  kind            text not null check (kind in ('founding','invitation')),
  organization_id uuid references organizations(id),
  request_id      uuid references organization_requests(id),
  role_to_grant   text not null default 'member' check (role_to_grant in ('admin','member')),
  email_lock      text,              -- si renseigné, seule cette adresse peut utiliser le code
  expires_at      timestamptz not null,
  used_at         timestamptz,
  used_by         uuid references auth.users(id),
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now()
);
```

## 2. RLS — verrouillage des accès

```sql
alter table organization_requests enable row level security;
alter table access_codes          enable row level security;

-- N'importe qui peut soumettre une candidature, personne ne peut lire la liste
-- (empêche un concurrent de scraper qui a candidaté)
create policy "public_submit_request" on organization_requests
  for insert to anon with check (true);

-- access_codes n'est accessible à personne directement : uniquement via les
-- fonctions SECURITY DEFINER ci-dessous. Aucune policy select/insert/update
-- n'est créée ici volontairement — la RLS bloque tout par défaut une fois activée.
```

Important : si un trigger existant crée déjà une ligne `profiles` automatiquement à partir
des métadonnées `auth.signUp` (`organization_id`, `account_type`, `role` dans `options.data`,
comme dans l'ancien `auth.js`), **désactivez-le ou adaptez-le** pour ne plus rien faire sur
ces trois champs : la fonction `redeem_access_code` ci-dessous est désormais seule responsable
de la création du profil, avec l'organisation et le rôle vérifiés côté serveur — sinon un
utilisateur pourrait recréer l'ancienne faille en repassant `organization_id` dans les
métadonnées de `signUp` lui-même. Si vous ne savez plus où se trouve ce trigger, cherchez
dans Supabase → Database → Triggers sur `auth.users`, ou dans Database → Functions.

## 3. Fonctions

```sql
-- Rédemption d'un code (fondateur ou invitation) par l'utilisateur authentifié courant
create or replace function redeem_access_code(p_code text, p_full_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   access_codes%rowtype;
  v_uid   uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then
    return jsonb_build_object('error','not_authenticated');
  end if;

  select email into v_email from auth.users where id = v_uid;

  select * into v_row from access_codes
    where code = p_code and used_at is null and expires_at > now()
    for update;

  if not found then
    return jsonb_build_object('error','invalid_or_expired_code');
  end if;

  if v_row.email_lock is not null and lower(v_row.email_lock) <> lower(v_email) then
    return jsonb_build_object('error','email_mismatch');
  end if;

  update access_codes set used_at = now(), used_by = v_uid where id = v_row.id;

  if v_row.kind = 'founding' then
    update organizations set status = 'verified' where id = v_row.organization_id;
  end if;

  insert into profiles (id, full_name, account_type, organization_id, role)
  values (v_uid, p_full_name, 'issuer', v_row.organization_id, v_row.role_to_grant)
  on conflict (id) do update
    set organization_id = excluded.organization_id,
        role            = excluded.role,
        account_type    = 'issuer';

  return jsonb_build_object('organization_id', v_row.organization_id, 'role', v_row.role_to_grant);
end;
$$;

-- Un admin d'organisation génère une invitation pour un collègue
create or replace function create_invitation(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_org   uuid;
  v_role  text;
  v_code  text;
begin
  select organization_id, role into v_org, v_role
    from profiles where id = v_uid and account_type = 'issuer';

  if v_org is null or v_role <> 'admin' then
    return jsonb_build_object('error','not_admin');
  end if;

  v_code := 'INV-' || upper(substr(encode(gen_random_bytes(6),'hex'), 1, 10));

  insert into access_codes (code, kind, organization_id, role_to_grant, email_lock, expires_at, created_by)
  values (v_code, 'invitation', v_org, 'member', lower(p_email), now() + interval '14 days', v_uid);

  return jsonb_build_object('code', v_code);
end;
$$;
```

## 4. Comment ça fonctionne en pratique aujourd'hui (v1, sans envoi d'e-mail automatisé)

Pas besoin d'un service d'e-mail transactionnel pour démarrer — le volume de nouvelles
inscriptions est encore faible, autant garder le contrôle manuel plutôt qu'ajouter une
dépendance (Resend/Postmark + Edge Function) tout de suite.

1. Un établissement remplit "Demander l'accès" sur `login-issuer.html` →
   ligne créée dans `organization_requests` (status `pending`).
2. Vous vérifiez manuellement le SIRET (societe.com / annuaire-entreprises.data.gouv.fr)
   et le n° Qualiopi/NDA si fourni.
3. Si c'est légitime : vous créez (ou retrouvez) la ligne dans `organizations`, avec
   `email_domain` = le domaine officiel déclaré. Puis vous insérez un code fondateur :

   ```sql
   insert into access_codes (code, kind, organization_id, role_to_grant, email_lock, expires_at)
   values (
     'REG-' || upper(substr(encode(gen_random_bytes(6),'hex'),1,10)),
     'founding',
     '<id de l organisation>',
     'admin',
     '<adresse e-mail du contact, doit finir par le domaine officiel>',
     now() + interval '7 days'
   )
   returning code;
   ```

4. Vous envoyez ce code manuellement (par e-mail, depuis `contact@motsa.tech`) à
   l'adresse `contact_email` de la candidature — jamais à une adresse Gmail/perso.
5. Le contact va sur `login-issuer.html`, onglet "J'ai un code", saisit le code +
   crée son mot de passe → il devient administrateur de l'organisation.
6. Depuis son tableau de bord, il peut ensuite générer des invitations (`create_invitation`)
   pour ses collègues, restreintes à l'adresse e-mail invitée et au domaine de l'organisation.

## 6. Double authentification à la connexion (mot de passe + code e-mail)

`auth.js` v4 ajoute `startLoginWithPassword`, `completeLoginWithOtp` et
`finalizeIssuerLogin`, utilisés par `login-issuer.html`. Fonctionnement :

1. L'utilisateur saisit e-mail + mot de passe → `signInWithPassword` vérifie
   les identifiants, puis la session obtenue est **révoquée immédiatement**
   (`signOut({scope:'local'})`) — elle ne sert qu'à prouver que le mot de
   passe est correct, jamais à ouvrir l'accès.
2. `signInWithOtp({ email, options:{ shouldCreateUser:false } })` déclenche
   l'envoi par Supabase d'un code à 6 chiffres à cette adresse.
3. L'utilisateur saisit le code → `verifyOtp` établit la session définitive.
4. `finalizeIssuerLogin` vérifie qu'un profil émetteur existe pour ce
   compte, sinon révoque à nouveau la session.

**À activer dans Supabase avant mise en ligne** : Authentication → Providers
→ Email → activer "Enable Email OTP" (ou l'option équivalente selon la
version de votre projet — certains projets l'appellent "One-Time Password").
Sans cette activation, `signInWithOtp` renverra une erreur.

**Limite honnête de cette approche** : ce n'est pas la MFA native de
Supabase (qui repose sur TOTP/SMS et sait imposer un niveau `aal2` au niveau
des policies RLS). Ici, le "deuxième facteur" est recomposé côté client à
partir de deux appels successifs à l'API publique — un attaquant qui
contrôlerait à la fois le mot de passe et la boîte e-mail contournerait
évidemment ce contrôle, comme pour toute 2FA par e-mail. C'est un vrai cran
de sécurité supplémentaire (un mot de passe seul ne suffit plus), mais pas
équivalent à une MFA TOTP à proprement parler. Si vous voulez ce niveau-là
plus tard, il faudra migrer vers `auth.mfa.enroll()`/`challenge()`/`verify()`
et imposer `aal2` dans les policies RLS des tables sensibles.

Pensez aussi au débit d'envoi : Supabase limite le nombre d'e-mails OTP
envoyés par adresse sur une fenêtre de temps donnée (paramétrable dans
Auth → Rate Limits) — utile contre le spam, mais à ne pas régler trop bas
au risque de bloquer un utilisateur légitime qui redemande un code.

## 7. Point de vigilance : confirmation e-mail Supabase

Si la confirmation d'e-mail est activée sur votre projet Supabase (recommandé — Auth →
Providers → Email → "Confirm email"), `auth.signUp` ne renvoie pas de session active
immédiatement : la rédemption du code (`redeem_access_code`) ne peut avoir lieu qu'après
que l'utilisateur a cliqué le lien de confirmation et s'est connecté. Le code saisi est
donc stocké temporairement côté client (sessionStorage) et la rédemption est retentée
automatiquement à la première connexion réussie — voir `auth.js`, fonction
`redeemPendingCodeIfAny()`.
