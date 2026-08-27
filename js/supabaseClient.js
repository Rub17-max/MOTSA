/**
 * BEEVERS — Client Supabase + couche d'accès aux données.
 * En mode démo (config.js non renseigné), chaque fonction retombe sur
 * des données fictives en mémoire pour permettre de tester le parcours
 * complet sans base de données. Le schéma attendu est décrit dans
 * /sql/schema.sql — chaque appel Supabase ci-dessous cible ce schéma.
 */
(function () {
  const cfg = window.BEEVERS_CONFIG;
  let client = null;

  if (cfg.isConfigured && window.supabase) {
    client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  }

  window.BeeversAPI = {
    isDemo: !cfg.isConfigured,
    client,

    // ---------------- AUTH ----------------
    async signInWithOAuth(provider) {
      if (client) {
        return client.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin + '/profil.html' } });
      }
      window.BeeversDemo.signIn({ provider });
      window.location.href = 'profil.html';
    },
    async signUpWithEmail({ email, password, birthdate, prenom }) {
      const age = window.BeeversUtils.ageFromBirthdate(birthdate);
      if (age < 18) throw new Error('Il faut avoir au moins 18 ans pour créer un compte Beevers.');
      if (client) {
        const { data, error } = await client.auth.signUp({ email, password, options: { data: { prenom, birthdate } } });
        if (error) throw error;
        return data;
      }
      window.BeeversDemo.signIn({ email, prenom });
      return { demo: true };
    },
    async signInWithEmail({ email, password }) {
      if (client) {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        return data;
      }
      window.BeeversDemo.signIn({ email });
      return { demo: true };
    },
    async signOut() {
      if (client) await client.auth.signOut();
      window.BeeversDemo.signOut();
    },
    async getCurrentUser() {
      if (client) {
        const { data } = await client.auth.getUser();
        return data.user;
      }
      return window.BeeversDemo.currentUser();
    },

    // ---------------- PROFILE ----------------
    async getMyProfile() {
      if (client) {
        const user = await this.getCurrentUser();
        const { data, error } = await client.from('profiles').select('*').eq('id', user.id).single();
        if (error) throw error;
        return data;
      }
      return window.BeeversDemo.getMyProfile();
    },
    async upsertMyProfile(fields) {
      if (client) {
        const user = await this.getCurrentUser();
        const { data, error } = await client.from('profiles').upsert({ id: user.id, ...fields }).select().single();
        if (error) throw error;
        return data;
      }
      return window.BeeversDemo.upsertMyProfile(fields);
    },
    async uploadAvatar(file) {
      if (client) {
        const user = await this.getCurrentUser();
        const path = `${user.id}/avatar-${Date.now()}.png`;
        const { error } = await client.storage.from(cfg.STORAGE_BUCKET_AVATARS).upload(path, file);
        if (error) throw error;
        return client.storage.from(cfg.STORAGE_BUCKET_AVATARS).getPublicUrl(path).data.publicUrl;
      }
      return URL.createObjectURL(file);
    },
    async uploadProfilePhoto(file) {
      if (client) {
        const user = await this.getCurrentUser();
        const path = `${user.id}/photo-${Date.now()}.png`;
        const { error } = await client.storage.from(cfg.STORAGE_BUCKET_PHOTOS).upload(path, file);
        if (error) throw error;
        return client.storage.from(cfg.STORAGE_BUCKET_PHOTOS).getPublicUrl(path).data.publicUrl;
      }
      return URL.createObjectURL(file);
    },

    // ---------------- SWIPE / MATCHING ----------------
    async getSwipeQueue() {
      if (client) {
        const { data, error } = await client.rpc('get_swipe_queue');
        if (error) throw error;
        return data;
      }
      return window.BeeversDemo.getSwipeQueue();
    },
    async getSwipesLeftToday() {
      if (client) {
        const { data, error } = await client.rpc('get_swipes_left_today');
        if (error) throw error;
        return data;
      }
      return window.BeeversDemo.getSwipesLeftToday();
    },
    async sendSwipe(targetId, direction) {
      // direction: 'like' | 'pass'
      if (client) {
        const { data, error } = await client.rpc('send_swipe', { target_id: targetId, direction });
        if (error) throw error;
        return data; // { matched: boolean, match_id }
      }
      return window.BeeversDemo.sendSwipe(targetId, direction);
    },

    // ---------------- TEAM ----------------
    async getMyTeam() {
      if (client) {
        const { data, error } = await client.rpc('get_my_team');
        if (error) throw error;
        return data;
      }
      return window.BeeversDemo.getMyTeam();
    },
    async inviteToTeam(userId) {
      if (client) {
        const { data, error } = await client.rpc('invite_to_team', { invitee_id: userId });
        if (error) throw error;
        return data;
      }
      return window.BeeversDemo.inviteToTeam(userId);
    },
    async respondTeamInvite(inviteId, accept) {
      if (client) {
        const { data, error } = await client.rpc('respond_team_invite', { invite_id: inviteId, accept });
        if (error) throw error;
        return data;
      }
      return window.BeeversDemo.respondTeamInvite(inviteId, accept);
    },
    async leaveTeam() {
      if (client) {
        const { error } = await client.rpc('leave_team');
        if (error) throw error;
        return true;
      }
      return window.BeeversDemo.leaveTeam();
    },
    async sendTeamMessage(teamId, content, attachment) {
      if (client) {
        const { error } = await client.from('team_messages').insert({ team_id: teamId, content, attachment_url: attachment || null });
        if (error) throw error;
        return true;
      }
      return window.BeeversDemo.sendTeamMessage(content, attachment);
    },

    // ---------------- CHAT ----------------
    async getConversations() {
      if (client) {
        const { data, error } = await client.rpc('get_conversations');
        if (error) throw error;
        return data;
      }
      return window.BeeversDemo.getConversations();
    },
    async getMessages(conversationId) {
      if (client) {
        const { data, error } = await client.from('messages').select('*').eq('conversation_id', conversationId).order('created_at');
        if (error) throw error;
        return data;
      }
      return window.BeeversDemo.getMessages(conversationId);
    },
    async sendMessage(conversationId, content) {
      if (client) {
        const { error } = await client.from('messages').insert({ conversation_id: conversationId, content });
        if (error) throw error;
        return true;
      }
      return window.BeeversDemo.sendMessage(conversationId, content);
    },
    async searchUserById(publicId) {
      if (client) {
        const { data, error } = await client.from('profiles').select('id, prenom, avatar_url, public_id').eq('public_id', publicId).single();
        if (error) throw error;
        return data;
      }
      return window.BeeversDemo.searchUserById(publicId);
    },
    async sendChatInvite(targetId) {
      if (client) {
        const { data, error } = await client.rpc('send_chat_invite', { target_id: targetId });
        if (error) throw error;
        return data;
      }
      return window.BeeversDemo.sendChatInvite(targetId);
    },
    async respondChatInvite(inviteId, accept) {
      if (client) {
        const { data, error } = await client.rpc('respond_chat_invite', { invite_id: inviteId, accept });
        if (error) throw error;
        return data;
      }
      return window.BeeversDemo.respondChatInvite(inviteId, accept);
    },

    // ---------------- ANNONCES ----------------
    async searchAnnonces(filters) {
      if (client) {
        let q = client.from('annonces').select('*');
        if (filters.ville) q = q.ilike('ville', `%${filters.ville}%`);
        if (filters.budgetMax) q = q.lte('prix', filters.budgetMax);
        if (filters.type) q = q.eq('type_bien', filters.type);
        const { data, error } = await q;
        if (error) throw error;
        return data;
      }
      return window.BeeversDemo.searchAnnonces(filters);
    },
    async getAnnonce(id) {
      if (client) {
        const { data, error } = await client.from('annonces').select('*').eq('id', id).single();
        if (error) throw error;
        return data;
      }
      return window.BeeversDemo.getAnnonce(id);
    },
    async contactAnnonceOwner(annonceId, message) {
      if (client) {
        const { data, error } = await client.rpc('contact_annonce_owner', { annonce_id: annonceId, message });
        if (error) throw error;
        return data;
      }
      return window.BeeversDemo.contactAnnonceOwner(annonceId, message);
    },
    async sendAnnonceToTeam(annonceId) {
      if (client) {
        const { error } = await client.rpc('send_annonce_to_team', { annonce_id: annonceId });
        if (error) throw error;
        return true;
      }
      return window.BeeversDemo.sendAnnonceToTeam(annonceId);
    },

    // ---------------- COMPTE ----------------
    async setVisibility(visible) {
      if (client) {
        const user = await this.getCurrentUser();
        const { error } = await client.from('profiles').update({ is_visible: visible }).eq('id', user.id);
        if (error) throw error;
        return true;
      }
      return window.BeeversDemo.setVisibility(visible);
    },
    async startPremiumCheckout() {
      // En prod : appelle une Supabase Edge Function qui crée une session Stripe Checkout
      // et renvoie son URL. Ici, en démo, on simule le retour de paiement.
      if (client) {
        const { data, error } = await client.functions.invoke('create-stripe-checkout');
        if (error) throw error;
        window.location.href = data.url;
        return;
      }
      return window.BeeversDemo.setPremium(true);
    },
    async cancelPremium() {
      if (client) {
        const { error } = await client.functions.invoke('cancel-stripe-subscription');
        if (error) throw error;
        return true;
      }
      return window.BeeversDemo.setPremium(false);
    },
    async deleteAccount() {
      if (client) {
        const { error } = await client.rpc('request_account_deletion');
        if (error) throw error;
        return true;
      }
      return window.BeeversDemo.deleteAccount();
    },
    async exportMyData() {
      if (client) {
        const { data, error } = await client.rpc('export_my_data');
        if (error) throw error;
        return data;
      }
      return window.BeeversDemo.exportMyData();
    },
  };
})();
