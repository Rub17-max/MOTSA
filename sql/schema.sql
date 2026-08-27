-- =========================================================
-- BEEVERS — Schéma Supabase (Postgres)
-- À exécuter dans l'éditeur SQL du dashboard Supabase.
-- Couvre les tables + fonctions RPC appelées par js/supabaseClient.js.
-- Complète, ne remplace pas, une revue de sécurité avant mise en prod.
-- =========================================================

-- ---------- PROFILES ----------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  public_id text unique not null default ('BVR-' || substr(md5(random()::text), 1, 6)),
  prenom text not null,
  genre text,
  birthdate date,
  ville_actuelle text,
  ville_recherchee text,
  bio text,
  avatar_url text,          -- affiché pendant le swipe
  photo_url text,           -- révélée après match uniquement (cf. RLS ci-dessous)
  statut text,              -- Étudiant(e) / Actif(ve)
  etudes text,
  langues text,
  type_logement text,       -- Chambre en coloc / Coloc à créer / Solo
  budget int,
  disponibilite date,
  regime text,
  proprete text,
  rythme text,
  tabac text,
  reception text,
  animaux text,
  loisirs text[],
  is_certified boolean not null default false,
  certified_at timestamptz,
  certified_by uuid,        -- id de l'admin ayant validé (vérification interne, cf. cahier des charges 3.5)
  is_visible boolean not null default true,
  is_premium boolean not null default false,
  premium_until timestamptz,
  profile_complete boolean not null default false,
  created_at timestamptz not null default now()
);
alter table profiles enable row level security;
create policy "Lecture publique des champs de matching (hors photo réelle)"
  on profiles for select using (true); -- affiner côté application : ne jamais envoyer photo_url avant match confirmé
create policy "Un utilisateur modifie uniquement son propre profil"
  on profiles for update using (auth.uid() = id);
create policy "Un utilisateur crée uniquement son propre profil"
  on profiles for insert with check (auth.uid() = id);

-- ---------- SWIPES ----------
create table if not exists swipes (
  id bigint generated always as identity primary key,
  swiper_id uuid not null references profiles(id) on delete cascade,
  target_id uuid not null references profiles(id) on delete cascade,
  direction text not null check (direction in ('like','pass')),
  created_at timestamptz not null default now(),
  unique (swiper_id, target_id)
);
alter table swipes enable row level security;
create policy "Un utilisateur ne voit que ses propres swipes"
  on swipes for select using (auth.uid() = swiper_id);
create policy "Un utilisateur ne crée que ses propres swipes"
  on swipes for insert with check (auth.uid() = swiper_id);

-- ---------- MATCHES ----------
create table if not exists matches (
  id bigint generated always as identity primary key,
  user_a uuid not null references profiles(id) on delete cascade,
  user_b uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_a, user_b)
);
alter table matches enable row level security;
create policy "Un utilisateur voit les matchs auxquels il participe"
  on matches for select using (auth.uid() in (user_a, user_b));

-- ---------- CONVERSATIONS & MESSAGES ----------
-- kind: 'match' | 'id_invite' | 'annonce'
create table if not exists conversations (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('match','id_invite','annonce')),
  match_id bigint references matches(id) on delete set null,
  annonce_id bigint,          -- référence annonces(id), voir plus bas
  user_a uuid not null references profiles(id) on delete cascade,
  user_b uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table conversations enable row level security;
create policy "Un utilisateur voit ses conversations"
  on conversations for select using (auth.uid() in (user_a, user_b));

create table if not exists messages (
  id bigint generated always as identity primary key,
  conversation_id bigint not null references conversations(id) on delete cascade,
  sender_id uuid not null references profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);
alter table messages enable row level security;
create policy "Un utilisateur voit les messages de ses conversations"
  on messages for select using (
    exists (select 1 from conversations c where c.id = conversation_id and auth.uid() in (c.user_a, c.user_b))
  );
create policy "Un utilisateur envoie des messages dans ses conversations"
  on messages for insert with check (
    auth.uid() = sender_id and
    exists (select 1 from conversations c where c.id = conversation_id and auth.uid() in (c.user_a, c.user_b))
  );

-- ---------- INVITATIONS PAR ID (Premium) ----------
create table if not exists chat_invites (
  id bigint generated always as identity primary key,
  from_id uuid not null references profiles(id) on delete cascade,
  to_id uuid not null references profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now()
);
alter table chat_invites enable row level security;
create policy "Un utilisateur voit les invitations qui le concernent"
  on chat_invites for select using (auth.uid() in (from_id, to_id));

-- ---------- TEAMS ----------
create table if not exists teams (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  archived boolean not null default false
);
create table if not exists team_members (
  team_id bigint not null references teams(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
-- Contrainte clé : un utilisateur ne peut appartenir qu'à une seule Team active (FR-TEAM-01)
create unique index if not exists one_active_team_per_user on team_members (user_id);

create table if not exists team_invites (
  id bigint generated always as identity primary key,
  team_id bigint not null references teams(id) on delete cascade,
  from_id uuid not null references profiles(id) on delete cascade,
  to_id uuid not null references profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now()
);

create table if not exists team_messages (
  id bigint generated always as identity primary key,
  team_id bigint not null references teams(id) on delete cascade,
  sender_id uuid not null references profiles(id) on delete cascade,
  content text,
  attachment_url text,
  attachment_type text check (attachment_type in ('media','link','doc')),
  created_at timestamptz not null default now()
);
alter table teams enable row level security;
alter table team_members enable row level security;
alter table team_invites enable row level security;
alter table team_messages enable row level security;
create policy "Membres visibles par les membres de la Team"
  on team_members for select using (
    exists (select 1 from team_members tm where tm.team_id = team_members.team_id and tm.user_id = auth.uid())
  );
create policy "Messages visibles par les membres de la Team"
  on team_messages for select using (
    exists (select 1 from team_members tm where tm.team_id = team_messages.team_id and tm.user_id = auth.uid())
  );
create policy "Un membre envoie des messages dans sa Team"
  on team_messages for insert with check (
    auth.uid() = sender_id and
    exists (select 1 from team_members tm where tm.team_id = team_messages.team_id and tm.user_id = auth.uid())
  );

-- ---------- ANNONCES ----------
create table if not exists annonces (
  id bigint generated always as identity primary key,
  titre text not null,
  description text,
  ville text not null,
  prix int not null,
  surface int,
  type_bien text,
  dispo date,
  annonceur_type text check (annonceur_type in ('particulier','agence_partenaire','apporteur_affaires')),
  annonceur_nom text,
  annonceur_contact text,
  photos text[],
  is_partner_ad boolean not null default false, -- mention "Partenaire" (FR-ANN-05)
  created_at timestamptz not null default now()
);
alter table annonces enable row level security;
create policy "Annonces visibles par tous les utilisateurs connectés"
  on annonces for select using (auth.role() = 'authenticated');

-- =========================================================
-- FONCTIONS RPC (logique métier) — appelées par supabaseClient.js
-- Écrites en PL/pgSQL, security definer pour appliquer les règles
-- de gestion indépendamment des policies RLS de lecture simple.
-- =========================================================

-- Swipes restants aujourd'hui (5/jour en Gratuit, illimité en Premium — FR-SWIPE-01/02)
create or replace function get_swipes_left_today()
returns int language plpgsql security definer as $$
declare
  is_prem boolean;
  used int;
begin
  select is_premium into is_prem from profiles where id = auth.uid();
  if is_prem then return 999999; end if;
  select count(*) into used from swipes
    where swiper_id = auth.uid() and created_at::date = now()::date;
  return greatest(0, 5 - used);
end; $$;

-- File de profils à swiper : exclut déjà swipés, non-visibles, soi-même
create or replace function get_swipe_queue()
returns setof profiles language sql security definer as $$
  select p.* from profiles p
  where p.id <> auth.uid()
    and p.is_visible = true
    and p.profile_complete = true
    and not exists (select 1 from swipes s where s.swiper_id = auth.uid() and s.target_id = p.id)
  limit 30;
$$;

-- Enregistre un swipe, applique la limite gratuite, crée le match si mutuel (FR-SWIPE-01/02/04)
create or replace function send_swipe(target_id uuid, direction text)
returns jsonb language plpgsql security definer as $$
declare
  is_prem boolean;
  used int;
  mutual boolean;
  new_match_id bigint;
  ua uuid; ub uuid;
begin
  select is_premium into is_prem from profiles where id = auth.uid();
  if not is_prem then
    select count(*) into used from swipes where swiper_id = auth.uid() and created_at::date = now()::date;
    if used >= 5 then
      raise exception 'Limite quotidienne de swipes atteinte.';
    end if;
  end if;

  insert into swipes (swiper_id, target_id, direction) values (auth.uid(), target_id, direction)
    on conflict (swiper_id, target_id) do nothing;

  if direction = 'like' then
    select exists(select 1 from swipes where swiper_id = target_id and target_id = auth.uid() and direction = 'like')
      into mutual;
    if mutual then
      ua := least(auth.uid(), target_id); ub := greatest(auth.uid(), target_id);
      insert into matches (user_a, user_b) values (ua, ub) on conflict do nothing
        returning id into new_match_id;
      if new_match_id is null then select id into new_match_id from matches where user_a = ua and user_b = ub; end if;
      insert into conversations (kind, match_id, user_a, user_b) values ('match', new_match_id, ua, ub);
    end if;
  end if;

  return jsonb_build_object('matched', coalesce(mutual,false), 'match_id', new_match_id);
end; $$;

-- Ma Team actuelle (avec membres)
create or replace function get_my_team()
returns jsonb language plpgsql security definer as $$
declare result jsonb; my_team_id bigint;
begin
  select team_id into my_team_id from team_members where user_id = auth.uid();
  if my_team_id is null then return null; end if;
  select jsonb_build_object(
    'id', t.id,
    'members', (select jsonb_agg(jsonb_build_object('id', p.id, 'prenom', p.prenom, 'avatar_url', p.avatar_url))
                from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = t.id)
  ) into result from teams t where t.id = my_team_id;
  return result;
end; $$;

-- Inviter un utilisateur dans sa Team (crée la Team si besoin) — FR-CHAT-01/02
create or replace function invite_to_team(invitee_id uuid)
returns jsonb language plpgsql security definer as $$
declare my_team_id bigint;
begin
  select team_id into my_team_id from team_members where user_id = auth.uid();
  if my_team_id is null then
    insert into teams default values returning id into my_team_id;
    insert into team_members (team_id, user_id) values (my_team_id, auth.uid());
  end if;
  insert into team_invites (team_id, from_id, to_id) values (my_team_id, auth.uid(), invitee_id);
  return jsonb_build_object('team_id', my_team_id);
end; $$;

-- Répondre à une invitation Team — bloque si l'invité a déjà une Team (FR-CHAT-04)
create or replace function respond_team_invite(invite_id bigint, accept boolean)
returns jsonb language plpgsql security definer as $$
declare inv record; already_in_team boolean;
begin
  select * into inv from team_invites where id = invite_id and to_id = auth.uid();
  if inv is null then raise exception 'Invitation introuvable.'; end if;

  if accept then
    select exists(select 1 from team_members where user_id = auth.uid()) into already_in_team;
    if already_in_team then
      raise exception 'Vous devez quitter votre Team actuelle avant de rejoindre celle-ci.';
    end if;
    insert into team_members (team_id, user_id) values (inv.team_id, auth.uid());
    update team_invites set status = 'accepted' where id = invite_id;
  else
    update team_invites set status = 'declined' where id = invite_id;
  end if;
  return jsonb_build_object('ok', true);
end; $$;

-- Quitter sa Team — débloque Swipe/nouveaux tchats (FR-TEAM-04)
create or replace function leave_team()
returns boolean language plpgsql security definer as $$
declare my_team_id bigint; remaining int;
begin
  select team_id into my_team_id from team_members where user_id = auth.uid();
  if my_team_id is null then return false; end if;
  delete from team_members where team_id = my_team_id and user_id = auth.uid();
  select count(*) into remaining from team_members where team_id = my_team_id;
  if remaining = 0 then update teams set archived = true where id = my_team_id; end if;
  return true;
end; $$;

-- Conversations de l'utilisateur, tous types confondus
create or replace function get_conversations()
returns setof conversations language sql security definer as $$
  select * from conversations where auth.uid() in (user_a, user_b) order by created_at desc;
$$;

-- Recherche + invitation par ID — Premium uniquement (FR-CHAT-07/08/10/11)
create or replace function send_chat_invite(target_id uuid)
returns jsonb language plpgsql security definer as $$
declare is_prem boolean; recent_decline boolean;
begin
  select is_premium into is_prem from profiles where id = auth.uid();
  if not is_prem then raise exception 'La recherche par ID est réservée aux comptes Premium.'; end if;

  select exists(
    select 1 from chat_invites
    where from_id = auth.uid() and to_id = target_id and status = 'declined'
      and created_at > now() - interval '30 days'
  ) into recent_decline;
  if recent_decline then raise exception 'Cette personne a décliné votre demande récemment. Réessayez plus tard.'; end if;

  insert into chat_invites (from_id, to_id) values (auth.uid(), target_id) returning id as invite_id;
  return jsonb_build_object('sent', true);
end; $$;

create or replace function respond_chat_invite(invite_id bigint, accept boolean)
returns jsonb language plpgsql security definer as $$
declare inv record; ua uuid; ub uuid; conv_id bigint;
begin
  select * into inv from chat_invites where id = invite_id and to_id = auth.uid();
  if inv is null then raise exception 'Invitation introuvable.'; end if;
  if accept then
    update chat_invites set status = 'accepted' where id = invite_id;
    ua := least(inv.from_id, inv.to_id); ub := greatest(inv.from_id, inv.to_id);
    insert into conversations (kind, user_a, user_b) values ('id_invite', ua, ub) returning id into conv_id;
  else
    update chat_invites set status = 'declined' where id = invite_id;
  end if;
  return jsonb_build_object('conversation_id', conv_id);
end; $$;

-- Contacter l'annonceur d'une annonce (FR-ANN-02)
create or replace function contact_annonce_owner(annonce_id bigint, message text)
returns jsonb language plpgsql security definer as $$
declare conv_id bigint;
begin
  insert into conversations (kind, annonce_id, user_a, user_b) values ('annonce', annonce_id, auth.uid(), auth.uid())
    returning id into conv_id; -- adapter user_b à l'ID réel du compte annonceur une fois les comptes agences en place
  insert into messages (conversation_id, sender_id, content) values (conv_id, auth.uid(), message);
  return jsonb_build_object('conversation_id', conv_id);
end; $$;

-- Partager une annonce dans le chat de la Team (FR-ANN-03/04)
create or replace function send_annonce_to_team(annonce_id bigint)
returns boolean language plpgsql security definer as $$
declare my_team_id bigint;
begin
  select team_id into my_team_id from team_members where user_id = auth.uid();
  if my_team_id is null then raise exception 'Rejoignez une Team pour partager une annonce.'; end if;
  insert into team_messages (team_id, sender_id, attachment_url, attachment_type)
    values (my_team_id, auth.uid(), annonce_id::text, 'link');
  return true;
end; $$;

-- RGPD : suppression et export (FR-CPT-03/04)
create or replace function request_account_deletion()
returns boolean language plpgsql security definer as $$
begin
  -- À adapter : marquer le compte "à supprimer le <now()+14j>" plutôt que supprimer immédiatement,
  -- puis exécuter la suppression définitive via un cron Supabase (pg_cron) après le délai de rétractation.
  update profiles set is_visible = false where id = auth.uid();
  return true;
end; $$;

create or replace function export_my_data()
returns jsonb language sql security definer as $$
  select jsonb_build_object(
    'profile', (select to_jsonb(p) from profiles p where p.id = auth.uid()),
    'swipes', (select jsonb_agg(to_jsonb(s)) from swipes s where s.swiper_id = auth.uid()),
    'matches', (select jsonb_agg(to_jsonb(m)) from matches m where auth.uid() in (m.user_a, m.user_b)),
    'messages', (select jsonb_agg(to_jsonb(msg)) from messages msg
                 join conversations c on c.id = msg.conversation_id
                 where auth.uid() in (c.user_a, c.user_b))
  );
$$;

-- =========================================================
-- STORAGE BUCKETS à créer manuellement (dashboard > Storage) :
--   avatars              (public)
--   profile-photos       (privé — accès signé après confirmation du match)
--   identity-documents   (privé — accès restreint à l'équipe de modération,
--                          durée de conservation limitée, cf. cahier des charges §14.1)
-- =========================================================

-- =========================================================
-- STRIPE / PAIEMENTS
-- Le passage Premium et sa résiliation (FR-CPT-01/02) ne se gèrent pas en SQL :
-- créer deux Supabase Edge Functions "create-stripe-checkout" et
-- "cancel-stripe-subscription" qui appellent l'API Stripe, puis un webhook
-- Stripe -> Edge Function qui met à jour profiles.is_premium / premium_until.
-- =========================================================
