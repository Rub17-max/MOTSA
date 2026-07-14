# MOTSA v2 — Notes de déploiement

Refonte : site FR, vérification publique, démos anonymisées (John Doe / Random University),
tarification + Stripe, pages sécurité et légal, corrections de bugs.

## À faire avant mise en ligne (dans l'ordre)

### 1. Stripe (paiements) — 20 min
Dans le dashboard Stripe : créer 3 produits en mode abonnement
(École 99 €/mois HT, Institution 349 €/mois HT, Vérificateur Pro 49 €/mois HT),
générer un **Payment Link** pour chacun (activer la collecte de TVA et l'adresse de facturation),
puis remplacer les 3 URL dans le bloc `STRIPE_PAYMENT_LINKS` en bas de `tarifs.html`.
Tant que les liens ne sont pas remplacés, les boutons basculent proprement sur un e-mail de contact.

### 2. Supabase — vérification publique (RLS) — 10 min
`verify.html` est désormais accessible sans compte. Pour que la lecture anonyme fonctionne,
ajouter une policy de lecture publique **limitée** sur `certificates` :

```sql
create policy "public_verify_read"
on certificates for select
to anon
using (true);
```

Recommandé : restreindre les colonnes exposées à l'anon via une vue
(certificate_code, holder_name, document_type, document_hash, issued_at, expires_at, status, issuer name)
plutôt que la table complète. Les insertions dans `verification_events` ne sont tentées
que pour les utilisateurs connectés — aucune policy anon nécessaire dessus.

### 3. E-mail — contact@motsa.tech
Toutes les adresses du site pointent vers **contact@motsa.tech** (l'ancien hello@motsa.com
était sur le mauvais domaine). Créer la boîte ou une redirection sur le domaine motsa.tech.

### 4. legal.html — champs [À COMPLÉTER]
SIREN, dénomination, adresse, directeur de publication, ville du tribunal,
durées de conservation, région Supabase. Repérables par les pastilles orange sur la page.

### 5. Quota de l'offre Découverte
Le bandeau du dashboard émetteur affiche X/20 certificats/mois (indicatif, côté client).
L'application stricte doit se faire côté base, par exemple :

```sql
-- Trigger de quota (exemple simple, à adapter au champ plan de organizations)
create or replace function check_monthly_quota() returns trigger as $$
begin
  if (select count(*) from certificates
      where issuer_org_id = new.issuer_org_id
        and created_at >= date_trunc('month', now())) >= 20
     and coalesce((select plan from organizations where id = new.issuer_org_id), 'decouverte') = 'decouverte'
  then
    raise exception 'Quota mensuel de l''offre Découverte atteint (20 certificats).';
  end if;
  return new;
end; $$ language plpgsql;
```

Ajouter un champ `plan` sur `organizations` ('decouverte' | 'ecole' | 'institution'),
mis à jour à la main ou via le webhook Stripe `checkout.session.completed`.

## Corrections incluses (bugs de la v1)
- `sendPasswordReset` n'existait pas dans auth.js → « mot de passe oublié » plantait. Corrigé.
- Compteur de vérifications du dashboard émetteur : lisait `data.length` sur une requête
  `head:true` (toujours null) → utilise maintenant `count`. Corrigé.
- ID de certificat : 6 hex (16M combinaisons, énumérable) → 16 hex. Corrigé.
- URL de vérification : pointait vers verify.motsa.com (domaine inexistant)
  → `motsa.tech/verify.html?c=<code>` (la page lit le paramètre, compatible QR). Corrigé.
- Les listes figées d'universités/entreprises réelles (HEC, BNP, McKinsey…) sont supprimées :
  les organisations sont chargées depuis la table `organizations`. Purger en base les
  éventuelles lignes de test portant des noms d'entités réelles non clientes.
- Mode démo de certif.html (hash aléatoire si aucun PDF) supprimé : un PDF est requis.

## Positionnement (rappel)
Émetteur payant / vérification publique gratuite. Cibles prioritaires : organismes de
formation (Qualiopi), écoles privées, certificateurs. Universités publiques : pilote
gratuit 12 mois sous convention (offre « Secteur public » de la page tarifs).
