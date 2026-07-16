// ─── MOTSA — jeu de lumière (halo au survol + révélation au défilement) ────
// Purement cosmétique, sans dépendance. Respecte prefers-reduced-motion
// (voir styles.css) : si l'utilisateur a demandé moins d'animations, ce
// script ne fait quasiment rien à part rendre le contenu visible.

(function () {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Halo qui suit le curseur — liste unique de sélecteurs ──────
  // Un seul point de vérité pour "quelles surfaces réagissent au survol",
  // plutôt que de compter sur la classe .spot posée à la main dans chaque
  // page (source des incohérences constatées). Toute carte du système de
  // design est couverte automatiquement, même sans classe .spot explicite.
  const HALO_SELECTOR = [
    '.spot', '.price-card', '.formula-card', '.seg', '.tile',
    '.trust-strip > div', '.stat-card', '.card.panel', '.hero-proof',
    '.auth-form-wrap', '#admin-panel',
  ].join(', ');

  if (!reduceMotion) {
    document.querySelectorAll(HALO_SELECTOR).forEach(el => {
      el.addEventListener('mousemove', e => {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        el.style.setProperty('--my', (e.clientY - r.top) + 'px');
      });
    });

    // ── Halo ambiant sur toute la section .hero ──
    const hero = document.querySelector('.hero');
    if (hero) {
      hero.addEventListener('mousemove', e => {
        const r = hero.getBoundingClientRect();
        hero.style.setProperty('--hx', ((e.clientX - r.left) / r.width * 100) + '%');
        hero.style.setProperty('--hy', ((e.clientY - r.top) / r.height * 100) + '%');
      });
    }
  }

  // ── Barre de progression de défilement ──
  const bar = document.getElementById('scroll-progress');
  if (bar) {
    const updateProgress = () => {
      const h = document.documentElement;
      const scrollable = h.scrollHeight - h.clientHeight;
      const pct = scrollable > 0 ? (h.scrollTop / scrollable) * 100 : 0;
      bar.style.width = pct + '%';
    };
    window.addEventListener('scroll', updateProgress, { passive: true });
    updateProgress();
  }

  // ── Révélation progressive au défilement ──
  const revealTargets = document.querySelectorAll('.reveal, .reveal-stagger, .section');
  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealTargets.forEach(el => el.classList.add('in-view'));
    return;
  }

  const io = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in-view');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: .12, rootMargin: '0px 0px -60px 0px' });

  revealTargets.forEach(el => io.observe(el));
})();
