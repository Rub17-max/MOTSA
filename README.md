# Beevers — site web (HTML/CSS/JS + Supabase)

Site statique conforme au cahier des charges fonctionnel Beevers (accueil,
authentification, profil, swipe, tchats, Team, annonces, mon compte).

## Ouvrir le site dès maintenant (sans Supabase)

Le site tourne en **mode démo** tant que `js/config.js` contient les valeurs
`REPLACE_ME` : toutes les pages fonctionnent avec des données fictives en
mémoire (voir bannière orange en haut de chaque page connectée). Il suffit
d'ouvrir `index.html` dans un navigateur (ou de servir le dossier avec
n'importe quel serveur statique) pour tester tout le parcours : inscription
→ profil → swipe → match → invitation Team → tchat → annonces.

## Brancher Supabase quand le projet est prêt

1. Crée un projet sur [supabase.com](https://supabase.com).
2. Dans **SQL Editor**, exécute le contenu de `sql/schema.sql` (tables, RLS,
   fonctions RPC).
3. Dans **Storage**, crée les 3 buckets listés en bas de `schema.sql`
   (`avatars`, `profile-photos`, `identity-documents`) avec les bons
   réglages de confidentialité.
4. Dans **Authentication > Providers**, active Google et Apple (il te faudra
   leurs identifiants OAuth respectifs — Google Cloud Console / Apple
   Developer).
5. Dans **Project Settings > API**, copie l'URL du projet et la clé `anon`
   dans `js/config.js` :
   ```js
   SUPABASE_URL: "https://xxxxxxxx.supabase.co",
   SUPABASE_ANON_KEY: "eyJ...",
   ```
6. Recharge le site : la bannière de mode démo disparaît, toutes les pages
   utilisent désormais Supabase (auth réelle, base de données réelle).

## Paiement Premium (Stripe)

Le passage Premium (9,99 €/mois) et sa résiliation nécessitent deux
Supabase Edge Functions (`create-stripe-checkout`, `cancel-stripe-subscription`)
qui appellent l'API Stripe, plus un webhook Stripe relié à une troisième
Edge Function pour mettre à jour `profiles.is_premium`. Voir la note en bas
de `sql/schema.sql`. Non incluses ici (nécessitent tes propres clés Stripe).

## Structure du projet

```
index.html        Page d'accueil publique
auth.html         Connexion / inscription (Google, Apple, e-mail)
profil.html       Assistant de création/édition du profil (6 étapes)
swipe.html        Swipe / matching
tchats.html       Liste de conversations + tchat + recherche par ID (Premium)
team.html         Chat de groupe Team + onglets Médias/Liens/Documents
annonces.html     Recherche d'annonces + fiche détaillée + contact
compte.html       Profil, abonnement, réglages, RGPD
css/style.css     Design system (couleurs, typographie, composants)
js/config.js      Identifiants Supabase (à renseigner)
js/supabaseClient.js  Appels Supabase réels + repli mode démo
js/mockDemo.js    Données fictives pour le mode démo
js/nav.js         Garde d'authentification + état de navigation
js/utils.js       Fonctions utilitaires partagées
sql/schema.sql    Schéma Supabase complet (tables, RLS, fonctions RPC)
```

## Points laissés ouverts (cf. cahier des charges §15)

- Le compteur de 5 swipes/jour ne compte ici que les **likes** (les
  "passer" restent illimités) — à confirmer.
- La vérification d'identité (badge certifié) n'a pas d'interface admin
  ici : `is_certified` se met à jour manuellement en base pour l'instant.
- L'intégration Stripe réelle n'est pas incluse (clés non fournies).
