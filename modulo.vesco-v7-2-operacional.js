// modulo.vesco-v7-2-operacional.js
// Correção operacional final sobre a V7: páginas reais, uma navegação, mapas únicos e filtros corretos.

(function(){
  if (window.VescoV72 && window.VescoV72.__v72) return;

  const state = {
    maps: {},
    layers: {},
    markers: { logistica: {}, flex: {} },
    oldGo: null
  };

  function txt(v){ return v === null || v === undefined ? '' : String(v).trim(); }

  function norm(v){
    return txt(v)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g,'')
      .toLowerCase()
      .replace(/\s+/g,' ')
      .trim();
  }

  function esc(v){
    return txt(v).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  function parseISO(v){
    const s = txt(v);
    if (!s) return '';

    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;

    m = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (m) {
      const y = m[3].length === 2 ? '20' + m[3] : m[3];
      return `${y}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
    }

    return '';
  }

  function br(iso){
    const s = parseISO(iso) || txt(iso);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : s || '—';
  }

  function money(v){
    const n = Number(v || 0);
    return n.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
  }

  function parseMoney(v){
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    let s = txt(v);
    if (!s) return 0;

    s = s.replace(/[^\d,.-]/g, '');

    if (s.includes(',') && s.includes('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (s.includes(',')) {
      s = s.replace(',', '.');
    }

    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  }

  function selectedDate(){
    const el = document.getElementById('v7Date') || document.getElementById('topCalendar') || document.querySelector('input[type="date"]');
    if (el && el.value) return parseISO(el.value) || el.value;
    return new Date().toLocaleDateString('en-CA', { timeZone:'America/Sao_Paulo' });
  }

  function setTitle(title, sub){
    const h = document.getElementById('v7Title');
    const s = document.getElementById('v7Sub');

    if (h) h.textContent = title;
    if (s) s.textContent = sub || 'Operação logística em tempo real';
  }

  function setActive(tab){
    document.querySelectorAll('[data-v7tab]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.v7tab === tab);
    });
  }

  function hideViews(){
    document.querySelectorAll('[id^="view-"]').forEach(v => {
      v.classList.add('hidden');
      v.style.display = 'none';
    });
  }

  function showView(id){
    let v = document.getElementById(id);
    if (!v) return null;
    v.classList.remove('hidden');
    v.style.display = '';
    v.classList.add('v72-page');
    return v;
  }

  function ensureOldNavHidden(){
    document.querySelectorAll('.tab-nav, #main-sep, #main-sephoje, #main-log, #main-saiu, #main-tarefas, #main-flex, #main-rotas, #main-mot, #main-ent').forEach(el => {
      el.style.display = 'none';
      el.setAttribute('data-v72-hidden', 'true');
    });
  }

  function arrays(){
    const out = [];
    const add = (name, arr) => {
      if (Array.isArray(arr) && arr.length) out.push([name, arr]);
    };

    try { if (window.VescoV7 && window.VescoV7.orders) add('VescoV7', window.VescoV7.orders()); } catch(e) {}
    try { if (window.VescoState && window.VescoState.orders) add('VescoState.orders', window.VescoState.orders()); } catch(e) {}
    try { if (window.VescoState && window.VescoState.flexOrders) add('VescoState.flexOrders', window.VescoState.flexOrders()); } catch(e) {}

    [
      'orders',
      'pedidos',
      'allOrders',
      'pedidosLogistica',
      'dadosPedidos',
      'flexOrders',
      'pedidosFlex',
      'enviosFlex',
      'ordersFlex'
    ].forEach(k => {
      try { add(k, window[k]); } catch(e) {}
    });

    return out;
  }

  function key(o){
    try { if (window.VescoState && VescoState.getKey) return VescoState.getKey(o); } catch(e) {}
    return txt(o && (o.pedido_key || o.id || o.id_tiny || o.numero || o.pedido || o.numero_ecommerce || o.ecom || o.id_flex || ''));
  }

  function number(o){
    return txt(o && (o.numero || o.pedido || o.id_tiny || o.id || o.id_flex || ''));
  }

  function ecom(o){
    return txt(o && (o.numero_ecommerce || o.numeroEcommerce || o.ecommerce || o.e_commerce || o.ecom || o.id_ecommerce || ''));
  }

  function client(o){
    return txt(o && (o.cliente_nome || o.destinatario || o.cliente || o.nome || o.nome_destinatario || 'Cliente não informado'));
  }

  function status(o){
    try { if (window.VescoState && VescoState.getStatus) return VescoState.getStatus(o); } catch(e) {}
    return txt(o && (o.status_logistica || o.status || o.situacao_nome || o.situacao || o.status_operacional || ''));
  }

  function address(o){
    try { if (window.VescoState && VescoState.getAddress) return VescoState.getAddress(o); } catch(e) {}
    return txt(o && (o.endereco_completo || o.endereco || o.address || o.full_address || ''));
  }

  function value(o){
    const keys = ['valor_total','valor_pedido','valor','total','total_pedido','preco_total','preco','valor_nf','valor_venda','receita'];
    for (const k of keys) {
      if (o && o[k] !== undefined && o[k] !== null && txt(o[k]) !== '') return parseMoney(o[k]);
    }
    return 0;
  }

  function dueDate(o){
    return parseISO(txt(o && (o.data_prevista || o.data_previsao || o.previsao || o.data_pedido || o.data || o.created_at || o.criado_em || '')));
  }

  function deliveredDate(o){
    return parseISO(txt(o && (
      o.data_entregue ||
      o.entregue_em ||
      o.finalizado_em ||
      o.data_finalizado ||
      o.data_entrega_realizada ||
      o.concluido_em ||
      o.concluído_em ||
      ''
    )));
  }

  function delivered(o){
    const s = norm(status(o));
    if (s.includes('pendente de entrega')) return false;

    return (
      s === 'entregue' ||
      s === 'finalizado' ||
      s.includes('entregue') ||
      s.includes('concluid') ||
      !!deliveredDate(o)
    );
  }

  function badAddress(o){
    const a = norm(address(o));
    return !a ||
      a === '-' ||
      a === '—' ||
      a.includes('endereco nao disponivel') ||
      a.includes('endereço não disponível') ||
      a.includes('sem endereco') ||
      a.includes('sem endereço') ||
      a.includes('nao informado') ||
      a.includes('não informado');
  }

  function retirada(o){
    const raw = [
      o && o.id_forma_envio,
      o && o.idFormaEnvio,
      o && o.idFormaEnvioPsq,
      o && o.forma_envio_id,
      o && o.forma_envio_nome,
      o && o.forma_envio,
      o && o.nomeformafenvio,
      o && o.transportadora,
      o && o.tipo_entrega,
      o && o.prioridade_label
    ].map(txt).filter(Boolean).join('|');

    const f = norm(raw);

    return (
      f.includes('retirada') ||
      f.includes('retirar pessoalmente') ||
      f.includes('retirar na loja') ||
      f.includes('cliente retira') ||
      ['747632298','758290131','860463094'].some(id => raw.includes(id))
    );
  }

  function isFlex(o){
    const f = norm([
      o && o.forma_envio_nome,
      o && o.forma_envio,
      o && o.nomeformafenvio,
      o && o.transportadora,
      o && o.tipo_entrega,
      o && o.prioridade_label
    ].map(txt).filter(Boolean).join('|'));

    return o.__v72source === 'flex' ||
      o.__v7source === 'flex' ||
      f.includes('mercado envios flex') ||
      f.includes('envios flex') ||
      f.includes(' flex');
  }

  function coords(o){
    const latRaw = o && (o.lat ?? o.latitude ?? o.lat_destino ?? o.latitude_destino ?? o.geo_lat);
    const lonRaw = o && (o.lon ?? o.lng ?? o.longitude ?? o.lon_destino ?? o.lng_destino ?? o.longitude_destino ?? o.geo_lon);
    const lat = parseFloat(String(latRaw ?? '').replace(',','.'));
    const lon = parseFloat(String(lonRaw ?? '').replace(',','.'));
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  }

  function allOrders(){
    const out = [];
    const seen = new Set();

    arrays().forEach(([name, arr]) => {
      const src = norm(name).includes('flex') ? 'flex' : 'erp';

      arr.forEach(o => {
        if (!o || typeof o !== 'object') return;

        if (src === 'flex') o.__v72source = 'flex';

        const k = key(o) || number(o) || ecom(o) || JSON.stringify(o).slice(0, 80);
        if (!k || seen.has(k)) return;

        seen.add(k);
        out.push(o);
      });
    });

    return out;
  }

  function selectedOrPast(o){
    const d = dueDate(o);
    const sel = selectedDate();

    if (!d) return true;
    return d <= sel;
  }

  function logisticaList(){
    return allOrders()
      .filter(o => !isFlex(o))
      .filter(o => !delivered(o))
      .filter(o => !retirada(o))
      .filter(o => !badAddress(o))
      .filter(selectedOrPast);
  }

  function flexList(){
    return allOrders()
      .filter(isFlex)
      .filter(o => !delivered(o))
      .filter(selectedOrPast);
  }

  function retiradaList(){
    return allOrders()
      .filter(o => !isFlex(o))
      .filter(o => !delivered(o))
      .filter(o => retirada(o) || badAddress(o))
      .filter(selectedOrPast);
  }

  function entreguesList(){
    const sel = selectedDate();

    return allOrders()
      .filter(o => !isFlex(o))
      .filter(delivered)
      .filter(o => {
        const dd = deliveredDate(o);
        if (dd) return dd === sel;

        // fallback para legado que só tem status entregue, sem data/hora.
        const d = dueDate(o);
        return d === sel;
      });
  }

  function keysFor(o){
    const vals = [
      key(o),
      number(o),
      ecom(o),
      o && o.id,
      o && o.id_tiny,
      o && o.id_flex,
      o && o.numero_ecommerce
    ].map(txt).filter(Boolean);

    const out = new Set();

    vals.forEach(v => {
      out.add(v);
      out.add(v.replace(/^#/, ''));
      const d = v.replace(/\D/g, '');
      if (d) out.add(d);
    });

    return Array.from(out).filter(Boolean);
  }

  function page(tab){
    return {
      logistica: 'view-logistica',
      envios_flex: 'view-envios_flex',
      retiradas: 'view-retiradas',
      entregues: 'view-entregues',
      saiu: 'view-saiu'
    }[tab] || `view-${tab}`;
  }

  function activate(tab, title, sub){
    ensureOldNavHidden();
    setActive(tab);
    setTitle(title, sub);
    hideViews();

    const v = showView(page(tab));
    return v;
  }

  function statusBadge(o){
    const d = dueDate(o);
    const sel = selectedDate();

    if (d && d < sel) return '<span class="v72-chip red">Pendente / atrasado</span>';
    return '<span class="v72-chip green">Entrega do dia</span>';
  }

  function renderLogistica(){
    const v = activate('logistica', 'Logística', 'ERP a entregar — pendentes anteriores continuam visíveis');
    if (!v) return;

    const list = logisticaList();
    const plotted = list.filter(coords);

    v.innerHTML = `
      <div class="v72-toolbar">
        <div>
          <h2>Logística ERP</h2>
          <small>Mostra somente pedidos ERP que ainda precisam ser entregues. Entregues, Flex, retirada e sem endereço ficam fora daqui.</small>
        </div>
        <div class="v72-actions">
          <button class="v72-btn secondary" onclick="VescoV72.refresh()">Atualizar dados</button>
          <button class="v72-btn" onclick="VescoV72.renderLogistica(true)">Ajustar mapa</button>
        </div>
      </div>

      <div class="v72-kpi-row">
        <div class="v72-kpi"><span>A entregar</span><strong>${list.length}</strong><small>ERP pendente</small></div>
        <div class="v72-kpi"><span>No mapa</span><strong>${plotted.length}</strong><small>com lat/lon</small></div>
        <div class="v72-kpi"><span>Atrasados</span><strong>${list.filter(o => dueDate(o) && dueDate(o) < selectedDate()).length}</strong><small>data anterior não entregue</small></div>
        <div class="v72-kpi"><span>Valor em aberto</span><strong>${money(list.reduce((s,o)=>s+value(o),0))}</strong><small>pedidos visíveis</small></div>
      </div>

      <div class="v72-layout">
        <div class="v72-card">
          <div class="v72-card-head">
            <div>
              <h3>Pedidos ERP para entrega</h3>
              <small>${list.length} pedido(s) encontrado(s)</small>
            </div>
          </div>
          <div class="v72-table-wrap">
            <table class="v72-table">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Cliente / endereço</th>
                  <th>Data</th>
                  <th>Status</th>
                  <th>Valor</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                ${list.length ? list.map(o => `
                  <tr>
                    <td>
                      <div class="v72-order">
                        <b>#${esc(number(o) || key(o))}</b>
                        ${statusBadge(o)}
                      </div>
                    </td>
                    <td class="v72-client">
                      <b>${esc(client(o))}</b>
                      <small>${esc(address(o))}</small>
                    </td>
                    <td><span class="v72-chip gray">${esc(br(dueDate(o)))}</span></td>
                    <td>${esc(status(o) || 'Pendente')}</td>
                    <td>${money(value(o))}</td>
                    <td><button class="v72-btn" onclick="focusOrderOnMap('${esc(number(o) || key(o))}')">Mapa</button></td>
                  </tr>
                `).join('') : `
                  <tr>
                    <td colspan="6" class="v72-empty">
                      <b>Nenhum pedido ERP a entregar.</b>
                      Se todos já foram entregues, a Logística fica limpa.
                    </td>
                  </tr>
                `}
              </tbody>
            </table>
          </div>
        </div>

        <div class="v72-card v72-map-card">
          <div class="v72-map-actions">
            <div>
              <h3>Mapa operacional</h3>
              <small>Somente os pedidos da lista ao lado</small>
            </div>
            <button class="v72-btn secondary" onclick="VescoV72.renderMap('logistica', {forceFit:true})">Ajustar mapa</button>
          </div>
          <div id="v72-map-logistica" class="v72-map"></div>
          <div id="v72-map-logistica-stats" class="v72-map-stats"></div>
        </div>
      </div>
    `;

    renderMap('logistica', { forceFit:true });
  }

  function renderFlex(){
    const v = activate('envios_flex', 'Envios Flex', 'Radar Flex limpo, com um único mapa');
    if (!v) return;

    const list = flexList();
    const plotted = list.filter(coords);

    v.innerHTML = `
      <div class="v72-toolbar">
        <div>
          <h2>Envios Flex</h2>
          <small>Pedidos Flex pendentes até a data selecionada. Clique em Mapa para centralizar.</small>
        </div>
        <div class="v72-actions">
          <button class="v72-btn secondary" onclick="VescoV72.refresh()">Atualizar dados</button>
          <button class="v72-btn" onclick="VescoV72.renderFlex(true)">Ajustar mapa</button>
        </div>
      </div>

      <div class="v72-kpi-row">
        <div class="v72-kpi"><span>Flex em aberto</span><strong>${list.length}</strong><small>até ${br(selectedDate())}</small></div>
        <div class="v72-kpi"><span>No mapa</span><strong>${plotted.length}</strong><small>com coordenada</small></div>
        <div class="v72-kpi"><span>Sem coordenada</span><strong>${list.length - plotted.length}</strong><small>não trava o mapa</small></div>
        <div class="v72-kpi"><span>Valor Flex</span><strong>${money(list.reduce((s,o)=>s+value(o),0))}</strong><small>pedidos visíveis</small></div>
      </div>

      <div class="v72-layout">
        <div class="v72-card">
          <div class="v72-card-head">
            <div>
              <h3>Pedidos Flex</h3>
              <small>${list.length} pedido(s) pendente(s)</small>
            </div>
          </div>
          <div class="v72-table-wrap">
            <table class="v72-table">
              <thead>
                <tr>
                  <th>Pedido / E-com</th>
                  <th>Destinatário</th>
                  <th>Data</th>
                  <th>Valor</th>
                  <th>Status</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                ${list.length ? list.map(o => `
                  <tr>
                    <td>
                      <div class="v72-order">
                        <b>#${esc(number(o) || key(o))}</b>
                        <small>E-com: ${esc(ecom(o) || '—')}</small>
                      </div>
                    </td>
                    <td class="v72-client">
                      <b>${esc(client(o))}</b>
                      <small>${esc(address(o) || 'Endereço/coord. não informado')}</small>
                    </td>
                    <td><span class="v72-chip gray">${esc(br(dueDate(o)))}</span></td>
                    <td>${money(value(o))}</td>
                    <td><span class="v72-chip orange">Flex pendente</span></td>
                    <td><button class="v72-btn orange" onclick="focusFlexOnMap('${esc(number(o) || key(o) || ecom(o))}')">Mapa</button></td>
                  </tr>
                `).join('') : `
                  <tr><td colspan="6" class="v72-empty"><b>Nenhum Flex pendente.</b></td></tr>
                `}
              </tbody>
            </table>
          </div>
        </div>

        <div class="v72-card v72-map-card">
          <div class="v72-map-actions">
            <div>
              <h3>Radar Flex</h3>
              <small>Um único mapa, sem geocode em massa</small>
            </div>
            <button class="v72-btn secondary" onclick="VescoV72.renderMap('flex', {forceFit:true})">Ajustar mapa</button>
          </div>
          <div id="v72-map-flex" class="v72-map"></div>
          <div id="v72-map-flex-stats" class="v72-map-stats"></div>
        </div>
      </div>
    `;

    renderMap('flex', { forceFit:true });
  }

  function renderRetiradas(){
    const v = activate('retiradas', 'Retiradas', 'Pedidos sem rota: retirada ou sem endereço');
    if (!v) return;

    const list = retiradaList();

    v.innerHTML = `
      <div class="v72-toolbar">
        <div>
          <h2>Retiradas / sem rota</h2>
          <small>Pedidos que não entram na rota: retirada, retirar pessoalmente ou sem endereço válido.</small>
        </div>
        <div class="v72-actions">
          <button class="v72-btn secondary" onclick="VescoV72.refresh()">Atualizar dados</button>
        </div>
      </div>

      <div class="v72-kpi-row">
        <div class="v72-kpi"><span>Total</span><strong>${list.length}</strong><small>pedidos sem rota</small></div>
        <div class="v72-kpi"><span>Retirada</span><strong>${list.filter(retirada).length}</strong><small>forma de envio retirada</small></div>
        <div class="v72-kpi"><span>Sem endereço</span><strong>${list.filter(badAddress).length}</strong><small>precisa tratar</small></div>
        <div class="v72-kpi"><span>Valor</span><strong>${money(list.reduce((s,o)=>s+value(o),0))}</strong><small>pedidos visíveis</small></div>
      </div>

      <div class="v72-card">
        <div class="v72-card-head">
          <div>
            <h3>Pedidos para retirada ou pendência de endereço</h3>
            <small>${list.length} pedido(s) até ${br(selectedDate())}</small>
          </div>
        </div>
        <div class="v72-table-wrap">
          <table class="v72-table">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Cliente</th>
                <th>Motivo</th>
                <th>Data</th>
                <th>Status</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              ${list.length ? list.map(o => `
                <tr>
                  <td><b>#${esc(number(o) || key(o))}</b></td>
                  <td class="v72-client">
                    <b>${esc(client(o))}</b>
                    <small>${esc(address(o) || 'Endereço não disponível')}</small>
                  </td>
                  <td>
                    ${retirada(o) ? '<span class="v72-chip green">Retirada</span>' : ''}
                    ${badAddress(o) ? '<span class="v72-chip orange">Sem endereço</span>' : ''}
                  </td>
                  <td><span class="v72-chip gray">${esc(br(dueDate(o)))}</span></td>
                  <td>${esc(status(o) || 'Pendente')}</td>
                  <td>
                    <button class="v72-btn green" onclick="VescoV72.marcarRetirada('${esc(key(o) || number(o))}')">Registrar retirada</button>
                  </td>
                </tr>
              `).join('') : `
                <tr><td colspan="6" class="v72-empty"><b>Nenhum pedido para retirada/sem rota.</b></td></tr>
              `}
            </tbody>
          </table>
        </div>
      </div>
    `;

    updateBadge();
  }

  function renderEntregues(){
    const v = activate('entregues', 'Entregues', 'Entregas finalizadas na data selecionada');
    if (!v) return;

    const list = entreguesList();

    v.innerHTML = `
      <div class="v72-toolbar">
        <div>
          <h2>Entregues em ${br(selectedDate())}</h2>
          <small>Mostra entregas finalizadas no dia. Quando o legado não tem data de entrega, usa a data do pedido como fallback.</small>
        </div>
        <div class="v72-actions">
          <button class="v72-btn secondary" onclick="VescoV72.refresh()">Atualizar dados</button>
        </div>
      </div>

      <div class="v72-kpi-row">
        <div class="v72-kpi"><span>Entregues</span><strong>${list.length}</strong><small>na data</small></div>
        <div class="v72-kpi"><span>Clientes</span><strong>${new Set(list.map(client)).size}</strong><small>únicos</small></div>
        <div class="v72-kpi"><span>Com data real</span><strong>${list.filter(deliveredDate).length}</strong><small>entregue_em/data_entregue</small></div>
        <div class="v72-kpi"><span>Valor</span><strong>${money(list.reduce((s,o)=>s+value(o),0))}</strong><small>pedidos entregues</small></div>
      </div>

      <div class="v72-card">
        <div class="v72-card-head">
          <div>
            <h3>Entregas finalizadas</h3>
            <small>${list.length} pedido(s)</small>
          </div>
        </div>
        <div class="v72-table-wrap">
          <table class="v72-table">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Cliente / endereço</th>
                <th>Data entrega</th>
                <th>Recebedor</th>
                <th>Status</th>
                <th>Valor</th>
              </tr>
            </thead>
            <tbody>
              ${list.length ? list.map(o => `
                <tr>
                  <td><b>#${esc(number(o) || key(o))}</b></td>
                  <td class="v72-client">
                    <b>${esc(client(o))}</b>
                    <small>${esc(address(o) || '—')}</small>
                  </td>
                  <td><span class="v72-chip green">${esc(br(deliveredDate(o) || dueDate(o)))}</span></td>
                  <td>${esc(o.recebedor || o.nome_recebedor || o.recebido_por || '—')}</td>
                  <td><span class="v72-chip green">${esc(status(o) || 'Entregue')}</span></td>
                  <td>${money(value(o))}</td>
                </tr>
              `).join('') : `
                <tr><td colspan="6" class="v72-empty"><b>Nenhuma entrega finalizada em ${br(selectedDate())}.</b></td></tr>
              `}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function markerIcon(type, label){
    if (typeof L === 'undefined') return undefined;

    return L.divIcon({
      className: '',
      html: `<div class="v72-marker ${type === 'flex' ? 'flex' : ''}">${label}</div>`,
      iconSize: [30,30],
      iconAnchor: [15,15]
    });
  }

  function ensureMap(type){
    if (typeof L === 'undefined') return null;

    const host = document.getElementById(`v72-map-${type}`);
    if (!host) return null;

    if (state.maps[type] && state.maps[type]._container === host) {
      return state.maps[type];
    }

    if (state.maps[type]) {
      try { state.maps[type].remove(); } catch(e) {}
      state.maps[type] = null;
      state.layers[type] = null;
    }

    const map = L.map(host, {
      preferCanvas: true,
      zoomControl: true,
      attributionControl: true
    }).setView([-23.5505, -46.6333], 11);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(map);

    state.maps[type] = map;
    state.layers[type] = L.layerGroup().addTo(map);

    setTimeout(() => {
      try { map.invalidateSize(true); } catch(e) {}
    }, 120);

    return map;
  }

  function listForMap(type){
    return type === 'flex' ? flexList() : logisticaList();
  }

  function renderMap(type, opt = {}){
    const map = ensureMap(type);
    if (!map) return false;

    const list = listForMap(type);
    const plotted = list.filter(coords);
    const pts = [];

    state.markers[type] = {};
    state.layers[type].clearLayers();

    plotted.forEach((o, i) => {
      const c = coords(o);
      const n = number(o) || key(o) || ecom(o);
      const m = L.marker([c.lat, c.lon], {
        icon: markerIcon(type, type === 'flex' ? 'F' : String(i + 1)),
        title: `#${n} ${client(o)}`
      });

      m.bindPopup(`
        <div style="font-size:12px;line-height:1.35;min-width:220px">
          <b>#${esc(n)} — ${esc(client(o))}</b><br>
          <span>${esc(address(o) || 'Coordenada informada')}</span><br>
          <small>${esc(status(o) || 'Pendente')}</small>
        </div>
      `);

      m.addTo(state.layers[type]);

      keysFor(o).forEach(k => state.markers[type][k] = m);

      pts.push([c.lat, c.lon]);
    });

    const stats = document.getElementById(`v72-map-${type}-stats`);
    if (stats) {
      stats.innerHTML = `
        <span class="ok">${plotted.length}/${list.length} no mapa</span>
        <span class="warn">${list.length - plotted.length} sem lat/lon</span>
        <span>Sem geocode em massa</span>
      `;
    }

    setTimeout(() => {
      try {
        map.invalidateSize(true);

        if (pts.length && opt.forceFit) {
          if (pts.length === 1) map.setView(pts[0], 15);
          else map.fitBounds(L.latLngBounds(pts).pad(.16), { maxZoom: 14 });
        }
      } catch(e) {}
    }, 80);

    return true;
  }

  function focus(type, id){
    renderMap(type, { forceFit:false });

    const clean = txt(id).replace(/^#/, '');
    let marker = state.markers[type][clean];

    if (!marker) {
      const d = clean.replace(/\D/g, '');
      if (d) marker = state.markers[type][d];
    }

    const map = state.maps[type];

    if (!marker || !map) {
      alert('Pedido sem coordenada no mapa. Corrija lat/lon na planilha ou rode o geocode no Apps Script.');
      return false;
    }

    try {
      map.setView(marker.getLatLng(), 17);
      marker.openPopup();
      map.invalidateSize(true);
      return true;
    } catch(e) {
      return false;
    }
  }

  function refresh(){
    try {
      if (typeof load === 'function') load();
      else if (typeof safeLoad === 'function') safeLoad();
    } catch(e) {}

    setTimeout(() => {
      const tab = activeTab();
      if (tab === 'logistica') renderLogistica();
      if (tab === 'envios_flex') renderFlex();
      if (tab === 'retiradas') renderRetiradas();
      if (tab === 'entregues') renderEntregues();
    }, 600);
  }

  function activeTab(){
    const a = document.querySelector('#v7Sidebar [data-v7tab].active');
    return a ? a.dataset.v7tab : '';
  }

  function marcarRetirada(id){
    if (!id) return;

    if (typeof updateStatusJsonp === 'function') {
      try {
        updateStatusJsonp(id, 'Entregue', 'Retirada registrada pelo painel');
        setTimeout(renderRetiradas, 700);
        return;
      } catch(e) {}
    }

    alert('Retirada marcada localmente. Para gravar, confirme se updateStatusJsonp está disponível no app.js.');
  }

  function installNavigation(){
    if (!window.VescoV7 || !window.VescoV7.go || window.VescoV7.go.__v72) return;

    state.oldGo = window.VescoV7.go.bind(window.VescoV7);

    const go = function(tab){
      ensureOldNavHidden();

      if (tab === 'logistica') return renderLogistica();
      if (tab === 'envios_flex' || tab === 'flex') return renderFlex();
      if (tab === 'retiradas') return renderRetiradas();
      if (tab === 'entregues') return renderEntregues();

      return state.oldGo(tab);
    };

    go.__v72 = true;
    window.VescoV7.go = go;
  }

  function installMapFocus(){
    window.focusOrderOnMap = function(id){
      renderLogistica();
      setTimeout(() => focus('logistica', id), 180);
      return true;
    };

    window.focusFlexOnMap = function(id){
      renderFlex();
      setTimeout(() => focus('flex', id), 180);
      return true;
    };
  }

  function installGuards(){
    ['plotMapMarkers', 'geocodeAddress', 'geocodeViaVescoProxy'].forEach(name => {
      const fn = window[name];
      if (typeof fn !== 'function' || fn.__v72guard) return;

      const old = fn;

      window[name] = function(){
        const tab = activeTab();

        if (tab === 'logistica' || tab === 'envios_flex') {
          if (name === 'plotMapMarkers') {
            setTimeout(() => renderMap(tab === 'logistica' ? 'logistica' : 'flex'), 80);
            return true;
          }

          return Promise.resolve(null);
        }

        return old.apply(this, arguments);
      };

      window[name].__v72guard = true;

      try { Function(name + '=window["' + name + '"]')(); } catch(e) {}
    });
  }

  function updateBadge(){
    const b = document.getElementById('v7RetBadge');
    if (b) b.textContent = String(retiradaList().length);
  }

  function init(){
    document.body.classList.add('vesco-v7-2');
    ensureOldNavHidden();
    installNavigation();
    installMapFocus();
    installGuards();
    updateBadge();

    window.addEventListener('vesco:loaded', () => setTimeout(() => {
      ensureOldNavHidden();
      updateBadge();
      const tab = activeTab();
      if (tab === 'logistica') renderLogistica();
      if (tab === 'envios_flex') renderFlex();
      if (tab === 'retiradas') renderRetiradas();
      if (tab === 'entregues') renderEntregues();
    }, 500));

    window.addEventListener('vesco:rendered', () => setTimeout(() => {
      ensureOldNavHidden();
      updateBadge();
    }, 150));

    setTimeout(() => {
      ensureOldNavHidden();
      updateBadge();
    }, 800);
  }

  window.VescoV72 = {
    __v72: true,
    init,
    allOrders,
    logisticaList,
    flexList,
    retiradaList,
    entreguesList,
    renderLogistica,
    renderFlex,
    renderRetiradas,
    renderEntregues,
    renderMap,
    focus,
    refresh,
    marcarRetirada,
    updateBadge,
    debug(){
      return {
        version: 'V7.2',
        date: selectedDate(),
        arrays: arrays().map(([name, arr]) => ({ name, total: arr.length })),
        logistica: logisticaList().map(o => ({ pedido:number(o), cliente:client(o), data:dueDate(o), status:status(o), address:address(o), coords:coords(o) })),
        flex: flexList().length,
        retiradas: retiradaList().length,
        entregues: entreguesList().length,
        activeTab: activeTab(),
        oldNavHidden: !!document.querySelector('[data-v72-hidden="true"]')
      };
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  console.log('VESCO V7.2 operacional ativo — navegação única, mapas únicos e filtros corretos.');
})();
