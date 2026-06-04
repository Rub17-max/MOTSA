// ─── MOTSA Auth — shared across all pages ───────────────────
// Replace SUPABASE_URL and SUPABASE_ANON_KEY with your project values.
// Supabase Dashboard → Settings → API

const SUPABASE_URL      = 'https://cggtyaklofxywlmaatam.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnZ3R5YWtsb2Z4eXdsbWFhdGFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxODM3NzAsImV4cCI6MjA5NDc1OTc3MH0.4ZsRWxn63hSheLCNfEvJXa2xRBkbJM2XJL8ownBiyg8';

// ── Supabase client (CDN UMD) ──
// Loaded via <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js">
// Available as window.supabase after that script loads.
let _sb = null;
function sb() {
  if (!_sb) _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _sb;
}

// ── Session helpers ──────────────────────────────────────────

async function getSession() {
  const { data } = await sb().auth.getSession();
  return data.session;
}

async function getProfile() {
  const session = await getSession();
  if (!session) return null;
  const { data } = await sb()
    .from('profiles')
    .select('*, organizations(name, slug, account_type, org_type)')
    .eq('id', session.user.id)
    .single();
  return data;
}

// ── Guards ───────────────────────────────────────────────────

// Redirect unauthenticated users. Call at top of protected pages.
async function requireAuth(expectedType) {
  const profile = await getProfile();
  if (!profile) {
    // Not logged in → redirect to appropriate login
    window.location.href = expectedType === 'issuer'
      ? 'login-issuer.html'
      : 'login-verifier.html';
    return null;
  }
  if (profile.account_type !== expectedType) {
    // Wrong account type → redirect to correct portal
    window.location.href = profile.account_type === 'issuer'
      ? 'certif.html'
      : 'verify.html';
    return null;
  }
  return profile;
}

// Redirect already-logged-in users away from login pages.
// Never redirects from index.html — user must choose their portal explicitly.
async function redirectIfLoggedIn() {
  const page = window.location.pathname.split('/').pop();
  if (!page || page === '' || page === 'index.html') return;
  const profile = await getProfile();
  if (!profile) return;
  window.location.href = profile.account_type === 'issuer'
    ? 'certif.html'
    : 'verify.html';
}

// ── Sign up ──────────────────────────────────────────────────

async function signUp({ email, password, fullName, organizationId, accountType }) {
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

// ── Sign in ──────────────────────────────────────────────────

async function signIn({ email, password }) {
  const { data, error } = await sb().auth.signInWithPassword({ email, password });
  return { data, error };
}

// ── Sign out ─────────────────────────────────────────────────

async function signOut() {
  await sb().auth.signOut();
  // Redirect to home after logout
  window.location.href = 'index.html';
}

// ── Nav user chip ────────────────────────────────────────────
// Call mountUserChip() on any protected page to show the user menu.

async function mountUserChip() {
  const profile = await getProfile();
  if (!profile) return;

  const container = document.getElementById('nav-user');
  if (!container) return;

  const initials = (profile.full_name || profile.email || 'U')
    .split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  const orgName = profile.organizations?.name || '—';
  const type    = profile.account_type; // 'issuer' | 'verifier'
  const typeLabel = type === 'issuer' ? 'Issuer' : 'Verifier';

  container.innerHTML = `
    <div class="user-chip">
      <div class="user-avatar ${type}">${initials}</div>
      <span>${profile.full_name || profile.email}</span>
      <div class="user-dropdown">
        <div class="user-dropdown-header">
          <div class="name">${profile.full_name || '—'}</div>
          <div class="email">${profile.email || ''}</div>
          <span class="type-pill ${type}">${typeLabel}</span>
        </div>
        <div style="padding:6px">
          <a href="#" style="font-size:12px;color:var(--muted);padding:8px 10px">${orgName}</a>
          <a onclick="signOut()" class="logout">Sign out</a>
        </div>
      </div>
    </div>`;
}

// ── Fetch helpers ─────────────────────────────────────────────

// Fetch organisations filtered by account type (for signup dropdown)
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
  const code = 'motsa_' + [...crypto.getRandomValues(new Uint8Array(3))]
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
    .select('*, organizations(name)')
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

// ── Verification operations (verifier only) ───────────────────

async function verifyCertificate({ verifierOrgId, verifiedBy, certificateCode, documentHash, ipAddress, userAgent }) {
  // 1. Look up the certificate
  const { data: cert, error: fetchErr } = await sb()
    .from('certificates')
    .select('*, organizations(name)')
    .eq('certificate_code', certificateCode)
    .single();

  let result, certId = null, issuerName = null, holderName = null, docType = null;

  if (fetchErr || !cert) {
    result = 'unknown';
  } else if (cert.status === 'revoked') {
    result = 'revoked'; certId = cert.id;
    issuerName = cert.organizations?.name; holderName = cert.holder_name; docType = cert.document_type;
  } else if (cert.status === 'expired' || (cert.expires_at && new Date(cert.expires_at) < new Date())) {
    result = 'expired'; certId = cert.id;
    issuerName = cert.organizations?.name; holderName = cert.holder_name; docType = cert.document_type;
  } else if (cert.document_hash === documentHash) {
    result = 'verified'; certId = cert.id;
    issuerName = cert.organizations?.name; holderName = cert.holder_name; docType = cert.document_type;
  } else {
    result = 'modified'; certId = cert.id;
    issuerName = cert.organizations?.name; holderName = cert.holder_name; docType = cert.document_type;
  }

  // 2. Log the event
  await sb().from('verification_events').insert({
    certificate_id:             certId,
    verifier_org_id:            verifierOrgId,
    verified_by:                verifiedBy,
    submitted_certificate_code: certificateCode,
    submitted_hash:             documentHash,
    result,
    issuer_name:  issuerName,
    holder_name:  holderName,
    document_type: docType,
    ip_address:   ipAddress  || null,
    user_agent:   userAgent  || navigator.userAgent,
  });

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