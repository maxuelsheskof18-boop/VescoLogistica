// modulo.flex.js — V3.7
// Mapa Flex natural:
// - Usa somente pedidos Flex carregados.
// - Clique no pedido/Localizar centraliza no pin.
// - Se faltar lat/lon, tenta geocode unitário via Apps Script (?action=geocode), sem Nominatim/CORS.
// - Não mexe na Logística.

(function(){
  if (window.VescoFlexModular && window.VescoFlexModular.__v37) return;

  let flexLayer = null;
  let lastFitKey = '';
  let oldFocusFlex = window.focusFlexOnMap;

  function txt(v){ return v === null || v === undefined ? '' : String(v).trim(); }

  function norm(v){
    return txt(v).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
  }

  function esc(v){
    try {
      if (window.VescoState && window.VescoState.esc) return window.VescoState.esc(v);
    } catch(e) {}
    return txt(v).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  function digits(v){ return txt(v).replace(/\D/g, ''); }

  function getFlexOrders(){
    try {
      if (window.VescoState && typeof window.VescoState.flexOrders === 'function') {
        const a = window.VescoState.flexOrders();
        if (Array.isArray(a)) return a;
      }
    } catch(e) {}

    try { if (Array.isArray(window.flexOrders)) return window.flexOrders; } catch(e) {}
    try { if (typeof flexOrders !== 'undefined' && Array.isArray(flexOrders)) return flexOrders; } catch(e) {}

    // Alguns app.js antigos guardam em nomes diferentes.
    const candidates = ['flexPedidos','pedidosFlex','enviosFlex','ordersFlex'];
    for (const k of candidates) {
      try {
        if (Array.isArray(window[k])) return window[k];
      } catch(e) {}
    }

    return [];
  }

  function getStatus(o){
    return txt(o && (o.status_logistica || o.status || o.situacao_nome || o.situacao || o.status_operacional || ''));
  }

  function isDelivered(o){
    const st = norm(getStatus(o));

    if (st.includes('pendente de entrega') || st.includes('pronto para envio') || st.includes('pronto para envio')) return false;

    return (
      st === 'entregue' ||
      st === 'finalizado' ||
      st === 'concluido' ||
      st === 'concluído' ||
      st.includes('entregue') ||
      st.includes('concluido') ||
      st.includes('concluído') ||
      !!txt(o && (o.entregue_em || o.data_entregue || o.data_entrega_realizada || o.finalizado_em))
    );
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
      o.referencia ||
      o.reference ||
      o.order_reference ||
      ''
    ));
  }

  function getCliente(o){
    return txt(o && (o.cliente_nome || o.destinatario || o.cliente || o.nome || o.receiver || o.recipient || 'Cliente não informado'));
  }

  function getAddress(o){
    return txt(o && (
      o.endereco_completo ||
      o.endereco ||
      o.address ||
      o.full_address ||
      o.logradouro ||
      o.destino ||
      ''
    ));
  }

  function hasValidAddress(o){
    const a = norm(getAddress(o));
    if (!a || a === '-' || a === '—') return false;
    if (a.includes('endereco nao disponivel') || a.includes('endereço não disponível')) return false;
    if (a.includes('sem endereco') || a.includes('sem endereço')) return false;
    return true;
  }

  function coords(o){
    const latRaw = o && (o.lat ?? o.latitude ?? o.latitude_local ?? o.lat_destino ?? o.latitude_destino ?? o.geo_lat);
    const lonRaw = o && (o.lon ?? o.lng ?? o.longitude ?? o.longitude_local ?? o.lon_destino ?? o.lng_destino ?? o.longitude_destino ?? o.geo_lon);
    const lat = parseFloat(String(latRaw ?? '').replace(',', '.'));
    const lon = parseFloat(String(lonRaw ?? '').replace(',', '.'));
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
    return null;
  }

  function setCoords(o, lat, lon){
    if (!o) return;
    o.lat = lat;
    o.lon = lon;
    o.latitude = lat;
    o.longitude = lon;
  }

  function keys(o){
    const vals = [
      getKey(o),
      getNumber(o),
      getEcom(o),
      o && o.id,
      o && o.id_tiny,
      o && o.pedido_key,
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

  function findFlex(value){
    const v = txt(value);
    const d = digits(v);
    if (!v) return null;

    return filtered(false).find(o => keys(o).some(k => k === v || k === v.replace(/^#/, '') || (d && digits(k) === d))) ||
           getFlexOrders().find(o => keys(o).some(k => k === v || k === v.replace(/^#/, '') || (d && digits(k) === d))) ||
           null;
  }

  function filtered(requireCoords){
    const list = getFlexOrders()
      .filter(o => !isDelivered(o))
      .filter((o, idx, arr) => arr.findIndex(x => String(getKey(x) || getNumber(x) || getEcom(x)) === String(getKey(o) || getNumber(o) || getEcom(o))) === idx);

    return requireCoords ? list.filter(o => !!coords(o)) : list;
  }

  function allLeafletMaps(){
    if (typeof L === 'undefined' || !L.Map) return [];
    const out = [];

    const names = ['mapFlex','flexMap','mapEnviosFlex','enviosFlexMap','map_flex','mapaFlex'];
    names.forEach(k => {
      try { if (window[k] && window[k] instanceof L.Map && !out.includes(window[k])) out.push(window[k]); } catch(e) {}
    });

    try {
      Object.keys(window).forEach(k => {
        try {
          if (window[k] && window[k] instanceof L.Map && !out.includes(window[k])) out.push(window[k]);
        } catch(e) {}
      });
    } catch(e) {}

    return out;
  }

  function mapByView(){
    const maps = allLeafletMaps();
    const flexRoots = [
      document.getElementById('view-envios_flex'),
      document.getElementById('view-flex'),
      document.getElementById('envios-flex'),
      document.querySelector('[data-view="envios_flex"]')
    ].filter(Boolean);

    for (const m of maps) {
      try {
        const c = m.getContainer();
        if (flexRoots.some(root => root.contains(c))) return m;
        const id = norm(c.id || '');
        if (id.includes('flex')) return m;
      } catch(e) {}
    }

    return maps.find(m => {
      try {
        const id = norm(m.getContainer().id || '');
        return id.includes('flex');
      } catch(e) { return false; }
    }) || null;
  }

  function getMap(){
    return mapByView();
  }

  function clearFlexOverlays(mapObj){
    if (!mapObj || typeof L === 'undefined') return;

    try {
      mapObj.eachLayer(layer => {
        if (!layer) return;
        if (L.TileLayer && layer instanceof L.TileLayer) return;
        try { mapObj.removeLayer(layer); } catch(e) {}
      });
    } catch(e) {}

    flexLayer = null;
  }

  function ensureLayer(mapObj){
    if (!mapObj || typeof L === 'undefined') return null;
    if (!flexLayer) {
      flexLayer = L.layerGroup();
      flexLayer.__vescoFlexOwned = true;
    }
    if (!mapObj.hasLayer(flexLayer)) flexLayer.addTo(mapObj);
    return flexLayer;
  }

  function icon(i){
    if (typeof L === 'undefined') return undefined;
    return L.divIcon({
      className: '',
      html: `<div style="
        width:30px;height:30px;border-radius:999px;
        background:#f59e0b;color:#111827;
        display:flex;align-items:center;justify-content:center;
        font-size:12px;font-weight:900;
        border:2px solid #fff;
        box-shadow:0 6px 16px rgba(245,158,11,.4);
      ">F</div>`,
      iconSize: [30,30],
      iconAnchor: [15,15]
    });
  }

  function renderMap(options){
    options = options || {};
    const mapObj = getMap();
    if (!mapObj || typeof L === 'undefined') return false;

    const list = filtered(true);
    const points = [];

    clearFlexOverlays(mapObj);
    const group = ensureLayer(mapObj);
    if (!group) return false;

    try { group.clearLayers(); } catch(e) {}

    window.vescoFlexMarkers = {};

    list.forEach((o, idx) => {
      const c = coords(o);
      if (!c) return;

      const id = getKey(o) || getNumber(o) || getEcom(o);
      const numero = getNumber(o) || id;
      const ecom = getEcom(o);
      const cliente = getCliente(o);
      const endereco = getAddress(o);

      const m = L.marker([c.lat, c.lon], {
        title: `Flex #${numero} — ${cliente}`,
        icon: icon(idx + 1)
      });

      m.bindPopup(`
        <div style="font-size:12px;line-height:1.35;min-width:230px">
          <b>Flex #${esc(numero)} — ${esc(cliente)}</b><br>
          ${ecom ? `<small>E-com: ${esc(ecom)}</small><br>` : ''}
          <span>${esc(endereco || 'Endereço por coordenada')}</span><br>
          <small>Status: ${esc(getStatus(o) || 'Flex')}</small>
        </div>
      `);

      m.addTo(group);

      keys(o).forEach(k => window.vescoFlexMarkers[k] = m);
      points.push([c.lat, c.lon]);
    });

    try { mapObj.invalidateSize(true); } catch(e) {}

    const fitKey = points.map(p => p.join(',')).join('|');
    if (points.length && (options.forceFit || (options.fitOnce && fitKey !== lastFitKey))) {
      lastFitKey = fitKey;
      setTimeout(() => {
        try {
          if (points.length === 1) mapObj.setView(points[0], 15);
          else mapObj.fitBounds(L.latLngBounds(points).pad(0.16), { maxZoom: 14 });
          mapObj.invalidateSize(true);
        } catch(e) {}
      }, 120);
    }

    updateSummary(filtered(false).length, points.length);
    hydrateButtons();

    return true;
  }

  function updateSummary(total, pinned){
    let box = document.getElementById('vesco-flex-map-summary');
    const mapObj = getMap();
    if (!mapObj) return;

    const container = mapObj.getContainer();
    if (!container || !container.parentElement) return;

    if (!box) {
      box = document.createElement('div');
      box.id = 'vesco-flex-map-summary';
      box.className = 'vesco-map-summary vesco-flex-summary';
      container.parentElement.appendChild(box);
    }

    box.innerHTML = `<b>Frota Envios Flex</b><br>${pinned}/${total} pedido(s) no mapa`;
  }

  async function geocodeOne(order){
    if (!order || coords(order) || !hasValidAddress(order)) return coords(order);

    const address = getAddress(order);

    try {
      if (window.VescoAPI && typeof window.VescoAPI.callERP === 'function') {
        const res = await window.VescoAPI.callERP({ action:'geocode', endereco: address, address });
        const payload = res && (res.response || res);
        const lat = parseFloat(String(payload.lat || payload.latitude || '').replace(',', '.'));
        const lon = parseFloat(String(payload.lon || payload.lng || payload.longitude || '').replace(',', '.'));
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          setCoords(order, lat, lon);
          return { lat, lon };
        }
      }
    } catch(e) {}

    return null;
  }

  async function focusFlexOnMap(id){
    const order = findFlex(id);
    if (!order) {
      if (typeof oldFocusFlex === 'function') {
        try { return oldFocusFlex.apply(this, arguments); } catch(e) {}
      }
      alert('Pedido Flex não encontrado no carregamento atual.');
      return false;
    }

    let c = coords(order);
    if (!c) c = await geocodeOne(order);

    if (!c) {
      alert('Esse pedido Flex ainda não tem lat/lon. Rode a correção de geocode Flex no Apps Script ou confira o endereço.');
      return false;
    }

    try {
      if (typeof switchTab === 'function') switchTab('envios_flex');
    } catch(e) {}

    setTimeout(() => {
      renderMap({ forceFit:false });

      const mapObj = getMap();
      const mk = window.vescoFlexMarkers && keys(order).map(k => window.vescoFlexMarkers[k]).find(Boolean);

      if (mapObj && mk && mk.getLatLng) {
        try {
          mapObj.setView(mk.getLatLng(), 17);
          mk.openPopup();
          mapObj.invalidateSize(true);
        } catch(e) {}
      }
    }, 180);

    return true;
  }

  function hydrateButtons(){
    const roots = [
      document.getElementById('view-envios_flex'),
      document.getElementById('view-flex'),
      document.body
    ].filter(Boolean);

    filtered(false).forEach(o => {
      const ks = keys(o);
      const id = getKey(o) || getNumber(o) || getEcom(o);

      for (const root of roots) {
        const rows = Array.from(root.querySelectorAll('tr, .pedido-card, .flex-card, [data-pedido], [data-id], label'));
        for (const row of rows) {
          const t = row.innerText || '';
          if (!ks.some(k => k && t.includes(k))) continue;
          if (row.querySelector('.vesco-flex-map-btn')) continue;

          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'vesco-flex-map-btn';
          btn.textContent = 'Mapa';
          btn.onclick = ev => {
            ev.preventDefault();
            ev.stopPropagation();
            focusFlexOnMap(id);
          };

          const target = row.querySelector('td:last-child, .acao, .actions, .flex, div:last-child') || row;
          try { target.appendChild(btn); } catch(e) {}
          break;
        }
      }
    });
  }

  function isFlexActive(){
    const view = document.getElementById('view-envios_flex') || document.getElementById('view-flex');
    if (view && !view.classList.contains('hidden') && view.style.display !== 'none') return true;
    const active = norm(document.querySelector('.tab-btn.active, button.active, a.active')?.textContent || '');
    return active.includes('flex');
  }

  function wrapSwitch(){
    if (window.__vescoFlexSwitchWrappedV37 || typeof window.switchTab !== 'function') return;
    window.__vescoFlexSwitchWrappedV37 = true;

    const old = window.switchTab;
    window.switchTab = function(which){
      const res = old.apply(this, arguments);
      const w = norm(which);
      if (w.includes('flex') || w === 'envios_flex') {
        setTimeout(() => renderMap({ fitOnce:true }), 200);
        setTimeout(() => renderMap({ forceFit:false }), 900);
      }
      return res;
    };
    try { switchTab = window.switchTab; } catch(e) {}
  }

  function wrapOldRenderers(){
    ['renderFlex','renderFlexMap','plotFlexMap','renderEnviosFlex'].forEach(name => {
      try {
        const old = window[name];
        if (typeof old === 'function' && !old.__vescoFlexWrappedV37) {
          const wrapped = function(){
            const res = old.apply(this, arguments);
            setTimeout(() => renderMap({ fitOnce:false }), 160);
            setTimeout(hydrateButtons, 300);
            return res;
          };
          wrapped.__vescoFlexWrappedV37 = true;
          window[name] = wrapped;
          try { eval(name + ' = window[name]'); } catch(e) {}
        }
      } catch(e) {}
    });
  }

  window.focusFlexOnMap = function(id){
    return focusFlexOnMap(id);
  };

  function init(){
    wrapSwitch();
    wrapOldRenderers();

    window.addEventListener('vesco:loaded', () => setTimeout(() => renderMap({ fitOnce:true }), 1200));
    window.addEventListener('vesco:rendered', () => setTimeout(() => {
      if (isFlexActive()) renderMap({ forceFit:false });
      hydrateButtons();
    }, 500));

    document.addEventListener('click', e => {
      const btn = e.target && e.target.closest && e.target.closest('button, a, [role="button"]');
      if (!btn) return;
      const t = norm((btn.textContent || '') + ' ' + (btn.getAttribute('onclick') || ''));
      if (t.includes('localizar') || t.includes('mapa')) {
        setTimeout(() => { if (isFlexActive()) renderMap({ forceFit:false }); }, 300);
      }
    }, true);

    setTimeout(() => renderMap({ fitOnce:true }), 1000);
    setTimeout(hydrateButtons, 1500);

    setInterval(() => {
      if (isFlexActive()) {
        renderMap({ forceFit:false });
      } else {
        hydrateButtons();
      }
    }, 5000);
  }

  window.VescoFlexModular = {
    __v37: true,
    init,
    renderMap,
    focusFlexOnMap,
    filtered,
    findFlex,
    hydrateButtons,
    debug(){
      return {
        version: 'V3.7',
        total: getFlexOrders().length,
        filtered: filtered(false).length,
        withCoords: filtered(true).length,
        markers: window.vescoFlexMarkers ? Object.keys(window.vescoFlexMarkers).length : 0,
        active: isFlexActive(),
        sample: filtered(false).slice(0, 10).map(o => ({
          numero: getNumber(o),
          ecom: getEcom(o),
          cliente: getCliente(o),
          status: getStatus(o),
          endereco: getAddress(o),
          coords: coords(o),
          keys: keys(o)
        }))
      };
    }
  };

  init();

  console.log('modulo.flex V3.7 ativo — clique no pedido mostra no mapa Flex.');
})();
