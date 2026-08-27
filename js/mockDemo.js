/**
 * BEEVERS — Mode démo.
 * Simule le comportement attendu de Supabase (cf. sql/schema.sql) avec des
 * données en mémoire + localStorage, pour tester le parcours complet sans
 * base de données. Remplacé automatiquement par de vrais appels Supabase
 * dès que js/config.js contient une URL et une clé valides.
 */
(function () {
  const LS_KEY = 'beevers_demo_state_v1';

  const seedCandidates = [
    { id: 'u-lea', prenom: 'Léa', age: 21, ville: 'Nice', avatar: '🦊', regime: 'Végétarienne', proprete: 'Très ordonnée', loisirs: ['Cinéma', 'Yoga', 'Cuisine'], certifie: true, bio: "Étudiante en droit, cherche coloc calme proche du tram." },
    { id: 'u-nassim', prenom: 'Nassim', age: 23, ville: 'Nice', avatar: '🐼', regime: 'Halal', proprete: 'Plutôt ordonné', loisirs: ['Football', 'Jeux vidéo', 'Musique'], certifie: true, bio: "Master info, plutôt couche-tard, aime recevoir des amis." },
    { id: 'u-chloe', prenom: 'Chloé', age: 20, ville: 'Nice', avatar: '🐨', regime: 'Végane', proprete: 'Décontractée', loisirs: ['Lecture', 'Sorties', 'Voyages'], certifie: false, bio: "Deuxième année de fac, cherche une coloc conviviale près de la fac." },
    { id: 'u-tom', prenom: 'Tom', age: 22, ville: 'Nice', avatar: '🦁', regime: 'Omnivore', proprete: 'Plutôt ordonné', loisirs: ['Surf', 'Musique', 'Photo'], certifie: true, bio: "École de commerce, sportif, télétravail 2 jours/semaine." },
    { id: 'u-ines', prenom: 'Inès', age: 24, ville: 'Nice', avatar: '🦋', regime: 'Sans restriction', proprete: 'Très ordonnée', loisirs: ['Cuisine', 'Cinéma', 'Lecture'], certifie: true, bio: "Jeune active en pharmacie, calme, cherche coloc sérieuse." },
    { id: 'u-hugo', prenom: 'Hugo', age: 19, ville: 'Nice', avatar: '🐺', regime: 'Omnivore', proprete: 'Décontracté', loisirs: ['Jeux vidéo', 'Musique', 'Sorties'], certifie: false, bio: "Première année, sociable, cherche une coloc étudiante fun." },
  ];

  const seedAnnonces = [
    { id: 'a1', titre: 'Chambre lumineuse proche Fac de Lettres', ville: 'Nice', prix: 520, surface: 14, type_bien: 'Chambre en coloc', dispo: '01/09/2026', annonceur: 'Agence Riviera Immo', partenaire: true, description: "Belle chambre meublée dans coloc de 3, quartier Fabron, proche tram et fac. Charges comprises, wifi fibre." },
    { id: 'a2', titre: 'Studio rénové centre-ville', ville: 'Nice', prix: 690, surface: 22, type_bien: 'Studio', dispo: 'Immédiate', annonceur: 'Particulier — Mme Aubert', partenaire: false, description: "Studio entièrement rénové, cuisine équipée, à 5 min à pied de la Promenade des Anglais." },
    { id: 'a3', titre: 'Coloc à créer — grand T4', ville: 'Nice', prix: 480, surface: 18, type_bien: 'Coloc à créer', dispo: '15/09/2026', annonceur: 'Particulier — M. Rossi', partenaire: false, description: "Grand T4 vide à partager à 3, quartier Libération, balcon, cave, parking en option." },
    { id: 'a4', titre: 'Chambre meublée quartier universitaire', ville: 'Nice', prix: 550, surface: 12, type_bien: 'Chambre en coloc', dispo: '01/10/2026', annonceur: 'Agence Côte d\'Azur Habitat', partenaire: true, description: "Chambre dans coloc de 2, calme, salle de bain privative, proche UCA Valrose." },
  ];

  function load() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || defaultState(); }
    catch (e) { return defaultState(); }
  }
  function save(state) { localStorage.setItem(LS_KEY, JSON.stringify(state)); }

  function defaultState() {
    return {
      user: null, // set on sign in
      profile: null,
      isPremium: false,
      swipes: { date: window.BeeversUtils.todayKey(), used: 0 },
      remainingCandidates: seedCandidates.map(c => c.id),
      matches: [], // {id, candidateId, createdAt}
      team: null, // { id, members:[{id,prenom,avatar}], pendingInvite:{id,prenom} }
      conversations: [], // {id, withId, withName, withAvatar, messages:[{from,text,ts}], kind:'match'|'id'|'annonce'}
      chatInvitesIncoming: [], // {id, fromId, fromName}
      sentAnnonceCards: {},
    };
  }

  let state = load();

  function persist() { save(state); }

  function candidateById(id) { return seedCandidates.find(c => c.id === id); }

  window.BeeversDemo = {
    signIn({ prenom }) {
      state.user = { id: 'demo-user', email: 'demo@beevers.app' };
      if (!state.profile) {
        state.profile = {
          id: 'demo-user', prenom: prenom || 'Toi', public_id: 'BVR-' + Math.random().toString(36).slice(2, 7).toUpperCase(),
          complete: false, avatar: '🐝', photo: null,
        };
      }
      persist();
    },
    signOut() { /* keep profile data for convenience in demo */ },
    currentUser() { return state.user; },

    getMyProfile() { return state.profile; },
    upsertMyProfile(fields) {
      state.profile = { ...(state.profile || {}), ...fields };
      persist();
      return state.profile;
    },

    getSwipeQueue() {
      const today = window.BeeversUtils.todayKey();
      return state.remainingCandidates.map(candidateById).filter(Boolean);
    },
    getSwipesLeftToday() {
      this._resetIfNewDay();
      if (state.isPremium) return Infinity;
      return Math.max(0, window.BEEVERS_CONFIG.FREE_SWIPES_PER_DAY - state.swipes.used);
    },
    _resetIfNewDay() {
      const today = window.BeeversUtils.todayKey();
      if (state.swipes.date !== today) { state.swipes = { date: today, used: 0 }; persist(); }
    },
    sendSwipe(targetId, direction) {
      this._resetIfNewDay();
      if (!state.isPremium) {
        if (state.swipes.used >= window.BEEVERS_CONFIG.FREE_SWIPES_PER_DAY) {
          throw new Error('Limite quotidienne de swipes atteinte.');
        }
        state.swipes.used++;
      }
      state.remainingCandidates = state.remainingCandidates.filter(id => id !== targetId);
      let matched = false;
      if (direction === 'like') {
        // Demo: profils "certifiés" matchent toujours pour illustrer le parcours
        const c = candidateById(targetId);
        matched = !!(c && c.certifie);
        if (matched) {
          const convId = 'conv-' + targetId;
          state.matches.push({ id: 'match-' + targetId, candidateId: targetId });
          state.conversations.push({
            id: convId, withId: targetId, withName: c.prenom, withAvatar: c.avatar, kind: 'match',
            messages: [{ from: 'them', text: `Salut ${state.profile.prenom} 👋 On a matché, tu cherches une coloc pour quand ?`, ts: Date.now() }],
          });
        }
      }
      persist();
      return { matched, matchId: matched ? 'match-' + targetId : null, candidate: candidateById(targetId) };
    },

    getMyTeam() { return state.team; },
    inviteToTeam(userId) {
      const c = candidateById(userId);
      if (!state.team) {
        state.team = { id: 'team-1', members: [{ id: 'demo-user', prenom: state.profile.prenom, avatar: state.profile.avatar || '🐝' }], pendingInvites: [] };
      }
      state.team.pendingInvites = state.team.pendingInvites || [];
      state.team.pendingInvites.push({ id: 'inv-' + userId, userId, prenom: c.prenom, avatar: c.avatar });
      persist();
      window.BeeversUtils.toast(`Invitation envoyée à ${c.prenom} pour rejoindre ta Team.`);
      // Demo: auto-accept after a short delay to illustrate the flow
      setTimeout(() => {
        this.respondTeamInvite('inv-' + userId, true, true);
      }, 1800);
      return state.team;
    },
    respondTeamInvite(inviteId, accept, _isDemoAutoAccept) {
      if (!state.team) return null;
      const idx = (state.team.pendingInvites || []).findIndex(i => i.id === inviteId);
      if (idx === -1) return state.team;
      const invite = state.team.pendingInvites[idx];
      state.team.pendingInvites.splice(idx, 1);
      if (accept) {
        state.team.members.push({ id: invite.userId, prenom: invite.prenom, avatar: invite.avatar });
        if (_isDemoAutoAccept) window.BeeversUtils.toast(`${invite.prenom} a rejoint ta Team ✅`);
      }
      persist();
      return state.team;
    },
    leaveTeam() {
      state.team = null;
      persist();
      return true;
    },
    sendTeamMessage(content, attachment) {
      if (!state.team) return false;
      state.team.messages = state.team.messages || [];
      state.team.messages.push({ from: 'me', text: content, attachment: attachment || null, ts: Date.now() });
      persist();
      return true;
    },

    getConversations() { return state.conversations; },
    getMessages(conversationId) {
      const c = state.conversations.find(c => c.id === conversationId);
      return c ? c.messages : [];
    },
    sendMessage(conversationId, content) {
      const c = state.conversations.find(c => c.id === conversationId);
      if (!c) return false;
      c.messages.push({ from: 'me', text: content, ts: Date.now() });
      persist();
      return true;
    },
    searchUserById(publicId) {
      // Demo: map any typed ID to a random candidate not already matched
      const pool = seedCandidates.filter(c => !state.matches.find(m => m.candidateId === c.id));
      const c = pool[Math.floor(Math.random() * pool.length)] || seedCandidates[0];
      return { id: c.id, prenom: c.prenom, avatar: c.avatar, public_id: publicId };
    },
    sendChatInvite(targetId) {
      if (!state.isPremium) throw new Error('La recherche par ID est réservée aux comptes Premium.');
      window.BeeversUtils.toast('Invitation à discuter envoyée.');
      // Demo: simulate the other person accepting after a short delay
      const c = candidateById(targetId) || { id: targetId, prenom: 'Utilisateur', avatar: '👤' };
      setTimeout(() => {
        const convId = 'conv-id-' + targetId;
        if (!state.conversations.find(cv => cv.id === convId)) {
          state.conversations.push({
            id: convId, withId: targetId, withName: c.prenom, withAvatar: c.avatar, kind: 'id',
            messages: [{ from: 'them', text: `Salut, j'ai accepté ta demande — dis-moi tout !`, ts: Date.now() }],
          });
          persist();
          window.BeeversUtils.toast(`${c.prenom} a accepté ta demande de discussion.`);
        }
      }, 1600);
      return { inviteId: 'inv-chat-' + targetId };
    },
    respondChatInvite(inviteId, accept) { return true; },

    searchAnnonces(filters) {
      return seedAnnonces.filter(a => {
        if (filters.ville && !a.ville.toLowerCase().includes(filters.ville.toLowerCase())) return false;
        if (filters.budgetMax && a.prix > filters.budgetMax) return false;
        if (filters.type && filters.type !== 'all' && a.type_bien !== filters.type) return false;
        return true;
      });
    },
    getAnnonce(id) { return seedAnnonces.find(a => a.id === id); },
    contactAnnonceOwner(annonceId, message) {
      const a = seedAnnonces.find(x => x.id === annonceId);
      const convId = 'conv-ann-' + annonceId;
      if (!state.conversations.find(c => c.id === convId)) {
        state.conversations.push({
          id: convId, withId: annonceId, withName: a.annonceur, withAvatar: '🏠', kind: 'annonce',
          messages: [{ from: 'me', text: message, ts: Date.now() }, { from: 'them', text: "Bonjour, merci pour votre message, le logement est toujours disponible, quand souhaitez-vous visiter ?", ts: Date.now() + 500 }],
        });
      }
      persist();
      return { conversationId: convId };
    },
    sendAnnonceToTeam(annonceId) {
      if (!state.team) throw new Error('Rejoignez une Team pour partager une annonce.');
      const a = seedAnnonces.find(x => x.id === annonceId);
      state.team.sharedAnnonces = state.team.sharedAnnonces || [];
      state.team.sharedAnnonces.push(a);
      persist();
      return true;
    },

    setVisibility(v) { state.profile.is_visible = v; persist(); },
    setPremium(v) { state.isPremium = v; persist(); return true; },
    isPremium() { return state.isPremium; },
    deleteAccount() { localStorage.removeItem(LS_KEY); return true; },
    exportMyData() { return JSON.stringify(state, null, 2); },

    _state() { return state; }, // debug helper
  };
})();
