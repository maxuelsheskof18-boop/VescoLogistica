// modulo.visual-premium.js — V1
// Camada visual sem alterar lógica. Ativa o tema premium apenas por classe CSS.

(function(){
  if (window.__vescoVisualPremiumV1) return;
  window.__vescoVisualPremiumV1 = true;

  function apply(){
    document.body.classList.add('vesco-premium');

    // Marca os principais containers para o CSS trabalhar melhor sem depender de HTML fixo.
    const candidates = [
      'view-separacao',
      'view-logistica',
      'view-saiu',
      'view-retiradas',
      'view-envios_flex',
      'view-flex',
      'view-entregues'
    ];

    candidates.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('vesco-premium-panel');
    });

    document.querySelectorAll('table').forEach(t => t.classList.add('vesco-premium-table'));
    document.querySelectorAll('.leaflet-container').forEach(m => m.classList.add('vesco-premium-map'));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();

  window.addEventListener('vesco:rendered', () => setTimeout(apply, 150));
  window.addEventListener('vesco:loaded', () => setTimeout(apply, 350));

  setInterval(apply, 2500);

  window.VescoVisualPremium = { apply, version: 'V1' };

  console.log('Visual Premium V1 ativo.');
})();
