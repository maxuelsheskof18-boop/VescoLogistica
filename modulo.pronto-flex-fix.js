// modulo.pronto-flex-fix-v1.js — V1.0
// Correção isolada para "Pronto para Envio":
// - encontra Flex por pedido, e-commerce, referência ou IDs alternativos;
// - consulta somente a API Flex quando necessário (não recarrega o painel inteiro);
// - preserva motorista, origem, nome da rota e checkboxes ao adicionar/remover;
// - evita duplicidade e informa quando o Flex já está em outra rota;
// - funciona sobre VescoV8 V10.19/V10.21+ sem alterar ERP, mapas ou Firebase.

(function(){
  'use strict';

  if (window.VescoProntoFlexFix && window.VescoProntoFlexFix.__v1) return;

  const INSTALL_RETRY_MS = 250;
  const INSTALL_MAX_TRIES = 80;
  const REMOTE_TIMEOUT_MS = 20000;
  let installTries = 0;
  let observer = null;
  let enhanceTimer = null;
  let lastMessage = null;

  function txt(v){ return v === null || v === undefined ? '' : String(v).trim(); }
  function digits(v){ return txt(v).replace(/\D/g, ''); }
  function clean(v){ return txt(v).replace(/^#/, '').trim(); }
  function norm(v){
    return clean(v)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .trim();
  }
  function esc(v){
    return txt(v).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  function core(){ return window.VescoV8 || null; }
  function state(){ return core() && core().state ? core().state : null; }

  const ALIASES = [
    'pedido_key','pedidoKey','id','id_tiny','idTiny','id_flex','flex_id',
    'numero','pedido','numero_pedido','numeroPedido','numero_venda','numeroVenda',
    'numero_ecommerce','numero_ecommerc','numeroEcommerce','ecommerce','e_commerce',
    'ecommerce_id','id_ecommerce','idEcommerce','ecom','e_com',
    'referencia','reference','order_reference','orderReference','order_id','orderId',
    'external_id','externalId','codigo','codigo_externo','codigoExterno',
    'pack_id','packId','shipping_id','shippingId','shipment_id','shipmentId',
    'ml_order_id','mercado_livre_id','marketplace_id'
  ];

  function valuesOf(order){
    if (!order || typeof order !== 'object') return [];
    const vals = [];
    ALIASES.forEach(k => {
      const v = order[k];
      if (v !== null && v !== undefined && txt(v)) vals.push(txt(v));
    });

    // Campo composto/objetos antigos.
    ['raw','pedido_raw','tiny_raw'].forEach(k => {
      const obj = order[k];
      if (!obj || typeof obj !== 'object') return;
      ALIASES.forEach(a => {
        const v = obj[a];
        if (v !== null && v !== undefined && txt(v)) vals.push(txt(v));
      });
    });

    const out = new Set();
    vals.forEach(v => {
      const c = clean(v);
      if (!c) return;
      out.add(c);
      const n = norm(c);
      const d = digits(c);
      if (n) out.add(n);
      if (d) out.add(d);
    });
    return Array.from(out);
  }

  function orderIdentity(order){
    const preferred = [
      order && order.pedido_key,
      order && order.id,
      order && order.numero,
      order && order.pedido,
      order && order.id_tiny,
      order && order.numero_ecommerce,
      order && order.ecommerce,
      order && order.ecom,
      order && order.id_flex
    ].map(txt).filter(Boolean);
    return preferred[0] || valuesOf(order)[0] || '';
  }

  function orderNumber(order){
    return txt(order && (
      order.numero || order.pedido || order.id_tiny || order.numero_pedido ||
      order.id || order.id_flex || order.pedido_key || ''
    ));
  }

  function orderEcom(order){
    return txt(order && (
      order.numero_ecommerce || order.numero_ecommerc || order.numeroEcommerce ||
      order.ecommerce || order.e_commerce || order.ecommerce_id ||
      order.id_ecommerce || order.ecom || order.e_com || order.reference || ''
    ));
  }

  function orderClient(order){
    return txt(order && (
      order.cliente_nome || order.destinatario || order.cliente || order.nome ||
      order.nome_destinatario || order.receiver || order.recipient || ''
    ));
  }

  function sameOrder(a, b){
    if (!a || !b) return false;
    const bSet = new Set(valuesOf(b));
    return valuesOf(a).some(v => bSet.has(v));
  }

  function matchOrder(order, query){
    const qClean = clean(query);
    const qNorm = norm(query);
    const qDigits = digits(query);
    if (!qClean) return false;

    return valuesOf(order).some(v => {
      const vClean = clean(v);
      const vNorm = norm(v);
      const vDigits = digits(v);
      return vClean === qClean ||
        (!!qNorm && vNorm === qNorm) ||
        (!!qDigits && vDigits === qDigits);
    });
  }

  function dedupOrders(rows){
    const out = [];
    (rows || []).forEach(row => {
      if (!row || typeof row !== 'object') return;
      if (!out.some(x => sameOrder(x, row))) out.push(row);
    });
    return out;
  }

  function flexPools(){
    const rows = [];
    const s = state();

    if (s && Array.isArray(s.flex)) rows.push(...s.flex);
    if (s && Array.isArray(s.rotaFlexExtras)) rows.push(...s.rotaFlexExtras);

    try {
      if (window.VescoState && typeof window.VescoState.flexOrders === 'function') {
        const a = window.VescoState.flexOrders();
        if (Array.isArray(a)) rows.push(...a);
      }
    } catch(e) {}

    try { if (Array.isArray(window.flexOrders)) rows.push(...window.flexOrders); } catch(e) {}
    try { if (Array.isArray(window.pedidosFlex)) rows.push(...window.pedidosFlex); } catch(e) {}
    try { if (Array.isArray(window.enviosFlex)) rows.push(...window.enviosFlex); } catch(e) {}

    // Recupera todos os meses salvos; a busca para rota não deve depender do mês selecionado.
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith('vesco:v8:flexMonth:')) continue;
        try {
          const parsed = JSON.parse(localStorage.getItem(key) || '{}');
          if (Array.isArray(parsed.rows)) rows.push(...parsed.rows);
        } catch(e) {}
      }
    } catch(e) {}

    return dedupOrders(rows);
  }

  function findLocal(query){
    return flexPools().find(o => matchOrder(o, query)) || null;
  }

  function matrixToObjects(matrix){
    if (!Array.isArray(matrix) || matrix.length < 2 || !Array.isArray(matrix[0])) return [];
    const headers = matrix[0].map(h => txt(h));
    if (!headers.some(Boolean)) return [];
    return matrix.slice(1).filter(Array.isArray).map(row => {
      const obj = {};
      headers.forEach((h, i) => { if (h) obj[h] = row[i]; });
      return obj;
    });
  }

  function extractRows(payload){
    if (!payload) return [];
    if (Array.isArray(payload)) {
      if (payload.length && Array.isArray(payload[0])) return matrixToObjects(payload);
      return payload;
    }
    if (typeof payload !== 'object') return [];

    const names = ['flex','flexOrders','enviosFlex','pedidos','orders','rows','data','items','resultados'];
    for (const name of names) {
      const value = payload[name];
      if (Array.isArray(value)) {
        if (value.length && Array.isArray(value[0])) return matrixToObjects(value);
        return value;
      }
    }

    if (payload.data && typeof payload.data === 'object') {
      const nested = extractRows(payload.data);
      if (nested.length) return nested;
    }
    if (payload.result && typeof payload.result === 'object') {
      const nested = extractRows(payload.result);
      if (nested.length) return nested;
    }
    return [];
  }

  function jsonp(url, params, timeoutMs){
    return new Promise((resolve, reject) => {
      const cb = '__vesco_pronto_flex_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      const qs = new URLSearchParams(params || {});
      qs.set('callback', cb);
      let done = false;

      function cleanup(){
        try { delete window[cb]; } catch(e) { window[cb] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      }

      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error('Tempo excedido ao consultar os Flex.'));
      }, timeoutMs || REMOTE_TIMEOUT_MS);

      window[cb] = data => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        cleanup();
        resolve(data);
      };

      script.onerror = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        cleanup();
        reject(new Error('Falha ao consultar a API Flex.'));
      };

      script.async = true;
      script.src = url + (url.includes('?') ? '&' : '?') + qs.toString();
      document.head.appendChild(script);
    });
  }

  async function loadRemoteFlex(){
    const url = txt(window.VESCO_API_FLEX_URL);
    if (!url) throw new Error('VESCO_API_FLEX_URL não configurada.');

    const s = state() || {};
    const payload = await jsonp(url, {
      action: 'enviosFlex',
      allFlex: '1',
      dataISO: s.date || '',
      mes: s.month || ''
    }, REMOTE_TIMEOUT_MS);

    const rows = extractRows(payload).map(o => ({
      ...o,
      __v8source: 'flex',
      __source: 'flex',
      source: txt(o && o.source) || 'flex',
      is_flex: true
    }));

    if (!rows.length && payload && payload.success === false) {
      throw new Error(txt(payload.error || payload.message) || 'API Flex retornou erro.');
    }

    const st = state();
    if (st) st.flex = dedupOrders([...(Array.isArray(st.flex) ? st.flex : []), ...rows]);
    try { window.flexOrders = dedupOrders([...(Array.isArray(window.flexOrders) ? window.flexOrders : []), ...rows]); } catch(e) {}

    return rows;
  }

  function currentFormState(){
    const values = {};
    ['v8RotaMotorista','v8RotaOrigem','v8RotaNome','v8FlexRotaBusca'].forEach(id => {
      const el = document.getElementById(id);
      if (el) values[id] = el.value;
    });
    const selected = Array.from(document.querySelectorAll('.v8-route-check:checked')).map(el => clean(el.value));
    const tableWrap = document.querySelector('#v8Content .v8-table-wrap');
    return {
      values,
      selected,
      tableScrollTop: tableWrap ? tableWrap.scrollTop : 0,
      pageScrollY: window.scrollY || 0
    };
  }

  function restoreFormState(saved, forceChecked){
    if (!saved) return;
    Object.entries(saved.values || {}).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el && id !== 'v8FlexRotaBusca') el.value = value;
    });

    const wanted = new Set([...(saved.selected || []), ...(forceChecked || [])].map(clean).filter(Boolean));
    document.querySelectorAll('.v8-route-check').forEach(el => {
      const v = clean(el.value);
      if (wanted.has(v)) el.checked = true;
    });

    const tableWrap = document.querySelector('#v8Content .v8-table-wrap');
    if (tableWrap) tableWrap.scrollTop = saved.tableScrollTop || 0;
  }

  function messageBox(){
    const add = document.querySelector('#v8Content .v8-flex-route-add');
    if (!add) return null;
    let box = document.getElementById('v8FlexRotaMensagem');
    if (!box) {
      box = document.createElement('div');
      box.id = 'v8FlexRotaMensagem';
      box.className = 'v8-flex-route-message';
      add.insertAdjacentElement('afterend', box);
    }
    return box;
  }

  function showMessage(text, type){
    lastMessage = { text: txt(text), type: type || 'info', at: Date.now() };
    const box = messageBox();
    if (!box) return;
    box.className = 'v8-flex-route-message ' + (type || 'info');
    box.innerHTML = esc(text);
    box.style.display = text ? 'block' : 'none';
  }

  function setBusy(on){
    const input = document.getElementById('v8FlexRotaBusca');
    const button = input && input.parentElement ? input.parentElement.querySelector('button') : null;
    if (input) input.disabled = !!on;
    if (button) {
      if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
      button.disabled = !!on;
      button.textContent = on ? 'Buscando...' : (button.dataset.originalText || 'Adicionar Flex');
    }
  }

  function activeRouteContaining(order){
    const s = state();
    const routes = s && Array.isArray(s.rotas) ? s.rotas : [];
    const orderVals = valuesOf(order);
    for (const route of routes) {
      const status = norm(route && route.status);
      if (status.includes('conclu') || status.includes('cancel')) continue;
      let ids = route && (route.pedidos || route.orders || route.pedidos_json || route.pedidosJson || []);
      if (typeof ids === 'string') {
        try { ids = JSON.parse(ids); } catch(e) { ids = ids.split(/[,;\s]+/); }
      }
      if (!Array.isArray(ids)) ids = [];
      const routeSet = new Set();
      ids.forEach(item => {
        if (item && typeof item === 'object') valuesOf(item).forEach(v => routeSet.add(v));
        else {
          const c = clean(item);
          if (c) routeSet.add(c);
          const d = digits(item); if (d) routeSet.add(d);
          const n = norm(item); if (n) routeSet.add(n);
        }
      });
      if (orderVals.some(v => routeSet.has(v))) return route;
    }
    return null;
  }

  function addToState(order){
    const s = state();
    if (!s) throw new Error('Estado do painel indisponível.');
    const normalized = {
      ...order,
      __rotaSource: 'Flex',
      __v8source: 'flex',
      __source: 'flex',
      source: txt(order && order.source) || 'flex',
      is_flex: true
    };

    const extras = Array.isArray(s.rotaFlexExtras) ? s.rotaFlexExtras : [];
    if (!extras.some(x => sameOrder(x, normalized))) extras.push(normalized);
    s.rotaFlexExtras = extras;

    const live = Array.isArray(s.flex) ? s.flex : [];
    if (!live.some(x => sameOrder(x, normalized))) live.push(normalized);
    s.flex = live;

    return normalized;
  }

  function addedAlready(order){
    const s = state();
    return !!(s && Array.isArray(s.rotaFlexExtras) && s.rotaFlexExtras.some(x => sameOrder(x, order)));
  }

  function redrawPreserving(saved, forceOrder){
    const v = core();
    if (!v || typeof v.renderProntoEnvio !== 'function') return;
    v.renderProntoEnvio();
    const forced = forceOrder ? valuesOf(forceOrder) : [];
    setTimeout(() => {
      enhance();
      restoreFormState(saved, forced);
      if (lastMessage && Date.now() - lastMessage.at < 10000) showMessage(lastMessage.text, lastMessage.type);
    }, 20);
  }

  async function addFlexToRouteByCode(){
    const input = document.getElementById('v8FlexRotaBusca');
    const code = txt(input && input.value);
    if (!code) {
      showMessage('Digite o número do pedido ou o e-commerce Flex.', 'warn');
      input && input.focus();
      return false;
    }

    const saved = currentFormState();
    setBusy(true);
    showMessage('Buscando Flex...', 'info');

    try {
      let found = findLocal(code);
      if (!found) {
        const remote = await loadRemoteFlex();
        found = remote.find(o => matchOrder(o, code)) || findLocal(code);
      }

      if (!found) {
        showMessage(`Flex “${code}” não encontrado. Confirme o número do pedido ou e-commerce na aba Envios Flex.`, 'error');
        return false;
      }

      const inRoute = activeRouteContaining(found);
      if (inRoute) {
        const name = txt(inRoute.nome_rota || inRoute.nome || inRoute.rota || inRoute.rota_id || inRoute.id);
        showMessage(`Este Flex já está em uma rota ativa${name ? ': ' + name : ''}.`, 'warn');
        return false;
      }

      if (addedAlready(found)) {
        showMessage(`Flex #${orderNumber(found) || orderEcom(found) || code} já foi adicionado nesta montagem.`, 'warn');
        redrawPreserving(saved, found);
        return true;
      }

      const added = addToState(found);
      if (input) input.value = '';
      showMessage(`Flex #${orderNumber(added) || orderEcom(added) || code} adicionado à rota${orderClient(added) ? ' — ' + orderClient(added) : ''}.`, 'success');
      redrawPreserving(saved, added);
      return true;
    } catch(e) {
      console.error('Pronto Flex Fix:', e);
      showMessage('Não foi possível adicionar o Flex: ' + (e && e.message ? e.message : e), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  function removeFlexFromRoute(id){
    const s = state();
    if (!s) return false;
    const saved = currentFormState();
    const target = (Array.isArray(s.rotaFlexExtras) ? s.rotaFlexExtras : []).find(o => matchOrder(o, id));
    s.rotaFlexExtras = (Array.isArray(s.rotaFlexExtras) ? s.rotaFlexExtras : []).filter(o => !matchOrder(o, id));
    showMessage(`Flex #${target ? (orderNumber(target) || orderEcom(target) || id) : id} removido da montagem.`, 'info');
    redrawPreserving(saved, null);
    return true;
  }

  function suggestions(){
    return flexPools().slice(0, 500);
  }

  function enhance(){
    const input = document.getElementById('v8FlexRotaBusca');
    if (!input) return;

    let list = document.getElementById('v8FlexRotaSugestoes');
    if (!list) {
      list = document.createElement('datalist');
      list.id = 'v8FlexRotaSugestoes';
      document.body.appendChild(list);
    }
    input.setAttribute('list', 'v8FlexRotaSugestoes');
    input.setAttribute('autocomplete', 'off');
    input.placeholder = 'Pedido ou e-commerce Flex';

    const rows = suggestions();
    const html = [];
    rows.forEach(o => {
      const num = orderNumber(o);
      const ecom = orderEcom(o);
      const client = orderClient(o);
      if (num) html.push(`<option value="${esc(num)}">${esc([ecom && ecom !== num ? 'E-com ' + ecom : '', client].filter(Boolean).join(' — '))}</option>`);
      if (ecom && ecom !== num) html.push(`<option value="${esc(ecom)}">${esc([num ? 'Pedido ' + num : '', client].filter(Boolean).join(' — '))}</option>`);
    });
    list.innerHTML = html.join('');

    const add = document.querySelector('#v8Content .v8-flex-route-add small');
    if (add) add.textContent = `${rows.length} Flex carregado(s). Pesquise por pedido ou e-commerce; somente a API Flex será consultada se não estiver em memória.`;

    messageBox();
    if (lastMessage && Date.now() - lastMessage.at < 10000) showMessage(lastMessage.text, lastMessage.type);
  }

  function installStyles(){
    if (document.getElementById('vesco-pronto-flex-fix-css')) return;
    const style = document.createElement('style');
    style.id = 'vesco-pronto-flex-fix-css';
    style.textContent = `
      .v8-flex-route-message{display:none;margin:8px 0 12px;padding:9px 12px;border-radius:10px;font-size:12px;font-weight:800;border:1px solid #cbd5e1;background:#f8fafc;color:#334155}
      .v8-flex-route-message.success{display:block;background:#ecfdf5;border-color:#86efac;color:#166534}
      .v8-flex-route-message.warn{display:block;background:#fffbeb;border-color:#fde68a;color:#92400e}
      .v8-flex-route-message.error{display:block;background:#fef2f2;border-color:#fca5a5;color:#991b1b}
      .v8-flex-route-message.info{display:block;background:#eff6ff;border-color:#93c5fd;color:#1e40af}
      #v8FlexRotaBusca:disabled{opacity:.65;cursor:wait}
    `;
    document.head.appendChild(style);
  }

  function observeContent(){
    if (observer) observer.disconnect();
    const content = document.getElementById('v8Content');
    if (!content) return;
    observer = new MutationObserver(() => {
      clearTimeout(enhanceTimer);
      enhanceTimer = setTimeout(enhance, 30);
    });
    observer.observe(content, { childList:true });
  }

  function install(){
    const v = core();
    if (!v || !v.state || typeof v.renderProntoEnvio !== 'function') return false;

    installStyles();

    v.addFlexToRouteByCode = addFlexToRouteByCode;
    v.removeFlexFromRoute = removeFlexFromRoute;

    const originalRender = v.renderProntoEnvio;
    if (!originalRender.__vescoFlexFixWrapped) {
      const wrapped = function(){
        const result = originalRender.apply(this, arguments);
        setTimeout(enhance, 20);
        return result;
      };
      wrapped.__vescoFlexFixWrapped = true;
      wrapped.__vescoOriginal = originalRender;
      v.renderProntoEnvio = wrapped;
    }

    observeContent();
    enhance();

    window.VescoProntoFlexFix = {
      __v1:true,
      version:'1.0.0',
      add:addFlexToRouteByCode,
      remove:removeFlexFromRoute,
      find:findLocal,
      reloadFlex:loadRemoteFlex,
      pools:flexPools,
      enhance,
      debug(){
        const s = state() || {};
        return {
          version:'1.0.0',
          apiFlex:window.VESCO_API_FLEX_URL || '',
          stateFlex:Array.isArray(s.flex) ? s.flex.length : 0,
          extras:Array.isArray(s.rotaFlexExtras) ? s.rotaFlexExtras.length : 0,
          searchable:flexPools().length,
          activeRoutes:Array.isArray(s.rotas) ? s.rotas.length : 0
        };
      }
    };

    console.log('VESCO Pronto Flex Fix V1 ativo — busca isolada, estado preservado e sem reload completo.');
    return true;
  }

  function waitInstall(){
    if (install()) return;
    installTries++;
    if (installTries < INSTALL_MAX_TRIES) setTimeout(waitInstall, INSTALL_RETRY_MS);
    else console.error('VESCO Pronto Flex Fix: VescoV8 não foi encontrado. Carregue este arquivo depois do módulo operacional.');
  }

  waitInstall();
})();
