// ─── MOTSA — jeu de lumière (halo au survol + révélation au défilement) ────
// Purement cosmétique, sans dépendance. Respecte prefers-reduced-motion
// (voir styles.css) : si l'utilisateur a demandé moins d'animations, ce
// script ne fait quasiment rien à part rendre le contenu visible.

(function () {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Halo qui suit le curseur sur les éléments .spot ──
  if (!reduceMotion) {
    document.querySelectorAll('.spot').forEach(el => {
      el.addEventListener('mousemove', e => {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        el.style.setProperty('--my', (e.clientY - r.top) + 'px');
      });
    });
  }

  // ── Révélation progressive au défilement ──
  const revealTargets = document.querySelectorAll('.reveal, .reveal-stagger');
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
