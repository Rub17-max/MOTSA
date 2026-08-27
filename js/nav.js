window.BeeversNav = {
  async init(activePage) {
    const user = await window.BeeversAPI.getCurrentUser();
    if (!user) { window.location.href = 'auth.html'; return; }

    window.BeeversUtils.qsa('[data-page]').forEach(a => {
      a.classList.toggle('active', a.dataset.page === activePage);
    });

    const team = await window.BeeversAPI.getMyTeam();
    const swipeLinks = window.BeeversUtils.qsa('[data-page="swipe"] .badge-lock');
    swipeLinks.forEach(b => { b.style.display = team ? 'inline-block' : 'none'; });

    const isPremium = window.BeeversAPI.isDemo ? window.BeeversDemo._state().isPremium : false;
    window.BeeversUtils.qsa('[data-plan-label]').forEach(el => {
      el.textContent = isPremium ? 'Premium' : 'Gratuit';
    });
    window.BeeversUtils.qsa('[data-plan-cta]').forEach(el => {
      el.style.display = isPremium ? 'none' : 'block';
    });

    if (window.BeeversAPI.isDemo) {
      const banner = document.createElement('div');
      banner.className = 'demo-banner';
      banner.textContent = "MODE DÉMO — Supabase non connecté (renseigne js/config.js). Données fictives, tout est réinitialisable.";
      document.body.prepend(banner);
    }

    window.BeeversUtils.qsa('[data-signout]').forEach(btn => {
      btn.addEventListener('click', async () => { await window.BeeversAPI.signOut(); window.location.href = 'index.html'; });
    });
  },
};
