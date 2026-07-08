// modulo.logistica.js — V3.7
// Correção final do mapa da Logística:
// - A tabela e o mapa usam EXATAMENTE a mesma lista filtrada.
// - Bloqueia o plotMapMarkers legado quando a aba Logística está aberta.
// - Bloqueia geocodeAddress legado na aba Logística para não geocodificar pedido entregue/fora da tabela.
// - Limpa clusters/markers antigos do Leaflet e redesenha somente os pedidos a entregar.
// - Não mexe em Flex nem Rotas fora da aba Logística.

(function(){
  const S = () => window.VescoState;
  const A = () => window.VescoAPI;

  let layer = null;
  let lastFitKey = '';
  let legacyInstalled = false;
  let originalPlotMapMarkers = null;
  let originalGeocodeAddress = null;

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
      if (S() && S().esc) return S().esc(v);
    } catch(e) {}

    return txt(v).replace(/[&<>"']/g, m => ({
      '&':'&amp;',
      '<':'&lt;',
      '>':'&gt;',
      '"':'&quot;',
      "'":'&#39;'
    }[m]));
  }

  function selectedISO(){
    try {
      if (S() && S().selectedDateISO) return S().selectedDateISO();
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
      if (S() && S().dateBR) return S().dateBR(v);
    } catch(e) {}

    const s = txt(v);
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;

    return s || '—';
  }

  function getOrders(){
    try {
      if (S() && S().orders) return S().orders();
    } catch(e) {}

    try { if (Array.isArray(window.orders)) return window.orders; } catch(e) {}
    try { if (typeof orders !== 'undefined' && Array.isArray(orders)) return orders; } catch(e) {}

    return [];
  }

  function getKey(o){
    try {
      if (S() && S().getKey) return S().getKey(o);
    } catch(e) {}

    return txt(o && (o.id || o.pedido_key || o.numero || o.id_tiny || ''));
  }

  function getNumber(o){
    try {
      if (S() && S().getNumber) return S().getNumber(o);
    } catch(e) {}

    return txt(o && (o.numero || o.pedido || o.id_tiny || o.id || ''));
  }

  function getStatus(o){
    try {
      if (S() && S().getStatus) return S().getStatus(o);
    } catch(e) {}

    return txt(o && (
      o.status_logistica ||
      o.situacao_nome ||
      o.status_operacional ||
      o.status ||
      o.situacao ||
      o.situacao_tiny ||
      ''
    ));
  }

  function getAddress(o){
    try {
      if (S() && S().getAddress) return S().getAddress(o);
    } catch(e) {}

    return txt(o && (o.endereco_completo || o.endereco || o.address || o.full_address || ''));
  }

  function getCliente(o){
    return txt(o && (o.cliente_nome || o.destinatario || o.cliente || o.nome || '—'));
  }

  function getOrderDate(o){
    try {
      if (S() && S().getOrderDate) return S().getOrderDate(o);
    } catch(e) {}

    return txt(o && (
      o.data_prevista ||
      o.data_previsao ||
      o.previsao ||
      o.data_pedido ||
      o.data ||
      o.created_at ||
      o.criado_em ||
      ''
    ));
  }

  function hasAddress(o){
    try {
      if (S() && S().hasAddress) return S().hasAddress(o);
    } catch(e) {}

    const a = norm(getAddress(o));

    if (!a || a === '-' || a === '—') return false;
    if (a.includes('endereco nao disponivel')) return false;
    if (a.includes('endereço não disponível')) return false;
    if (a.includes('endereco indisponivel')) return false;
    if (a.includes('sem endereco')) return false;
    if (a.includes('sem endereço')) return false;

    return true;
  }

  function coords(o){
    const latRaw = o && (
      o.lat ?? o.latitude ?? o.lat_destino ?? o.latitude_destino ?? o.geo_lat
    );
    const lonRaw = o && (
      o.lon ?? o.lng ?? o.longitude ?? o.lon_destino ?? o.lng_destino ?? o.longitude_destino ?? o.geo_lon
    );

    const lat = parseFloat(String(latRaw ?? '').replace(',', '.'));
    const lon = parseFloat(String(lonRaw ?? '').replace(',', '.'));

    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
    return null;
  }

  function isDelivered(o){
    try {
      if (S() && S().isDelivered && S().isDelivered(o)) return true;
    } catch(e) {}

    const st = norm(getStatus(o));

    if (st.includes('pendente de entrega')) return false;

    const statusEntregue =
      st === 'entregue' ||
      st === 'finalizado' ||
      st === 'concluido' ||
      st === 'concluído' ||
      st.includes('entrega realizada') ||
      st.includes('retirada registrada') ||
      st.includes('concluida') ||
      st.includes('concluída');

    const entreguePorData = !!txt(o && (
      o.data_entregue ||
      o.entregue_em ||
      o.finalizado_em ||
      o.data_finalizado ||
      o.data_entrega_realizada
    ));

    return statusEntregue || entreguePorData;
  }

  function isASeparar(o){
    try {
      if (S() && S().isASeparar) return S().isASeparar(o);
    } catch(e) {}

    const st = norm(getStatus(o));
    return st.includes('a separar') || st.includes('em separacao') || st.includes('em separação');
  }

  function isRetirada(o){
    try {
      if (S() && S().isRetirada) return S().isRetirada(o);
    } catch(e) {}

    const raw = [
      o && o.id_forma_envio,
      o && o.idFormaEnvio,
      o && o.idFormaEnvioPsq,
      o && o.forma_envio_id,
      o && o.forma_envio_nome,
      o && o.nome_forma_envio,
      o && o.nomeformafenvio,
      o && o.transportadora,
      o && o.tipo_entrega,
      o && o.prioridade_label
    ].map(txt).filter(Boolean).join(' | ');

    const f = norm(raw);
    const ids = ['747632298', '758290131', '860463094'];

    if (ids.some(id => raw.includes(id))) return true;

    return (
      f.includes('retirar pessoalmente') ||
      f.includes('retirada') ||
      f.includes('retirar na loja') ||
      f.includes('cliente retira') ||
      f.includes('retirar')
    );
  }

  function isFlex(o){
    const f = norm([
      o && o.nomeformafenvio,
      o && o.nome_forma_envio,
      o && o.forma_envio,
      o && o.forma_envio_nome,
      o && o.transportadora,
      o && o.tipo_entrega,
      o && o.prioridade_label
    ].map(txt).filter(Boolean).join(' | '));

    return f.includes('mercado envios flex') || f.includes('envios flex') || f.includes(' flex');
  }

  function belongsDate(o){
    const d = parseDateISO(getOrderDate(o));

    if (!d) return true;

    return d === selectedISO();
  }

  function shouldShow(o){
    if (!o) return false;
    if (isDelivered(o)) return false;
    if (isRetirada(o)) return false;
    if (isFlex(o)) return false;
    if (!hasAddress(o)) return false;
    if (isASeparar(o)) return false;
    if (!belongsDate(o)) return false;

    const st = norm(getStatus(o));

    if (!st) return true;

    return (
      st.includes('separado') ||
      st.includes('pronto') ||
      st.includes('despachado') ||
      st.includes('pendente de entrega') ||
      st.includes('lancado na plataforma') ||
      st.includes('lançado na plataforma')
    );
  }

  function filtered(){
    const q = norm(document.getElementById('search')?.value || '');

    return getOrders()
      .filter(shouldShow)
      .filter((o, idx, arr) => arr.findIndex(x => String(getKey(x)) === String(getKey(o))) === idx)
      .filter(o => {
        if (!q) return true;

        const hay = norm([
          getKey(o),
          getNumber(o),
          getCliente(o),
          getAddress(o),
          getStatus(o),
          o && o.numero_ecommerce,
          o && o.ecom
        ].join(' | '));

        return hay.includes(q);
      });
  }

  function isLogisticaActive(){
    const view = document.getElementById('view-logistica');
    if (view && !view.classList.contains('hidden') && view.style.display !== 'none') return true;

    const active = norm(document.querySelector('.tab-btn.active, button.active, a.active')?.textContent || '');
    return active.includes('logistica') || active.includes('logística');
  }

  function getMap(){
    return window.map || window.mapLogistica || window.mainMap || null;
  }

  function clearLegacyCollections(){
    const names = [
      'markerCluster',
      'markersCluster',
      'clusterMarkers',
      'mainMarkerCluster',
      'logisticaMarkerCluster',
      'activeMainMarkers',
      'mapMarkers',
      'markers',
      'routeLayer',
      'routeLayerV13'
    ];

    names.forEach(name => {
      try {
        const obj = window[name];

        if (!obj) return;

        if (Array.isArray(obj)) obj.length = 0;
        else if (typeof obj.clearLayers === 'function') obj.clearLayers();
        else if (typeof obj === 'object') {
          Object.keys(obj).forEach(k => delete obj[k]);
        }
      } catch(e) {}
    });
  }

  function clearMapOverlays(){
    const mapObj = getMap();

    if (!mapObj || typeof L === 'undefined') return;

    clearLegacyCollections();

    try {
      mapObj.eachLayer(layerObj => {
        if (!layerObj) return;

        if (L.TileLayer && layerObj instanceof L.TileLayer) return;

        // Remove tudo que não é tile na aba Logística: marker, cluster, layergroup, polyline, circle etc.
        try { mapObj.removeLayer(layerObj); } catch(e) {}
      });
    } catch(e) {}

    layer = null;
  }

  function ensureLayer(){
    const mapObj = getMap();

    if (!mapObj || typeof L === 'undefined') return null;

    if (!layer) {
      layer = L.layerGroup();
      layer.__vescoLogisticaLayer = true;
    }

    if (!mapObj.hasLayer(layer)) {
      layer.addTo(mapObj);
    }

    return layer;
  }

  function markerIcon(index){
    if (typeof L === 'undefined') return undefined;

    return L.divIcon({
      className: '',
      html: `<div style="
        width:30px;height:30px;border-radius:999px;
        background:#2563eb;color:#fff;
        display:flex;align-items:center;justify-content:center;
        font-size:12px;font-weight:900;
        border:2px solid #fff;
        box-shadow:0 6px 16px rgba(37,99,235,.38);
      ">${index}</div>`,
      iconSize: [30,30],
      iconAnchor: [15,15]
    });
  }

  function renderMap(options){
    options = options || {};

    const mapObj = getMap();

    if (!mapObj || typeof L === 'undefined') return;

    const list = filtered();
    const points = [];

    clearMapOverlays();

    const group = ensureLayer();
    if (!group) return;

    try { group.clearLayers(); } catch(e) {}

    window.vescoLogisticaMarkers = {};

    list.forEach((o, idx) => {
      const c = coords(o);

      if (!c) return;

      const id = getKey(o);
      const numero = getNumber(o) || id;
      const cliente = getCliente(o);
      const endereco = getAddress(o);
      const status = getStatus(o) || 'A entregar';

      const m = L.marker([c.lat, c.lon], {
        title: `#${numero} — ${cliente}`,
        icon: markerIcon(idx + 1)
      });

      m.__vescoLogisticaOwned = true;

      m.bindPopup(`
        <div style="font-size:12px;line-height:1.35;min-width:220px">
          <b>#${esc(numero)} — ${esc(cliente)}</b><br>
          <span>${esc(endereco)}</span><br>
          <small>Status: ${esc(status)}</small>
        </div>
      `);

      m.addTo(group);

      window.vescoLogisticaMarkers[id] = m;
      window.vescoLogisticaMarkers[numero] = m;

      points.push([c.lat, c.lon]);
    });

    try { mapObj.invalidateSize(true); } catch(e) {}

    const fitKey = points.map(p => p.join(',')).join('|');

    if (points.length && (options.forceFit || fitKey !== lastFitKey)) {
      lastFitKey = fitKey;

      setTimeout(() => {
        try {
          if (points.length === 1) mapObj.setView(points[0], 15);
          else mapObj.fitBounds(L.latLngBounds(points).pad(0.18), { maxZoom: 14 });
          mapObj.invalidateSize(true);
        } catch(e) {}
      }, 120);
    }

    updateMapSummary(list.length, points.length);

    // Proteção contra markers que o legado adiciona depois do nosso render.
    if (!options.secondPass) {
      setTimeout(() => renderMap({ secondPass:true }), 350);
      setTimeout(() => renderMap({ secondPass:true }), 950);
    }
  }

  function updateMapSummary(total, pinned){
    let box = document.getElementById('vesco-logistica-map-summary');
    const mapEl = document.getElementById('map') || document.querySelector('#view-logistica .leaflet-container');

    if (!mapEl || !mapEl.parentElement) return;

    if (!box) {
      box = document.createElement('div');
      box.id = 'vesco-logistica-map-summary';
      box.className = 'vesco-map-summary';
      mapEl.parentElement.appendChild(box);
    }

    box.innerHTML = `<b>Entregas no mapa</b><br>${pinned}/${total} pedido(s) a entregar`;
  }

  function focusOrderOnMap(id){
    const mapObj = getMap();

    if (!mapObj) return false;

    const clean = String(id || '').replace(/^#/, '');

    const marker = window.vescoLogisticaMarkers && (
      window.vescoLogisticaMarkers[id] ||
      window.vescoLogisticaMarkers[clean]
    );

    if (marker && marker.getLatLng) {
      try {
        if (typeof switchTab === 'function') switchTab('logistica');
      } catch(e) {}

      setTimeout(() => {
        try {
          mapObj.setView(marker.getLatLng(), 17);
          marker.openPopup();
          mapObj.invalidateSize(true);
        } catch(e) {}
      }, 160);

      return true;
    }

    return false;
  }

  function installLegacyBlockers(){
    if (legacyInstalled) return;
    legacyInstalled = true;

    // Bloqueia o plotMapMarkers antigo APENAS na aba Logística.
    try {
      originalPlotMapMarkers = window.plotMapMarkers || (typeof plotMapMarkers === 'function' ? plotMapMarkers : null);

      if (typeof originalPlotMapMarkers === 'function') {
        window.plotMapMarkers = function(orderList, flexList){
          if (isLogisticaActive()) {
            setTimeout(() => renderMap({ forceFit:false }), 50);
            return true;
          }

          return originalPlotMapMarkers.apply(this, arguments);
        };

        try { plotMapMarkers = window.plotMapMarkers; } catch(e) {}
      }
    } catch(e) {}

    // Bloqueia geocodeAddress legado na aba Logística para impedir geocode de entregues/fora da tabela.
    try {
      originalGeocodeAddress = window.geocodeAddress || (typeof geocodeAddress === 'function' ? geocodeAddress : null);

      if (typeof originalGeocodeAddress === 'function') {
        window.geocodeAddress = async function(address){
          if (isLogisticaActive()) {
            // A logística deve usar apenas lat/lon já carregados dos pedidos filtrados.
            return null;
          }

          return originalGeocodeAddress.apply(this, arguments);
        };

        try { geocodeAddress = window.geocodeAddress; } catch(e) {}
      }
    } catch(e) {}
  }

  function fixHeader(){
    const table = document.getElementById('table-logistica')?.closest('table');
    if (!table) return;

    const thead = table.querySelector('thead');
    if (!thead) return;

    thead.innerHTML = `
      <tr class="text-white font-bold text-xs bg-slate-800 border-b border-slate-700 uppercase">
        <th class="p-3 pl-4">Pedido #</th>
        <th class="p-3 text-center">Data do pedido</th>
        <th class="p-3">Destinatário / Cliente</th>
        <th class="p-3 hidden md:table-cell">Status entrega</th>
        <th class="p-3 hidden md:table-cell">Forma pag.</th>
        <th class="p-3 pr-4 text-right">Ação</th>
      </tr>
    `;
  }

  function obsLink(order){
    try {
      const data = A() && A().getObsCached ? A().getObsCached(order, getKey(order)) : { obs:'', link:'' };

      if (!data || (!data.obs && !data.link)) return '';

      return `
        <div class="vesco-obslink-box">
          ${data.obs ? `<span class="vesco-obs-pill"><b>Obs:</b> ${esc(data.obs)}</span>` : ''}
          ${data.link ? `<a class="vesco-link-pill" href="${esc(data.link)}" target="_blank" rel="noopener noreferrer">Abrir link do pedido</a>` : ''}
        </div>
      `;
    } catch(e) {
      return '';
    }
  }

  function row(o, idx){
    const id = getKey(o);
    const numero = getNumber(o) || id;
    const data = dateBR(getOrderDate(o));
    const endereco = getAddress(o);
    const status = getStatus(o) || 'Separado pendente de entrega';
    const pagamento = txt(o.forma_pagamento || o.instrucao_entrega || o.condicao_acerto || '—');

    return `
      <tr id="log-row-${esc(id)}" class="${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} hover:bg-slate-100/70 text-xs md:text-sm border-b border-slate-100">
        <td class="p-3 pl-4 font-bold text-slate-900">#${esc(numero)}</td>
        <td class="p-3 text-center font-mono text-[#004f9f] font-bold">${esc(data)}</td>
        <td class="p-3">
          <div class="font-semibold">${esc(getCliente(o))}</div>
          <div class="text-[11px] text-slate-500 mt-1 truncate hidden lg:block">${esc(endereco)}</div>
          ${obsLink(o)}
        </td>
        <td class="p-3 hidden md:table-cell">${esc(status)}</td>
        <td class="p-3 hidden md:table-cell align-middle text-xs">
          <span class="px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 text-[11px]">${esc(pagamento)}</span>
        </td>
        <td class="p-3 pr-4 text-right">
          <div class="flex items-center justify-end gap-1.5">
            <button class="bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1.5 rounded-lg font-bold text-[11px]" onclick="focusOrderOnMap('${esc(numero)}')"><i class="fas fa-crosshairs mr-1"></i>Localizar</button>
            <button class="bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1.5 rounded-lg font-bold text-[11px]" onclick="updateStatusJsonp('${esc(id)}','Pronto p/ Entrega')">Concluir</button>
          </div>
        </td>
      </tr>
    `;
  }

  function render(){
    installLegacyBlockers();

    const tbody = document.getElementById('table-logistica');

    if (!tbody) {
      renderMap({ forceFit:false });
      return;
    }

    fixHeader();

    const list = filtered();

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400 font-semibold">Nenhum pedido a entregar para ${dateBR(selectedISO())}.</td></tr>`;
      updateSummary(0);
      renderMap({ forceFit:true });
      return;
    }

    tbody.innerHTML = list.map(row).join('');

    updateSummary(list.length);

    renderMap({ forceFit:false });

    try {
      if (window.VescoObsLink) setTimeout(() => window.VescoObsLink.apply(), 80);
    } catch(e) {}
  }

  function updateSummary(total){
    const el = document.getElementById('sum-total');
    if (el) el.textContent = String(total);
  }

  const oldFocus = window.focusOrderOnMap;
  window.focusOrderOnMap = function(id){
    if (focusOrderOnMap(id)) return true;
    if (typeof oldFocus === 'function' && !isLogisticaActive()) return oldFocus.apply(this, arguments);
    return false;
  };

  function wrapSwitch(){
    if (window.__vescoLogisticaSwitchWrappedV36 || typeof window.switchTab !== 'function') return;

    window.__vescoLogisticaSwitchWrappedV36 = true;

    const old = window.switchTab;

    window.switchTab = function(which){
      const res = old.apply(this, arguments);

      if (which === 'logistica') {
        setTimeout(() => render(), 120);
        setTimeout(() => renderMap({ forceFit:true }), 500);
        setTimeout(() => renderMap({ forceFit:false }), 1200);
      }

      return res;
    };

    try { switchTab = window.switchTab; } catch(e) {}
  }

  function init(){
    installLegacyBlockers();
    wrapSwitch();

    window.addEventListener('vesco:rendered', () => setTimeout(render, 220));
    window.addEventListener('vesco:loaded', () => setTimeout(render, 800));
    window.addEventListener('vesco:obs-link-saved', () => setTimeout(render, 120));

    const search = document.getElementById('search');

    if (search && !search.__vescoLogisticaSearchV36) {
      search.__vescoLogisticaSearchV36 = true;
      search.addEventListener('input', () => setTimeout(render, 80));
    }

    setInterval(() => {
      if (isLogisticaActive()) {
        render();
      }
    }, 1800);

    setTimeout(render, 700);
  }

  window.VescoLogisticaModular = {
    __v37: true,
    init,
    render,
    renderMap,
    shouldShow,
    filtered,
    clearMapOverlays,
    focusOrderOnMap,
    isDelivered,
    debug(){
      const list = filtered();

      return {
        version: 'V3.7',
        selectedDate: selectedISO(),
        totalOrders: getOrders().length,
        filteredCount: list.length,
        mapMarkers: window.vescoLogisticaMarkers ? Object.keys(window.vescoLogisticaMarkers).length : 0,
        active: isLogisticaActive(),
        filtered: list.map(o => ({
          id: getKey(o),
          numero: getNumber(o),
          status: getStatus(o),
          data: getOrderDate(o),
          delivered: isDelivered(o),
          retirada: isRetirada(o),
          flex: isFlex(o),
          address: getAddress(o),
          coords: coords(o)
        }))
      };
    }
  };

  init();

  console.log('modulo.logistica V3.7 ativo — bloqueio do mapa legado e somente pedidos a entregar.');
})();


/* ============================================================================
   VESCO LOGÍSTICA — MAPA NATURAL V3.7 TAIL
   Ajuste pós V3.6: mantém zoom do usuário mais natural e reforça que o mapa usa
   somente a lista filtrada da tabela.
   ============================================================================ */
(function(){
  if (window.__vescoLogisticaNaturalTailV37) return;
  window.__vescoLogisticaNaturalTailV37 = true;

  function run(){
    try {
      if (window.VescoLogisticaModular && typeof window.VescoLogisticaModular.renderMap === 'function') {
        window.VescoLogisticaModular.renderMap({ forceFit: false });
      }
    } catch(e) {}
  }

  window.addEventListener('vesco:loaded', () => setTimeout(run, 1000));
  window.addEventListener('vesco:rendered', () => setTimeout(run, 400));

  console.log('Logística V3.7 tail ativo — mapa sem resetar zoom desnecessariamente.');
})();
