// ─── MOTSA Auth v4 — inscription sécurisée (code + admin + invitation) ──────
// Changement majeur vs v3 : il n'existe plus de liste déroulante publique
// permettant à n'importe quel e-mail de se déclarer d'un établissement
// existant. Un compte émetteur ne peut naître que de deux façons :
//   1. Rédemption d'un code fondateur (envoyé manuellement par MOTSA après
//      vérification de la candidature) → devient administrateur de l'organisation.
//   2. Rédemption d'une invitation créée par un administrateur de l'organisation,
//      verrouillée sur une adresse e-mail précise → devient membre.
// Voir NOTES-INSCRIPTION-SECURISEE.md pour le schéma Supabase correspondant.

const SUPABASE_URL      = 'https://cggtyaklofxywlmaatam.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnZ3R5YWtsb2Z4eXdsbWFhdGFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxODM3NzAsImV4cCI6MjA5NDc1OTc3MH0.4ZsRWxn63hSheLCNfEvJXa2xRBkbJM2XJL8ownBiyg8';

// ── Supabase client ──────────────────────────────────────────
let _sb = null;
function sb() {
  if (!_sb) _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _sb;
}

// ── Active profile stored in sessionStorage ──────────────────
// Key: 'motsa_active_type' → 'issuer' | 'verifier'
// This persists for the browser tab session only.

function getActiveType() {
  return sessionStorage.getItem('motsa_active_type');
}
function setActiveType(type) {
  sessionStorage.setItem('motsa_active_type', type);
}
function clearActiveType() {
  sessionStorage.removeItem('motsa_active_type');
}

// ── Session ──────────────────────────────────────────────────

async function getSession() {
  const { data } = await sb().auth.getSession();
  return data.session;
}

// Returns the profile matching the active account type
async function getProfile() {
  const session = await getSession();
  if (!session) return null;

  const activeType = getActiveType();

  const query = sb()
    .from('profiles')
    .select('*, organizations(name, slug, account_type, org_type, status)')
    .eq('id', session.user.id);

  // If we have an active type set, fetch that specific profile
  if (activeType) {
    query.eq('account_type', activeType);
  }

  const { data } = await query.limit(1).single();
  return data;
}

// Returns ALL profiles for the current user
async function getAllProfiles() {
  const session = await getSession();
  if (!session) return [];
  const { data } = await sb()
    .from('profiles')
    .select('*, organizations(name, slug)')
    .eq('id', session.user.id);
  return data || [];
}

// ── Guards ───────────────────────────────────────────────────

async function requireAuth(expectedType) {
  const session = await getSession();
  if (!session) {
    window.location.href = expectedType === 'issuer'
      ? 'login-issuer.html'
      : 'login-verifier.html';
    return null;
  }

  // Check user has a profile of the expected type
  const { data: profile } = await sb()
    .from('profiles')
    .select('*, organizations(name, slug, account_type, org_type, status)')
    .eq('id', session.user.id)
    .eq('account_type', expectedType)
    .single();

  if (!profile) {
    // User is logged in but has no profile of this type
    // → redirect to their own portal
    const activeType = getActiveType();
    window.location.href = activeType === 'issuer'
      ? 'certif.html'
      : activeType === 'verifier'
      ? 'verify.html'
      : 'index.html';
    return null;
  }

  // Set active type for this session
  setActiveType(expectedType);
  return profile;
}

// Called on login pages only
async function redirectIfLoggedIn(expectedType) {
  const page = window.location.pathname.split('/').pop();
  if (!page || page === '' || page === 'index.html') return;

  const session = await getSession();
  if (!session) return;

  // Check if user has a profile of the expected type
  const { data: profile } = await sb()
    .from('profiles')
    .select('id, account_type')
    .eq('id', session.user.id)
    .eq('account_type', expectedType)
    .maybeSingle();

  if (profile) {
    // Has a matching profile → redirect to their portal
    setActiveType(expectedType);
    window.location.href = expectedType === 'issuer'
      ? 'certif.html'
      : 'verify.html';
  }
  // If no matching profile → stay on login page, let them register or use other account
}

// ── Sign up (verifier only — libre-service, sans enjeu d'usurpation) ───────
// Pour l'émetteur, il n'existe plus de création de compte libre : voir
// redeemAccessCode() plus bas. signUp() reste utilisé par login-verifier.html,
// où il n'y a pas de notion d'organisation à usurper de la même façon.

async function signUp({ email, password, fullName, organizationId, accountType }) {
  const session = await getSession();

  // Case 1: already logged in → just add a second profile
  if (session) {
    const { data, error } = await sb().rpc('add_profile_type', {
      p_account_type: accountType,
      p_org_id:       organizationId,
      p_full_name:    fullName,
    });
    if (error) return { data: null, error };
    if (data?.error) return { data: null, error: { message: data.error } };
    setActiveType(accountType);
    return { data, error: null };
  }

  // Case 2: not logged in → create new auth account
  const { data, error } = await sb().auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name:       fullName,
        organization_id: organizationId,
        account_type:    accountType,
        role:            'member',
      }
    }
  });
  return { data, error };
}

// ── Inscription émetteur — candidature d'établissement ─────────────────────
// Formulaire public, sans authentification requise. Ne crée ni compte ni
// organisation : dépose une candidature que MOTSA valide manuellement
// (SIRET, n° Qualiopi/NDA, domaine officiel) avant d'émettre un code fondateur.

async function requestOrgOnboarding({ orgName, siret, qualiopiOrNda, officialDomain, contactName, contactEmail, message }) {
  const { data, error } = await sb()
    .from('organization_requests')
    .insert({
      org_name:          orgName,
      siret:             siret || null,
      qualiopi_or_nda:   qualiopiOrNda || null,
      official_domain:   officialDomain,
      contact_name:      contactName,
      contact_email:     contactEmail,
      message:           message || null,
    })
    .select()
    .single();
  return { data, error };
}

// ── Inscription émetteur — rédemption d'un code (fondateur ou invitation) ──
// email/password créent le compte d'authentification ; le code détermine
// ensuite, côté serveur (fonction Postgres redeem_access_code), à quelle
// organisation il est rattaché et avec quel rôle. Le client ne choisit
// jamais l'organisation lui-même.

const PENDING_CODE_KEY = 'motsa_pending_access_code';
const PENDING_NAME_KEY = 'motsa_pending_full_name';

async function redeemAccessCode({ code, fullName, email, password }) {
  // Étape 1 : créer le compte d'authentification (ou se connecter s'il existe déjà)
  let session = await getSession();

  if (!session) {
    const { data, error } = await sb().auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } }, // pas d'organization_id/account_type ici
    });
    if (error) return { data: null, error };

    session = data.session;

    if (!session) {
      // Confirmation e-mail activée sur le projet Supabase : pas de session
      // immédiate. On mémorise le code pour le rejouer à la première connexion.
      sessionStorage.setItem(PENDING_CODE_KEY, code);
      sessionStorage.setItem(PENDING_NAME_KEY, fullName);
      return { data: { pending: true }, error: null };
    }
  }

  // Étape 2 : rédemption côté serveur
  return await _callRedeem(code, fullName);
}

async function _callRedeem(code, fullName) {
  const { data, error } = await sb().rpc('redeem_access_code', {
    p_code:      code,
    p_full_name: fullName,
  });
  if (error) return { data: null, error };
  if (data?.error) return { data: null, error: { message: traduireErreurCode(data.error) } };
  setActiveType('issuer');
  return { data, error: null };
}

// À appeler après une connexion réussie (doLogin) : si un code était en
// attente de confirmation d'e-mail, on tente sa rédemption maintenant.
async function redeemPendingCodeIfAny() {
  const code = sessionStorage.getItem(PENDING_CODE_KEY);
  if (!code) return null;
  const fullName = sessionStorage.getItem(PENDING_NAME_KEY) || '';
  const result = await _callRedeem(code, fullName);
  if (!result.error) {
    sessionStorage.removeItem(PENDING_CODE_KEY);
    sessionStorage.removeItem(PENDING_NAME_KEY);
  }
  return result;
}

function traduireErreurCode(code) {
  const map = {
    not_authenticated:      'Session expirée, reconnectez-vous puis réessayez.',
    invalid_or_expired_code:'Ce code est invalide ou a expiré. Vérifiez-le ou contactez la personne qui vous l\'a transmis.',
    email_mismatch:         'Ce code est réservé à une autre adresse e-mail.',
  };
  return map[code] || 'Impossible de valider ce code.';
}

// ── Invitations — un administrateur invite un collègue ─────────────────────
// Réservé aux comptes émetteur avec role = 'admin' (vérifié côté serveur).

async function createInvitation(email) {
  const { data, error } = await sb().rpc('create_invitation', { p_email: email });
  if (error) return { code: null, error };
  if (data?.error) return { code: null, error: { message: 'Vous devez être administrateur de votre organisation pour inviter un collègue.' } };
  return { code: data.code, error: null };
}

// ── Sign in ──────────────────────────────────────────────────

// Signs in and activates the profile for the given portal type.
// Returns { profile, error }
async function signInAs(email, password, accountType) {
  // Step 1: authenticate
  const { data: authData, error: authError } = await sb().auth.signInWithPassword({ email, password });
  if (authError) return { profile: null, error: authError };

  // Si un code d'inscription était en attente de confirmation e-mail, on le
  // rejoue maintenant que la session est active.
  await redeemPendingCodeIfAny();

  // Step 2: check user has a profile of this type
  const { data: profile, error: profileError } = await sb()
    .from('profiles')
    .select('*, organizations(name, slug, account_type, org_type, status)')
    .eq('id', authData.user.id)
    .eq('account_type', accountType)
    .single();

  if (profileError || !profile) {
    // Sign out locally — user is authed but wrong type for this portal
    await sb().auth.signOut({ scope: 'local' });
    clearActiveType();
    return {
      profile: null,
      error: {
        message: accountType === 'verifier'
          ? 'No Verifier profile found for this email. Use the Issuer portal or create a Verifier account.'
          : 'Aucun compte émetteur pour cet e-mail. Si vous venez de recevoir un code, utilisez l\'onglet « J\'ai un code ».'
      }
    };
  }

  // Step 3: set active type
  setActiveType(accountType);
  return { profile, error: null };
}

// ── Sign out ─────────────────────────────────────────────────

async function signOut() {
  clearActiveType();
  await sb().auth.signOut();
  window.location.href = 'index.html';
}

// ── Nav user chip ────────────────────────────────────────────

async function mountUserChip() {
  const profile = await getProfile();
  if (!profile) return;

  const container = document.getElementById('nav-user');
  if (!container) return;

  const initials = (profile.full_name || profile.email || 'U')
    .split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  const orgName   = profile.organizations?.name || '—';
  const type      = profile.account_type;
  const typeLabel = type === 'issuer' ? 'Émetteur' : 'Vérificateur';
  const roleLabel = profile.role === 'admin' ? ' · Administrateur' : '';

  // Check if user also has the other profile type (to show switcher)
  const allProfiles = await getAllProfiles();
  const hasOtherType = allProfiles.length > 1;
  const otherType = type === 'issuer' ? 'verifier' : 'issuer';
  const otherLabel = type === 'issuer' ? 'Basculer en vérificateur' : 'Basculer en émetteur';

  const switcherHtml = hasOtherType
    ? `<a onclick="switchProfile('${otherType}')" style="color:var(--blue)">⇄ ${otherLabel}</a>`
    : `<a href="${type === 'issuer' ? 'login-verifier.html' : 'login-issuer.html'}" style="color:var(--muted)">+ Ajouter un profil ${otherType === 'issuer' ? 'émetteur' : 'vérificateur'}</a>`;

  container.innerHTML = `
    <div class="user-chip">
      <div class="user-avatar ${type}">${initials}</div>
      <span>${profile.full_name || profile.email}</span>
      <div class="user-dropdown">
        <div class="user-dropdown-header">
          <div class="name">${profile.full_name || '—'}</div>
          <div class="email">${profile.email || ''}</div>
          <span class="type-pill ${type}">${typeLabel}${roleLabel}</span>
        </div>
        <div style="padding:6px">
          <a href="#" style="font-size:12px;color:var(--muted);padding:8px 10px;display:block">${orgName}</a>
          ${switcherHtml}
          <a onclick="signOut()" class="logout">Se déconnecter</a>
        </div>
      </div>
    </div>`;
}

// Switch between issuer/verifier profile without re-authenticating
async function switchProfile(targetType) {
  const session = await getSession();
  if (!session) return;

  const { data: profile } = await sb()
    .from('profiles')
    .select('id, account_type')
    .eq('id', session.user.id)
    .eq('account_type', targetType)
    .single();

  if (!profile) {
    window.location.href = targetType === 'issuer'
      ? 'login-issuer.html'
      : 'login-verifier.html';
    return;
  }

  setActiveType(targetType);
  window.location.href = targetType === 'issuer' ? 'certif.html' : 'verify.html';
}

// ── Password reset ──────────────────────────────────────────

async function sendPasswordReset(email, redirectPage) {
  const redirectTo = window.location.origin + '/' + (redirectPage || 'login-issuer.html');
  const { error } = await sb().auth.resetPasswordForEmail(email, { redirectTo });
  return { error };
}

// ── Fetch helpers ─────────────────────────────────────────────
// fetchOrganizations n'est plus utilisé par l'inscription publique (plus de
// liste déroulante ouverte) — conservé pour un futur panneau d'administration
// interne, où l'accès sera lui-même réservé à l'équipe MOTSA.

async function fetchOrganizations(accountType) {
  const { data, error } = await sb()
    .from('organizations')
    .select('id, name, slug')
    .eq('account_type', accountType)
    .order('name');
  return { data: data || [], error };
}

// ── Certificate operations (issuer only) ──────────────────────

async function createCertificate({ issuerOrgId, createdBy, holderName, holderEmail,
                                    documentType, documentHash, issuedAt, expiresAt, metadata }) {
  // 8 octets aléatoires = 16 caractères hex : espace de clés non énumérable
  const code = 'motsa_' + [...crypto.getRandomValues(new Uint8Array(8))]
    .map(x => x.toString(16).padStart(2,'0')).join('').toUpperCase();

  const { data, error } = await sb()
    .from('certificates')
    .insert({
      certificate_code: code,
      issuer_org_id:    issuerOrgId,
      created_by:       createdBy,
      holder_name:      holderName,
      holder_email:     holderEmail || null,
      document_type:    documentType,
      document_hash:    documentHash,
      hash_algorithm:   'sha256',
      issued_at:        issuedAt,
      expires_at:       expiresAt || null,
      metadata:         metadata  || null,
    })
    .select()
    .single();

  return { data, error, code };
}

async function fetchMyCertificates() {
  const { data, error } = await sb()
    .from('certificates')
    .select('*, organizations(name), vault_documents(id, retention_until, fse_cofinanced)')
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

// ── Coffre-fort de preuves Qualiopi (formule optionnelle) ──────────────────
// Le fichier n'est transmis à Supabase Storage que si l'émetteur coche
// explicitement « Conserver dans le coffre-fort » à la certification.
// La durée de rétention (5 ou 10 ans) est calculée côté serveur par un
// trigger Postgres — jamais fournie par le client. Voir NOTES-COFFRE-FORT.md.

const VAULT_BUCKET = 'vault-documents';

async function uploadToVault({ file, certificateId, organizationId, fseCofinanced }) {
  const path = `${organizationId}/${certificateId}.pdf`;

  const { error: uploadError } = await sb()
    .storage
    .from(VAULT_BUCKET)
    .upload(path, file, { contentType: 'application/pdf', upsert: false });

  if (uploadError) return { data: null, error: uploadError };

  const { data, error } = await sb()
    .from('vault_documents')
    .insert({
      certificate_id:  certificateId,
      organization_id: organizationId,
      storage_path:    path,
      fse_cofinanced:  !!fseCofinanced,
    })
    .select()
    .single();

  return { data, error };
}

async function fetchVaultDocuments() {
  const { data, error } = await sb()
    .from('vault_documents')
    .select('*, certificates(certificate_code, holder_name, document_type, issued_at)')
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

// URL signée à courte durée de vie — jamais d'URL publique directe sur ce bucket.
async function getVaultDocumentUrl(storagePath, expiresInSeconds = 120) {
  const { data, error } = await sb()
    .storage
    .from(VAULT_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  return { url: data?.signedUrl || null, error };
}

// ── Verification operations (verifier only) ───────────────────

async function verifyCertificate({ verifierOrgId, verifiedBy, certificateCode, documentHash }) {
  // Strategy: look up by hash first (no ID needed), fall back to certificate_code if provided.
  let cert = null;

  // 1. Try to find by document hash directly — the primary verification method
  if (documentHash) {
    const { data } = await sb()
      .from('certificates')
      .select('id, certificate_code, issuer_org_id, holder_name, holder_email, document_type, document_hash, hash_algorithm, issued_at, expires_at, status, created_at, organizations(name)')
      .eq('document_hash', documentHash)
      .eq('status', 'active')
      .maybeSingle();
    cert = data;
  }

  // 2. If not found by hash and a code was provided, try by certificate_code
  if (!cert && certificateCode) {
    const { data } = await sb()
      .from('certificates')
      .select('id, certificate_code, issuer_org_id, holder_name, holder_email, document_type, document_hash, hash_algorithm, issued_at, expires_at, status, created_at, organizations(name)')
      .eq('certificate_code', certificateCode)
      .maybeSingle();
    cert = data;
  }

  let result, certId = null, issuerName = null, holderName = null, docType = null;

  if (!cert) {
    result = 'unknown';
  } else if (cert.status === 'revoked') {
    result = 'revoked'; certId = cert.id;
    issuerName = cert.organizations?.name; holderName = cert.holder_name; docType = cert.document_type;
  } else if (cert.status === 'expired' || (cert.expires_at && new Date(cert.expires_at) < new Date())) {
    result = 'expired'; certId = cert.id;
    issuerName = cert.organizations?.name; holderName = cert.holder_name; docType = cert.document_type;
  } else if (cert.document_hash === documentHash) {
    // Hash matched directly → verified
    result = 'verified'; certId = cert.id;
    issuerName = cert.organizations?.name; holderName = cert.holder_name; docType = cert.document_type;
  } else {
    // Found by certificate_code but hash doesn't match → modified
    result = 'modified'; certId = cert.id;
    issuerName = cert.organizations?.name; holderName = cert.holder_name; docType = cert.document_type;
  }

  // Journalisation : uniquement pour les vérificateurs connectés.
  // La vérification publique (sans compte) ne bloque jamais sur l'audit log.
  if (verifiedBy) {
    try {
      await sb().from('verification_events').insert({
        certificate_id:             certId,
        verifier_org_id:            verifierOrgId,
        verified_by:                verifiedBy,
        submitted_certificate_code: certificateCode || cert?.certificate_code || null,
        submitted_hash:             documentHash,
        result,
        issuer_name:   issuerName,
        holder_name:   holderName,
        document_type: docType,
        user_agent:    navigator.userAgent,
      });
    } catch (e) {
      console.warn('Audit log non enregistré :', e?.message);
    }
  }

  return { result, cert: cert || null };
}

async function fetchMyVerifications() {
  const { data, error } = await sb()
    .from('verification_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  return { data: data || [], error };
}

// ── SHA-256 helper ────────────────────────────────────────────

async function sha256(file) {
  const buf    = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2,'0')).join('');
}
