/**
 * BEEVERS — Configuration Supabase
 * -------------------------------------------------------
 * Renseigne ces deux valeurs une fois ton projet Supabase créé
 * (Project Settings > API dans le dashboard Supabase) :
 *
 *   SUPABASE_URL      -> "https://xxxxxxxx.supabase.co"
 *   SUPABASE_ANON_KEY -> la clé publique "anon" (jamais la clé "service_role")
 *
 * Tant que ces deux valeurs valent "REPLACE_ME", le site tourne
 * automatiquement en MODE DÉMO : toutes les pages fonctionnent avec
 * des données fictives en mémoire (aucune BDD requise), pour que tu
 * puisses valider le parcours dès maintenant. Dès que tu colles tes
 * vraies valeurs ici, le site bascule sur Supabase sans rien changer
 * ailleurs dans le code.
 */
window.BEEVERS_CONFIG = {
  SUPABASE_URL: "REPLACE_ME",
  SUPABASE_ANON_KEY: "REPLACE_ME",

  // Google/Apple : à activer côté dashboard Supabase > Authentication > Providers.
  // Rien à configurer ici, le client appelle simplement supabase.auth.signInWithOAuth().

  // Noms des buckets de stockage attendus (cf. sql/schema.sql)
  STORAGE_BUCKET_AVATARS: "avatars",
  STORAGE_BUCKET_PHOTOS: "profile-photos",
  STORAGE_BUCKET_ID_DOCS: "identity-documents",

  FREE_SWIPES_PER_DAY: 5,
  PREMIUM_PRICE_EUR: 9.99,
};

window.BEEVERS_CONFIG.isConfigured =
  window.BEEVERS_CONFIG.SUPABASE_URL !== "REPLACE_ME" &&
  window.BEEVERS_CONFIG.SUPABASE_ANON_KEY !== "REPLACE_ME";
