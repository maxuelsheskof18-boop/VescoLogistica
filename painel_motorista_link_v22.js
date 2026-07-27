// painel_motorista_link_v22.js — Gerador de link isolado para motorista externo
// Adicione depois do app.js no logistica.html.
(function(){
  if(window.__vescoPainelMotoristaLinkV22) return;
  window.__vescoPainelMotoristaLinkV22 = true;

  const API = window.VESCO_API_URL || 'https://script.google.com/macros/s/AKfycbxEzbxBABMDwi7B7tn_1p-lC0vc50JjHFOrH3w42Oog2-5R2-WMYSrQ27ED7wduJUN6/exec';
  const STORAGE_KEY = 'vesco_saiu_rotas_v1';

  function esc(v){
    try { return typeof escapeHtml === 'function' ? escapeHtml(v) : String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
    catch(e){ return String(v ?? ''); }
  }
  function toast(msg){ try { if(typeof showToast === 'function') return showToast(msg, 'success', 3500); } catch(e){} alert(msg); }
  function errToast(msg){ try { if(typeof showToast === 'function') return showToast(msg, 'error', 4500); } catch(e){} alert(msg); }
  function getRotas(){
    if(Array.isArray(window.saiuRotas)) return window.saiuRotas;
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') || []; } catch(e) { return []; }
  }
  function saveRotas(rotas){ try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rotas || [])); window.saiuRotas = rotas; } catch(e){} }
  function findRota(id){ return getRotas().find(r => String(r.id) === String(id)); }
  function token(){ return Math.random().toString(36).slice(2,8).toUpperCase() + Date.now().toString(36).toUpperCase().slice(-4); }
  function motoristaBaseUrl(){ return new URL('motorista.html', window.location.href).toString(); }
  function buildLink(rota){ return motoristaBaseUrl() + '?rota=' + encodeURIComponent(rota.id) + '&token=' + encodeURIComponent(rota.motorista_token || ''); }

  function jsonp(action, data={}){
    return new Promise((resolve,reject)=>{
      const cb = '__vesco_painel_motorista_cb_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      const qs = new URLSearchParams(Object.assign({action, callback: cb}, data));
      const timer = setTimeout(()=>{ cleanup(); reject(new Error('Tempo excedido ao criar link.')); }, 20000);
      function cleanup(){ clearTimeout(timer); try{ delete window[cb]; }catch(e){} if(script.parentNode) script.remove(); }
      window[cb] = function(resp){ cleanup(); resolve(resp); };
      script.onerror = function(){ cleanup(); reject(new Error('Falha na comunicação com Apps Script.')); };
      script.src = API + (API.includes('?') ? '&' : '?') + qs.toString();
      document.head.appendChild(script);
    });
  }

  async function copyText(txt){
    txt = String(txt || '');
    try {
      if(navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(txt);
      else {
        const ta = document.createElement('textarea');
        ta.value = txt;
        ta.setAttribute('readonly','');
        ta.style.position='fixed';
        ta.style.left='-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      return true;
    } catch(e) {
      const ta = document.createElement('textarea');
      ta.value = txt;
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try { document.execCommand('copy'); }
      catch(err){ prompt('Copie o link do motorista:', txt); }
      ta.remove();
      return true;
    }
  }

  async function criarLinkMotorista(rotaId){
    const rotas = getRotas();
    const rota = rotas.find(r => String(r.id) === String(rotaId));
    if(!rota) return errToast('Rota não encontrada.');
    if(!rota.motorista_token) rota.motorista_token = token();
    rota.motorista_link = buildLink(rota);
    saveRotas(rotas);

    const payload = {
      rota: rota.id,
      token: rota.motorista_token,
      nome: rota.nome || 'Rota',
      motorista: rota.motorista || '',
      origem: rota.origem || '',
      pedidos: JSON.stringify(rota.pedidos || []),
      paradas: JSON.stringify(rota.paradas || [])
    };

    try {
      const resp = await jsonp('criarRotaMotorista', payload);
      if(!resp || !resp.success) throw new Error(resp && resp.error ? resp.error : 'Falha ao registrar rota.');
      await copyText(rota.motorista_link);
      toast('Link do motorista copiado. Envie no WhatsApp.');
      injectButtons();
      return rota.motorista_link;
    } catch(e) { errToast(e.message || String(e)); }
  }

  function extractIdFromCard(card){
    const html = card.innerHTML || '';
    let m = html.match(/['"](rota-[^'"]+)['"]/i) || html.match(/data-rota-id=["']([^"']+)["']/i);
    if(m) return m[1];
    const txt = card.textContent || '';
    const rota = getRotas().find(r => txt.includes(r.nome || '') || txt.includes(r.id || ''));
    return rota && rota.id;
  }

  function injectButtons(){
    const list = document.getElementById('saiu-rotas-list');
    if(!list) return;
    Array.from(list.children || []).forEach(card => {
      if(card.querySelector && card.querySelector('.vesco-link-motorista-v22')) return;
      const id = extractIdFromCard(card);
      if(!id) return;
      const rota = findRota(id) || {};
      const box = document.createElement('div');
      box.className = 'vesco-link-motorista-v22 mt-2 flex flex-wrap gap-2 justify-end';
      box.innerHTML = `
        <button type="button" class="bg-slate-900 text-white px-3 py-1 rounded text-xs font-bold" onclick="window.vescoCriarLinkMotoristaV22('${esc(id)}')">Link Motorista</button>
        ${rota.motorista_link ? `<a target="_blank" class="bg-blue-600 text-white px-3 py-1 rounded text-xs font-bold" href="${esc(rota.motorista_link)}">Abrir App</a>` : ''}
      `;
      card.appendChild(box);
    });
  }

  window.vescoCriarLinkMotoristaV22 = criarLinkMotorista;
  window.vescoPainelMotoristaLinkV22 = { injectButtons, criarLinkMotorista, getRotas, copyText, debug:()=>({rotas:getRotas().length, base:motoristaBaseUrl()}) };

  const prevRenderRotas = window.renderRotas;
  if(typeof prevRenderRotas === 'function') {
    window.renderRotas = function(){ const r = prevRenderRotas.apply(this, arguments); setTimeout(injectButtons, 80); return r; };
  }
  const prevSwitchTab = window.switchTab;
  if(typeof prevSwitchTab === 'function') {
    window.switchTab = function(which){ const r = prevSwitchTab.apply(this, arguments); if(which === 'saiu' || which === 'rotas') setTimeout(injectButtons, 180); return r; };
  }
  document.addEventListener('DOMContentLoaded', ()=>{ setTimeout(injectButtons, 800); try{ new MutationObserver(()=>injectButtons()).observe(document.body, {childList:true, subtree:true}); }catch(e){} });
  console.log('Painel Motorista Link V22 ativo — gera link isolado por rota.');
})();