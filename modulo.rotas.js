// modulo.rotas.js — V3.5
// Correção focada:
// 1) Puxa rotas da planilha mesmo quando o Apps Script retorna matriz de linhas/colunas.
// 2) Aceita aba RotasMotorista sem coluna data_operacional, usando criado_em/atualizado_em.
// 3) Mantém "Montar Rotas" oculto e rotas ficam dentro de Pronto para Envio.
// 4) Flex pode entrar na rota por pedido/E-commerce.

(function(){
  const CFG = window.VescoConfig || {};
  const selected = window.__vescoRouteSelectionV35 || new Set();
  window.__vescoRouteSelectionV35 = selected;

  let remoteRoutes = [];
  let remoteLoadedAt = 0;
  let remoteLoading = false;

  function txt(v){ return v === null || v === undefined ? '' : String(v).trim(); }

  function norm(v){
    return txt(v)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function esc(v){
    try {
      if (window.VescoState && window.VescoState.esc) return window.VescoState.esc(v);
    } catch(e) {}

    return txt(v).replace(/[&<>"']/g, m => ({
      '&':'&amp;',
      '<':'&lt;',
      '>':'&gt;',
      '"':'&quot;',
      "'":'&#39;'
    }[m]));
  }

  function digits(v){ return txt(v).replace(/\D/g, ''); }

  function readJSON(key, fallback){
    try {
      if (window.VescoState && window.VescoState.readJSON) return window.VescoState.readJSON(key, fallback);
    } catch(e) {}

    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch(e) {
      return fallback;
    }
  }

  function writeJSON(key, value){
    try {
      if (window.VescoState && window.VescoState.writeJSON) return window.VescoState.writeJSON(key, value);
    } catch(e) {}

    try { localStorage.setItem(key, JSON.stringify(value)); } catch(e) {}
  }

  function selectedISO(){
    try {
      if (window.VescoState && window.VescoState.selectedDateISO) return window.VescoState.selectedDateISO();
    } catch(e) {}

    const el = document.getElementById('topCalendar') || document.querySelector('input[type="date"]');
    if (el && el.value) return parseDateISO(el.value) || el.value;

    return new Date().toISOString().slice(0, 10);
  }

  function parseDateISO(v){
    const s = txt(v);
    if (!s) return '';

    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

    const br = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (br) {
      const y = br[3].length === 2 ? '20' + br[3] : br[3];
      return `${y}-${String(br[2]).padStart(2,'0')}-${String(br[1]).padStart(2,'0')}`;
    }

    return '';
  }

  function dateBR(v){
    try {
      if (window.VescoState && window.VescoState.dateBR) return window.VescoState.dateBR(v);
    } catch(e) {}

    const s = txt(v);
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;

    return s || '—';
  }

  function mainOrders(){
    try {
      if (window.VescoState && window.VescoState.orders) return window.VescoState.orders();
    } catch(e) {}

    try { if (Array.isArray(window.orders)) return window.orders; } catch(e) {}
    try { if (typeof orders !== 'undefined' && Array.isArray(orders)) return orders; } catch(e) {}

    return [];
  }

  function flexOrders(){
    try {
      if (window.VescoState && window.VescoState.flexOrders) return window.VescoState.flexOrders();
    } catch(e) {}

    try { if (Array.isArray(window.flexOrders)) return window.flexOrders; } catch(e) {}
    try { if (typeof flexOrders !== 'undefined' && Array.isArray(flexOrders)) return flexOrders; } catch(e) {}

    return [];
  }

  function allRouteOrders(){
    const out = [];

    mainOrders().forEach(o => out.push({ order:o, tipo:'normal' }));
    flexOrders().forEach(o => out.push({ order:o, tipo:'flex' }));

    return out;
  }

  function getStatus(o){
    try {
      if (window.VescoState && window.VescoState.getStatus) return window.VescoState.getStatus(o);
    } catch(e) {}

    return txt(o && (o.status_logistica || o.status || o.situacao_nome || o.situacao || o.status_operacional || ''));
  }

  function isDelivered(o){
    try {
      if (window.VescoState && window.VescoState.isDelivered) return window.VescoState.isDelivered(o);
    } catch(e) {}

    const s = norm(getStatus(o));
    if (s.includes('pendente de entrega')) return false;

    return (
      s === 'entregue' ||
      s === 'finalizado' ||
      s === 'concluido' ||
      s.includes('concluida') ||
      !!txt(o && (o.data_entregue || o.entregue_em || o.finalizado_em))
    );
  }

  function isASeparar(o){
    try {
      if (window.VescoState && window.VescoState.isASeparar) return window.VescoState.isASeparar(o);
    } catch(e) {}

    const s = norm(getStatus(o));

    return s.includes('a separar') || s.includes('em separacao') || s.includes('em separação');
  }

  function getAddress(o){
    try {
      if (window.VescoState && window.VescoState.getAddress) return window.VescoState.getAddress(o);
    } catch(e) {}

    return txt(o && (o.endereco_completo || o.endereco || o.address || o.full_address || o.destino || ''));
  }

  function coords(o){
    const latRaw = o && (o.lat ?? o.latitude ?? o.lat_destino ?? o.latitude_destino ?? o.geo_lat);
    const lonRaw = o && (o.lon ?? o.lng ?? o.longitude ?? o.lon_destino ?? o.lng_destino ?? o.longitude_destino ?? o.geo_lon);

    const lat = parseFloat(String(latRaw ?? '').replace(',', '.'));
    const lon = parseFloat(String(lonRaw ?? '').replace(',', '.'));

    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
    return null;
  }

  function hasAddress(o){
    try {
      if (window.VescoState && window.VescoState.hasAddress) return window.VescoState.hasAddress(o);
    } catch(e) {}

    const a = norm(getAddress(o));

    if (!a || a === '-' || a === '—') return false;
    if (a.includes('endereco nao disponivel')) return false;
    if (a.includes('endereço não disponível')) return false;
    if (a.includes('sem endereco')) return false;
    if (a.includes('sem endereço')) return false;

    return true;
  }

  function hasRouteTarget(o){
    return hasAddress(o) || !!coords(o);
  }

  function formaRaw(o){
    return [
      o && o.id_forma_envio,
      o && o.idFormaEnvio,
      o && o.idFormaEnvioPsq,
      o && o.forma_envio_id,
      o && o.forma_envio_nome,
      o && o.nome_forma_envio,
      o && o.nomeformafenvio,
      o && o.transportadora,
      o && o.transportador,
      o && o.forma_envio,
      o && o.tipo_entrega,
      o && o.prioridade_label,
      o && o.transporte_completo
    ].map(txt).filter(Boolean).join(' | ');
  }

  function isFlex(o){
    const f = norm(formaRaw(o));
    return (
      f.includes('mercado envios flex') ||
      f.includes('envios flex') ||
      f.includes(' flex') ||
      flexOrders().some(x => x === o)
    );
  }

  function isRetirada(o){
    try {
      if (window.VescoState && window.VescoState.isRetirada) return window.VescoState.isRetirada(o);
    } catch(e) {}

    const f = norm(formaRaw(o));
    const ids = CFG.RETIRADA_IDS || ['747632298', '758290131', '860463094'];

    if (ids.some(id => f.includes(id))) return true;

    return (
      f.includes('retirar pessoalmente') ||
      f.includes('retirada') ||
      f.includes('retirar na loja') ||
      f.includes('cliente retira') ||
      f.includes('retirar')
    );
  }

  function orderKeys(o){
    try {
      if (window.VescoState && window.VescoState.keys) return window.VescoState.keys(o);
    } catch(e) {}

    const vals = [
      o && o.id,
      o && o.numero,
      o && o.pedido,
      o && o.id_tiny,
      o && o.pedido_key,
      o && o.numero_ecommerce,
      o && o.numero_ecommerc,
      o && o.numeroEcommerce,
      o && o.ecommerce,
      o && o.e_commerce,
      o && o.ecommerce_id,
      o && o.id_ecommerce,
      o && o.ecom,
      o && o.e_com,
      o && o.referencia,
      o && o.reference,
      o && o.order_id,
      o && o.codigo,
      o && o.numero_venda,
      o && o.id_flex,
      o && o.flex_id
    ].map(txt).filter(Boolean);

    const out = new Set();

    vals.forEach(v => {
      out.add(v);
      out.add(v.replace(/^#/, ''));

      const d = digits(v);
      if (d) out.add(d);
    });

    return Array.from(out).filter(Boolean);
  }

  function getKey(o){
    try {
      if (window.VescoState && window.VescoState.getKey) return window.VescoState.getKey(o);
    } catch(e) {}

    return txt(o && (o.id || o.pedido_key || o.numero || o.id_tiny || o.numero_ecommerce || o.ecom || o.id_flex || ''));
  }

  function getNumber(o){
    try {
      if (window.VescoState && window.VescoState.getNumber) return window.VescoState.getNumber(o);
    } catch(e) {}

    return txt(o && (o.numero || o.pedido || o.id_tiny || o.id || o.id_flex || ''));
  }

  function getEcom(o){
    return txt(o && (
      o.numero_ecommerce ||
      o.numero_ecommerc ||
      o.numeroEcommerce ||
      o.ecommerce ||
      o.e_commerce ||
      o.ecommerce_id ||
      o.id_ecommerce ||
      o.ecom ||
      o.e_com ||
      ''
    ));
  }

  function getCliente(o){
    return txt(o && (o.cliente_nome || o.destinatario || o.cliente || o.nome || o.nome_destinatario || 'Cliente não informado'));
  }

  function getOrderDate(o){
    try {
      if (window.VescoState && window.VescoState.getOrderDate) return window.VescoState.getOrderDate(o);
    } catch(e) {}

    return txt(o && (o.data_prevista || o.data_previsao || o.previsao || o.data_pedido || o.data || ''));
  }

  function findAnyOrder(value){
    const input = txt(value);
    const plain = input.replace(/^#/, '');
    const d = digits(input);

    if (!input) return null;

    const wanted = new Set([input, plain, d].filter(Boolean));

    for (const item of allRouteOrders()) {
      const ks = orderKeys(item.order);
      if (ks.some(k => wanted.has(k) || (d && digits(k) === d))) {
        return item;
      }
    }

    return null;
  }

  function routePedidoId(o){
    return getNumber(o) || getKey(o) || getEcom(o);
  }

  function routeDisplay(o, tipo){
    const num = getNumber(o) || getKey(o);
    const ecom = getEcom(o);

    if (tipo === 'flex') {
      return ecom && ecom !== num ? `#${num} | E-com: ${ecom}` : `#${num}`;
    }

    return `#${num}`;
  }

  function selectedItem(id){
    const item = findAnyOrder(id);
    if (item) return item;
    return { order:null, tipo:'manual', manual:id };
  }

  function storageKeys(){
    return Array.from(new Set([
      CFG.ROUTES_KEY || 'vesco_saiu_rotas_v1',
      CFG.ROUTES_KEY_MODULAR || 'vesco_routes_modular_v2',
      CFG.ROUTES_REMOTE_CACHE_KEY || 'vesco_routes_remote_cache_v2',
      'vesco_routes_modular_v1'
    ]));
  }

  function parseMaybeJSON(v){
    if (Array.isArray(v)) return v;
    if (v == null) return [];
    if (typeof v === 'object') return [v];

    const s = txt(v);
    if (!s || s === '-' || s === '—' || s === '[]' || s === '{}') return [];

    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === 'object') return [parsed];
    } catch(e) {}

    return s.split(/[,;\n\r\t ]+/g).map(x => x.trim()).filter(Boolean);
  }

  function cleanPedidoId(v){
    if (v == null) return '';

    if (typeof v === 'object') {
      v = v.numero || v.pedido || v.id || v.id_tiny || v.numero_ecommerce || v.ecom || '';
    }

    let s = txt(v).replace(/^#/, '').replace(/^pedido[:\s]*/i, '').trim();

    if (!s || s === '-' || s === '—') return '';
    if (['undefined','null','nan'].includes(s.toLowerCase())) return '';

    s = s.replace(/[^\w.-]/g, '');

    if (!/\d/.test(s)) return '';

    return s;
  }

  function headersToObjects(matrix){
    if (!Array.isArray(matrix) || matrix.length < 2) return null;
    if (!Array.isArray(matrix[0])) return null;

    const headers = matrix[0].map(h => norm(h).replace(/\s+/g, '_'));
    const hasRouteHeader = headers.some(h => ['rota_id','token','nome_rota','motorista','pedidos_json'].includes(h));

    if (!hasRouteHeader) return null;

    return matrix.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => obj[h] = row[i]);
      return obj;
    });
  }

  function normalizeRoute(raw){
    raw = raw || {};

    let pedidosRaw =
      raw.pedidos_json !== undefined ? raw.pedidos_json :
      raw.pedidos !== undefined ? raw.pedidos :
      raw.orders !== undefined ? raw.orders :
      raw.pedido !== undefined ? raw.pedido :
      raw.pedidosJson !== undefined ? raw.pedidosJson :
      [];

    let paradasRaw =
      raw.paradas_json !== undefined ? raw.paradas_json :
      raw.paradas !== undefined ? raw.paradas :
      raw.stops !== undefined ? raw.stops :
      [];

    const pedidos = Array.from(new Set(parseMaybeJSON(pedidosRaw).map(cleanPedidoId).filter(Boolean)));
    const paradas = parseMaybeJSON(paradasRaw);

    const idRaw = raw.rota_id || raw.id || raw.token || '';
    const criado = raw.criado_em || raw.criadoEm || raw.created_at || raw.data_criacao || '';
    const atualizado = raw.atualizado_em || raw.atualizadoEm || raw.updated_at || '';
    const dataOperacional = raw.data_operacional || raw.operationalDate || raw.data_rota || raw.data || parseDateISO(criado) || parseDateISO(atualizado);

    return {
      id: txt(idRaw) || ('rota-' + (parseDateISO(criado) || Date.now()) + '-' + pedidos.join('-')),
      rota_id: raw.rota_id || raw.id || '',
      token: raw.token || '',
      nome: raw.nome_rota || raw.nome || raw.rota || raw.name || 'Rota',
      motorista: raw.motorista || raw.driver || '',
      origem: raw.origem || raw.origin || 'Rua São Leopoldo 92',
      pedidos,
      paradas: Array.isArray(paradas) ? paradas : [],
      status: raw.status || raw.situacao || 'ativa',
      data_operacional: parseDateISO(dataOperacional) || parseDateISO(criado) || parseDateISO(atualizado) || '',
      criadoEm: criado,
      atualizadoEm: atualizado
    };
  }

  function hasUsefulRoute(raw){
    const r = normalizeRoute(raw);

    if (!r.pedidos || r.pedidos.length === 0) return false;

    const motorista = norm(r.motorista);
    if (!motorista || motorista === '-' || motorista === '—' || motorista === '---' || motorista === 'undefined' || motorista === 'null') return false;

    return true;
  }

  function routeBelongsDay(raw){
    if (!hasUsefulRoute(raw)) return false;

    const r = normalizeRoute(raw);
    const selectedDate = selectedISO();

    const dates = [
      r.data_operacional,
      r.criadoEm,
      r.atualizadoEm,
      raw && raw.criado_em,
      raw && raw.atualizado_em,
      raw && raw.data_operacional
    ].map(parseDateISO).filter(Boolean);

    if (!dates.length) return false;

    return dates.includes(selectedDate);
  }

  function sanitizeList(list, onlyToday = false){
    if (!Array.isArray(list)) return [];

    const matrixObjects = headersToObjects(list);
    if (matrixObjects) list = matrixObjects;

    const out = [];
    const seen = new Set();

    list.forEach(raw => {
      const r = normalizeRoute(raw);

      if (!hasUsefulRoute(r)) return;
      if (onlyToday && !routeBelongsDay(r)) return;

      const id = String(r.id || r.rota_id || r.token || r.pedidos.join('|'));

      if (seen.has(id)) return;
      seen.add(id);
      out.push(r);
    });

    return out;
  }

  function localRoutes(){
    const merged = [];
    const seen = new Set();

    storageKeys().forEach(key => {
      const arr = readJSON(key, []);
      sanitizeList(arr, false).forEach(r => {
        const id = String(r.id || r.rota_id || r.token || r.pedidos.join('|'));
        if (seen.has(id)) return;
        seen.add(id);
        merged.push(r);
      });
    });

    return merged;
  }

  function limparRotasInvalidasLocais(){
    let combined = [];

    storageKeys().forEach(key => {
      const arr = readJSON(key, []);
      if (!Array.isArray(arr)) return;

      const clean = sanitizeList(arr, false);
      writeJSON(key, clean);
      combined = combined.concat(clean);
    });

    const cleanCombined = sanitizeList(combined, false);

    window.saiuRotas = cleanCombined;

    try { localStorage.setItem(CFG.ROUTES_KEY || 'vesco_saiu_rotas_v1', JSON.stringify(cleanCombined)); } catch(e) {}

    return cleanCombined;
  }

  function saveRoutes(list){
    const clean = sanitizeList(list, false);

    window.saiuRotas = clean;

    writeJSON(CFG.ROUTES_KEY || 'vesco_saiu_rotas_v1', clean);
    writeJSON(CFG.ROUTES_KEY_MODULAR || 'vesco_routes_modular_v2', clean);
  }

  function allRoutes(){
    const merged = [];
    const seen = new Set();

    localRoutes().concat(remoteRoutes).forEach(raw => {
      const r = normalizeRoute(raw);

      if (!hasUsefulRoute(r)) return;

      const id = String(r.id || r.rota_id || r.token || r.pedidos.join('|'));

      if (seen.has(id)) return;
      seen.add(id);
      merged.push(r);
    });

    return merged;
  }

  function eligible(){
    const list = [];

    mainOrders().forEach(o => {
      if (isDelivered(o)) return;
      if (isASeparar(o)) return;
      if (isRetirada(o)) return;
      if (!hasRouteTarget(o)) return;

      const st = norm(getStatus(o));
      const okStatus =
        !st ||
        st.includes('separado') ||
        st.includes('pronto') ||
        st.includes('despachado') ||
        st.includes('pendente de entrega') ||
        st.includes('lancado na plataforma') ||
        st.includes('lançado na plataforma');

      if (!okStatus) return;

      list.push({ order:o, tipo:'normal' });
    });

    flexOrders().forEach(o => {
      if (isDelivered(o)) return;
      if (!hasRouteTarget(o)) return;
      list.push({ order:o, tipo:'flex' });
    });

    const seen = new Set();

    return list.filter(item => {
      const id = getKey(item.order) || getNumber(item.order) || getEcom(item.order);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  function ensureManualBox(){
    const list = document.getElementById('saiu-pedidos-list');
    if (!list) return;

    const parent = list.parentElement;
    if (!parent || document.getElementById('vesco-route-manual-box')) return;

    const box = document.createElement('div');
    box.id = 'vesco-route-manual-box';
    box.className = 'vesco-route-manual-box';
    box.innerHTML = `
      <label>Adicionar na rota por número da venda, pedido Flex ou E-commerce</label>
      <div class="vesco-route-manual-row">
        <input id="vesco-route-manual-input" placeholder="Digite o nº do pedido, venda, ID Flex ou E-commerce">
        <button type="button" id="vesco-route-manual-add"><i class="fas fa-plus"></i> Adicionar</button>
      </div>
      <small>Também encontra pedidos Flex pelo E-commerce.</small>
    `;

    parent.insertBefore(box, list);
  }

  function addManual(){
    const input = document.getElementById('vesco-route-manual-input');
    const value = txt(input && input.value);

    if (!value) return;

    const item = findAnyOrder(value);

    if (!item || !item.order) {
      alert('Pedido não encontrado. Confira o número do pedido, ID Flex ou E-commerce.');
      return;
    }

    if (!hasRouteTarget(item.order)) {
      alert('Esse pedido não possui endereço nem lat/lon. Ele deve ir para Retiradas/Sem rota ou corrigir geocode.');
      return;
    }

    selected.add(getKey(item.order) || getNumber(item.order) || getEcom(item.order) || value);

    if (input) input.value = '';

    render();
  }

  function routePedidoId(o){
    return getNumber(o) || getKey(o) || getEcom(o);
  }

  function routeDisplay(o, tipo){
    const num = getNumber(o) || getKey(o);
    const ecom = getEcom(o);

    if (tipo === 'flex') {
      return ecom && ecom !== num ? `#${num} | E-com: ${ecom}` : `#${num}`;
    }

    return `#${num}`;
  }

  function row(item){
    const o = item.order;
    const id = getKey(o) || getNumber(o) || getEcom(o);
    const checked = selected.has(id) ? 'checked' : '';
    const tipo = item.tipo === 'flex' ? 'Flex' : 'Entrega';
    const badge = item.tipo === 'flex'
      ? '<span class="vesco-chip vesco-flex-chip">Flex</span>'
      : '<span class="vesco-chip">Entrega</span>';

    return `
      <label class="vesco-route-order ${checked ? 'selected' : ''}">
        <input type="checkbox" value="${esc(id)}" ${checked}>
        <div class="min-w-0">
          <div class="font-black">${esc(routeDisplay(o, item.tipo))} <span>${esc(getCliente(o))}</span></div>
          <small>${esc(hasAddress(o) ? getAddress(o) : 'Destino por lat/lon')}</small>
          <div>${badge}<span class="vesco-chip">${esc(tipo)} • ${dateBR(getOrderDate(o))}</span></div>
        </div>
        <button type="button" class="vesco-locate-small" onclick="${item.tipo === 'flex' ? `focusFlexOnMap && focusFlexOnMap('${esc(id)}')` : `VescoMapas && VescoMapas.focusOrder('${esc(id)}')`}">Localizar</button>
      </label>
    `;
  }

  function selectedItem(id){
    const item = findAnyOrder(id);
    if (item) return item;
    return { order:null, tipo:'manual', manual:id };
  }

  function findAnyOrder(value){
    const input = txt(value);
    const plain = input.replace(/^#/, '');
    const d = digits(input);

    if (!input) return null;

    const wanted = new Set([input, plain, d].filter(Boolean));

    for (const item of allRouteOrders()) {
      const ks = orderKeys(item.order);
      if (ks.some(k => wanted.has(k) || (d && digits(k) === d))) {
        return item;
      }
    }

    return null;
  }

  function renderAvailable(){
    ensureManualBox();

    const el = document.getElementById('saiu-pedidos-list');
    if (!el) return;

    const list = eligible();

    el.innerHTML = list.length
      ? list.map(row).join('')
      : `<div class="vesco-empty">Nenhum pedido com endereço disponível para rota.</div>`;
  }

  function renderSelected(){
    const el = document.getElementById('saiu-rota-selected');
    if (!el) return;

    const ids = Array.from(selected);

    if (!ids.length) {
      el.innerHTML = `<div class="vesco-empty compact">Nenhum pedido selecionado.</div>`;
      return;
    }

    el.innerHTML = ids.map(id => {
      const item = selectedItem(id);
      const o = item.order;
      const label = o ? routeDisplay(o, item.tipo) : `#${id}`;
      const cliente = o ? getCliente(o) : 'Manual';

      return `
        <div class="vesco-selected-route-row">
          <span>${esc(label)} <small>${esc(cliente)}${item.tipo === 'flex' ? ' • Flex' : ''}</small></span>
          <button type="button" data-remove-route="${esc(id)}">×</button>
        </div>
      `;
    }).join('');
  }

  function routeHtml(r){
    return `
      <div class="vesco-route-card" data-route-id="${esc(r.id)}">
        <div class="flex justify-between gap-3">
          <div>
            <div class="font-black"><i class="fas fa-route text-blue-600"></i> ${esc(r.nome || 'Rota')}</div>
            <div class="text-xs text-slate-500 mt-1">Motorista: ${esc(r.motorista)} • ${r.pedidos.length} pedido(s)</div>
            <div class="text-xs text-slate-500">Origem: ${esc(r.origem || '—')}</div>
            <div class="text-[10px] text-slate-400">Data: ${dateBR(r.data_operacional || r.criadoEm || selectedISO())}${r.token ? ` • Token: ${esc(r.token)}` : ''}</div>
          </div>
          <div class="flex gap-2">
            <button class="vesco-btn blue" data-start-route="${esc(r.id)}">Iniciar</button>
            <button class="vesco-btn green" data-finish-route="${esc(r.id)}">Concluir</button>
            <button class="vesco-btn danger" data-delete-route="${esc(r.id)}">Remover</button>
          </div>
        </div>
        <div class="text-xs mt-2"><b>Pedidos:</b> ${r.pedidos.map(p => '#'+esc(p)).join(', ')}</div>
      </div>
    `;
  }

  function renderCreated(){
    const el = document.getElementById('saiu-rotas-list');
    if (!el) return;

    limparRotasInvalidasLocais();

    const list = allRoutes().filter(routeBelongsDay);

    if (!list.length) {
      el.innerHTML = `<div class="vesco-empty">Nenhuma rota criada ou ativa para ${dateBR(selectedISO())}.</div>`;
      return;
    }

    el.innerHTML = list.map(routeHtml).join('');
  }

  function findArrayDeep(obj){
    if (Array.isArray(obj)) return obj;
    if (!obj || typeof obj !== 'object') return null;

    const preferred = [
      'rotas',
      'rotasMotorista',
      'RotaMotorista',
      'data',
      'rows',
      'items',
      'result',
      'results',
      'values'
    ];

    for (const k of preferred) {
      if (Array.isArray(obj[k])) return obj[k];

      if (obj[k] && typeof obj[k] === 'object') {
        const x = findArrayDeep(obj[k]);
        if (x) return x;
      }
    }

    for (const k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      const x = findArrayDeep(obj[k]);
      if (x) return x;
    }

    return null;
  }

  async function callERP(params){
    if (window.VescoAPI && window.VescoAPI.callERP) return window.VescoAPI.callERP(params);
    return { ok:false, response:null };
  }

  async function updateStatus(id, status, obs){
    if (window.VescoAPI && window.VescoAPI.updateStatus) return window.VescoAPI.updateStatus(id, status, obs);
    return { ok:false };
  }

  async function loadRemoteRoutes(force = false){
    if (remoteLoading) return remoteRoutes;
    if (!force && Date.now() - remoteLoadedAt < 45000) return remoteRoutes;

    remoteLoading = true;

    const actions = [
      'listarRotasMotorista',
      'rotasMotorista',
      'getRotasMotorista',
      'listRotaMotorista',
      'getSheet',
      'readSheet',
      'listarAba',
      'lerAba',
      'rotas',
      'listarRotas',
      'getRotas',
      'listRotas'
    ];

    let found = [];

    for (const action of actions) {
      try {
        const res = await callERP({
          action,
          sheet: 'RotasMotorista',
          aba: 'RotasMotorista',
          data: dateBR(selectedISO()),
          dataISO: selectedISO(),
          date: selectedISO()
        });

        const arr = res && res.response ? findArrayDeep(res.response) : null;

        if (Array.isArray(arr) && arr.length) {
          const clean = sanitizeList(arr, true);

          if (clean.length) {
            found = clean;
            break;
          }
        }
      } catch(e) {}
    }

    remoteRoutes = found;
    remoteLoadedAt = Date.now();
    remoteLoading = false;

    try {
      writeJSON(CFG.ROUTES_REMOTE_CACHE_KEY || 'vesco_routes_remote_cache_v2', remoteRoutes);
    } catch(e) {}

    renderCreated();

    return remoteRoutes;
  }

  function bindButton(){
    const btn = document.getElementById('btnCriarRota');

    if (btn && !btn.__vescoRotasBoundV35) {
      btn.__vescoRotasBoundV35 = true;
      btn.textContent = 'Montar rota selecionada';
      btn.onclick = createRoute;
      btn.addEventListener('click', createRoute, true);
    }

    const add = document.getElementById('vesco-route-manual-add');

    if (add && !add.__vescoManualBoundV35) {
      add.__vescoManualBoundV35 = true;
      add.addEventListener('click', addManual, true);
    }

    const input = document.getElementById('vesco-route-manual-input');

    if (input && !input.__vescoManualEnterV35) {
      input.__vescoManualEnterV35 = true;
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          addManual();
        }
      });
    }
  }

  function selectedOrdersForRoute(){
    const out = [];

    Array.from(selected).forEach(id => {
      const item = selectedItem(id);
      if (!item || !item.order) return;
      if (!hasRouteTarget(item.order)) return;
      out.push(item);
    });

    const seen = new Set();

    return out.filter(item => {
      const rid = routePedidoId(item.order);
      if (!rid || seen.has(rid)) return false;
      seen.add(rid);
      return true;
    });
  }

  async function createRoute(e){
    if (e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    }

    const itens = selectedOrdersForRoute();

    if (!itens.length) return alert('Selecione ao menos um pedido com endereço ou lat/lon para montar a rota.');

    const motorista = txt(document.getElementById('rotaMotorista')?.value);
    if (!motorista) return alert('Informe o motorista.');

    const nome = txt(document.getElementById('rotaNome')?.value) || `Rota ${new Date().toLocaleString('pt-BR')}`;
    const origem = txt(
      document.getElementById('vesco-rota-origem-v6')?.value ||
      document.getElementById('rotaOrigem')?.value ||
      'Rua São Leopoldo 92'
    );

    const pedidos = itens.map(item => routePedidoId(item.order)).filter(Boolean);

    const paradas = itens.map(item => {
      const o = item.order;
      const c = coords(o);

      return {
        pedido: routePedidoId(o),
        tipo: item.tipo,
        ecom: getEcom(o),
        cliente: getCliente(o),
        endereco: getAddress(o),
        lat: c ? c.lat : '',
        lon: c ? c.lon : ''
      };
    });

    const r = {
      id: 'rota-' + Date.now(),
      token: Math.random().toString(36).slice(2, 10).toUpperCase(),
      nome,
      motorista,
      origem,
      pedidos: Array.from(new Set(pedidos)),
      paradas,
      status: 'ativa',
      data_operacional: selectedISO(),
      criadoEm: new Date().toISOString()
    };

    const all = allRoutes().filter(x => String(x.id) !== String(r.id));
    all.push(r);

    saveRoutes(all);

    selected.clear();

    render();

    callERP({
      action: 'criarRotaMotorista',
      rota_id: r.id,
      token: r.token,
      nome_rota: r.nome,
      nome: r.nome,
      motorista: r.motorista,
      origem: r.origem,
      pedidos: JSON.stringify(r.pedidos),
      pedidos_json: JSON.stringify(r.pedidos),
      paradas: JSON.stringify(r.paradas || []),
      paradas_json: JSON.stringify(r.paradas || []),
      status: r.status,
      criado_em: r.criadoEm,
      data_operacional: r.data_operacional
    }).then(() => loadRemoteRoutes(true)).catch(() => {});

    for (const item of itens) {
      if (item.tipo !== 'flex') {
        await updateStatus(routePedidoId(item.order), 'Despachado', `Saiu para entrega — Rota: ${r.nome} Motorista: ${r.motorista} Origem: ${r.origem}`);
      }
    }

    try {
      if (typeof showToast === 'function') showToast(`Rota criada com ${r.pedidos.length} pedido(s).`, 'success');
    } catch(e) {}
  }

  function handleChange(e){
    const cb = e.target && e.target.closest && e.target.closest('#saiu-pedidos-list input[type="checkbox"]');
    if (!cb) return;

    if (cb.checked) selected.add(cb.value);
    else selected.delete(cb.value);

    renderSelected();
    renderAvailable();
    bindButton();
  }

  function handleClick(e){
    const remove = e.target && e.target.closest && e.target.closest('[data-remove-route]');
    const del = e.target && e.target.closest && e.target.closest('[data-delete-route]');
    const start = e.target && e.target.closest && e.target.closest('[data-start-route]');
    const finish = e.target && e.target.closest && e.target.closest('[data-finish-route]');

    if (remove) {
      selected.delete(remove.dataset.removeRoute);
      render();
      return;
    }

    if (del || start || finish) {
      const id =
        (del && del.dataset.deleteRoute) ||
        (start && start.dataset.startRoute) ||
        (finish && finish.dataset.finishRoute);

      const list = localRoutes();
      const idx = list.findIndex(r => String(r.id) === String(id));

      if (idx >= 0) {
        if (del) list.splice(idx, 1);
        if (start) list[idx].status = 'despachada';
        if (finish) {
          list[idx].status = 'concluida';
          list[idx].concluidaEm = new Date().toISOString();
        }

        saveRoutes(list);
        renderCreated();
      }
    }
  }

  function hideMontarRotasPanel(){
    Array.from(document.querySelectorAll('button, a, .tab-btn')).forEach(el => {
      const t = norm(el.textContent);
      const id = norm(el.id || '');

      if (
        t.includes('montar rotas') ||
        id.includes('main-rotas') ||
        id.includes('main-montar')
      ) {
        el.style.display = 'none';
        el.classList.add('hidden');
        el.setAttribute('data-vesco-hidden-montar-rotas', 'true');
      }
    });

    Array.from(document.querySelectorAll('section, div')).forEach(el => {
      const id = norm(el.id || '');

      if (
        id === 'view-rotas' ||
        id === 'view-montar_rotas' ||
        id === 'view-montar-rotas'
      ) {
        el.classList.add('hidden');
        el.style.display = 'none';
        el.setAttribute('data-vesco-hidden-montar-rotas', 'true');
      }
    });
  }

  function wrapSwitch(){
    if (window.__vescoRotasSwitchWrappedV35 || typeof window.switchTab !== 'function') return;

    window.__vescoRotasSwitchWrappedV35 = true;

    const old = window.switchTab;

    window.switchTab = function(which){
      if (which === 'rotas' || which === 'montar_rotas' || which === 'montar-rotas') {
        return old.call(this, 'saiu');
      }

      const res = old.apply(this, arguments);

      if (which === 'saiu') {
        setTimeout(() => {
          render();
          loadRemoteRoutes(true);
        }, 150);
      }

      setTimeout(hideMontarRotasPanel, 60);

      return res;
    };

    try { switchTab = window.switchTab; } catch(e) {}
  }

  function render(){
    limparRotasInvalidasLocais();
    hideMontarRotasPanel();
    renderAvailable();
    renderSelected();
    renderCreated();
    bindButton();
    setTimeout(() => loadRemoteRoutes(false), 120);
  }

  function isRouteTabActive(){
    const active = norm(document.querySelector('.tab-btn.active,button.active,a.active')?.textContent || '');
    return active.includes('pronto') || active.includes('rota');
  }

  function init(){
    limparRotasInvalidasLocais();
    hideMontarRotasPanel();

    document.removeEventListener('change', handleChange, true);
    document.addEventListener('change', handleChange, true);

    document.removeEventListener('click', handleClick, true);
    document.addEventListener('click', handleClick, true);

    wrapSwitch();

    window.renderRotas = render;
    window.renderRotasCriadas = renderCreated;

    try { renderRotas = window.renderRotas; } catch(e) {}

    window.addEventListener('vesco:rendered', () => setTimeout(render, 200));
    window.addEventListener('vesco:loaded', () => setTimeout(render, 700));

    setTimeout(() => {
      hideMontarRotasPanel();
      render();
      loadRemoteRoutes(true);
    }, 600);

    setInterval(() => {
      hideMontarRotasPanel();

      if (isRouteTabActive()) {
        limparRotasInvalidasLocais();
        renderCreated();
        bindButton();
      }
    }, 1200);

    if (!document.getElementById('vesco-rotas-v35-css')) {
      const style = document.createElement('style');
      style.id = 'vesco-rotas-v35-css';
      style.textContent = `
        [data-vesco-hidden-montar-rotas="true"] { display: none !important; }
        .vesco-flex-chip {
          background: #fff7ed !important;
          border-color: #fed7aa !important;
          color: #ea580c !important;
        }
      `;
      document.head.appendChild(style);
    }
  }

  window.VescoRotasModular = {
    __v35: true,
    init,
    render,
    renderCreated,
    createRoute,
    selected,
    eligible,
    routes: allRoutes,
    localRoutes,
    loadRemoteRoutes,
    remoteRoutes: () => remoteRoutes,
    limparRotasInvalidasLocais,
    sanitizeList,
    routeBelongsDay,
    hideMontarRotasPanel,
    findAnyOrder,
    headersToObjects,
    debug(){
      return {
        version: 'V3.5',
        selectedDate: selectedISO(),
        selected: Array.from(selected),
        flexTotal: flexOrders().length,
        eligible: eligible().map(item => ({
          tipo: item.tipo,
          numero: getNumber(item.order),
          ecom: getEcom(item.order),
          key: getKey(item.order),
          address: getAddress(item.order),
          coords: coords(item.order)
        })),
        local: localRoutes(),
        remote: remoteRoutes,
        displayed: allRoutes().filter(routeBelongsDay),
        storageKeys: storageKeys()
      };
    }
  };

  init();

  console.log('modulo.rotas V3.5 ativo — rotas da planilha robustas + Flex na rota.');
})();
