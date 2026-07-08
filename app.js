// app.js — Versão corrigida: Mapas sincronizados, sem pins duplicados e foco preciso
// Observações: coloque este arquivo no lugar do app.js atual e recarregue o servidor.

// --- Proteções / Motor de Áudio ---
window.playBeepSound = () => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, ctx.currentTime); // 880Hz (Som de alarme)
    gain.gain.setValueAtTime(0.1, ctx.currentTime); // Volume
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15); // Duração do bipe
  } catch(e) { console.warn("Áudio bloqueado pelo navegador."); }
};

window.stopAudioAlarm = () => {
  const modal = document.getElementById('snoozeModal');
  if (modal) modal.classList.add('hidden');
};
// --- Endpoints (ajuste se necessário) ---
const API = "https://script.google.com/macros/s/AKfycbxEzbxBABMDwi7B7tn_1p-lC0vc50JjHFOrH3w42Oog2-5R2-WMYSrQ27ED7wduJUN6/exec";
const API_FLEX = "https://script.google.com/macros/s/AKfycbzDp2qs2S_MxDc_3afY1TurNKYEwfYKkk2cc4IliNxLiVaJuSKYyRqofOUMnhdFBjwNwg/exec";

// --- Estado global ---
let orders = [];
let flexOrders = [];
let currentOperator = localStorage.getItem('vesco_operator') || '';
let map, mapFlex, markerCluster, markerClusterFlex;
let renderTimer = null;
let geocodeCache = {};
let geocodeQueue = [];
let geocodeProcessing = false;
let currentMapRenderToken = 0; // Previne pins duplicados (Async Bleeding)
const GEOCODE_DELAY_MS = 1100; // delay entre requisições Nominatim

const DEBUG_DATES = (new URLSearchParams(window.location.search)).get('debug_dates') === '1';

// Atualização automática desativada por regra operacional: atualização só manual.
window.VESCO_DISABLE_AUTO_REFRESH = true;


// =================================================================
// CAMADA DE DATA OPERACIONAL — PRESERVAÇÃO V1
// Objetivo: permitir que o botão Atualizar respeite a data escolhida
// no calendário, sem remover a lógica antiga de carregamento/renderização.
// =================================================================
const VESCO_TZ = 'America/Sao_Paulo';
let currentOperationalDateISO = localStorage.getItem('vesco_operational_date_iso') || '';

function getBrazilTodayISO(){
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: VESCO_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());
    const mapParts = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${mapParts.year}-${mapParts.month}-${mapParts.day}`;
  } catch(e) {
    const d = new Date();
    const offset = d.getTimezoneOffset();
    return new Date(d.getTime() - (offset * 60 * 1000)).toISOString().slice(0, 10);
  }
}

function getOperationalDateInputElement(){
  return document.getElementById('topCalendar') ||
         document.getElementById('dataOperacional') ||
         document.getElementById('data-operacional') ||
         document.getElementById('dataFiltro') ||
         document.querySelector('[data-operational-date]') ||
         document.querySelector('input[type="date"]');
}

function isoToBRDate(iso){
  const s = String(iso || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function brToISODate(br){
  const s = String(br || '').trim();
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if(!m) return '';
  let y = m[3];
  if(y.length === 2) y = '20' + y;
  return `${y.padStart(4,'0')}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
}

function dateValueToISO(v){
  if(v === null || v === undefined || String(v).trim() === '') return '';
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = brToISODate(s);
  if(br) return br;
  try {
    if(typeof parseAnyDateValue === 'function') {
      const d = parseAnyDateValue(v);
      if(d && !isNaN(d.getTime())) {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
      }
    }
  } catch(e) {}
  const d2 = new Date(s);
  if(!isNaN(d2.getTime())) {
    const yyyy = d2.getFullYear();
    const mm = String(d2.getMonth() + 1).padStart(2, '0');
    const dd = String(d2.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return '';
}

function getSelectedOperationalDateISO(){
  const input = getOperationalDateInputElement();
  const fromInput = input && input.value ? dateValueToISO(input.value) : '';
  const iso = fromInput || currentOperationalDateISO || localStorage.getItem('vesco_operational_date_iso') || getBrazilTodayISO();
  currentOperationalDateISO = iso;
  try { localStorage.setItem('vesco_operational_date_iso', iso); } catch(e) {}
  return iso;
}

function setSelectedOperationalDateISO(iso){
  const normalized = dateValueToISO(iso) || getBrazilTodayISO();
  currentOperationalDateISO = normalized;
  try { localStorage.setItem('vesco_operational_date_iso', normalized); } catch(e) {}
  const input = getOperationalDateInputElement();
  if(input && input.value !== normalized) input.value = normalized;
  return normalized;
}

function getOperationalDatePayload(){
  const iso = getSelectedOperationalDateISO();
  return { iso, br: isoToBRDate(iso), todayISO: getBrazilTodayISO() };
}

function appendQueryParamsSafe(url, params){
  let out = String(url || '');
  const entries = Object.entries(params || {}).filter(([,v]) => v !== undefined && v !== null && String(v).trim() !== '');
  entries.forEach(([k,v]) => {
    const sep = out.includes('?') ? '&' : '?';
    out += `${sep}${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
  });
  return out;
}

function appendOperationalDateToUrl(url){
  const p = getOperationalDatePayload();
  // Enviamos aliases compatíveis. Se o Apps Script ignorar algum, não quebra.
  return appendQueryParamsSafe(url, {
    data: p.br,
    dataFiltro: p.br,
    data_operacional: p.br,
    date: p.iso,
    dataISO: p.iso
  });
}

function getStatusTextAny(o){
  return String((o && (o.status_logistica || o.situacao_nome || o.situacao || o.status)) || '').toLowerCase().trim();
}

function isSeparatedReadyStatus(o){
  const st = getStatusTextAny(o);
  return st.includes('separado') || st.includes('pronto');
}

function isDispatchedStatus(o){
  const st = getStatusTextAny(o);
  return st.includes('despach') || st.includes('em rota') || st.includes('saiu para entrega') || st === 'rota';
}

function isDeliveredStatus(o){
  const st = getStatusTextAny(o);
  return st.includes('entregue') || st.includes('finalizado') || st.includes('conclu');
}

function isStillSeparatedNotOut(o){
  return isSeparatedReadyStatus(o) && !isDispatchedStatus(o) && !isDeliveredStatus(o);
}

function firstISODateFromFields(o, keys){
  if(!o) return '';
  for(const k of keys){
    if(o[k] !== undefined && o[k] !== null && String(o[k]).trim() !== '') {
      const iso = dateValueToISO(o[k]);
      if(iso) return iso;
    }
  }
  return '';
}

function getOrderSeparationISO(o){
  const iso = firstISODateFromFields(o, [
    'dataSeparacao','data_separacao','separado_em','separadoEm','separado_data',
    'data_separado','separado','data_separacao_extrato','dt_separacao','separation_date'
  ]);
  if(iso) return iso;

  // Fallback controlado: procura uma data explícita em observações/auditoria.
  const obs = String((o && (o.observacao_logistica || o.observacao || o.audit || o.historico)) || '');
  const found = typeof extractFirstDateLikeString === 'function' ? extractFirstDateLikeString(obs) : '';
  return found ? dateValueToISO(found) : '';
}

function getOrderScheduledISO(o){
  return firstISODateFromFields(o, [
    'data_prevista','data_previsao','previsao','data_prev','data_entrega','data','scheduled','eta','deliverydate'
  ]);
}

function getOrderDeliveryISO(o){
  return firstISODateFromFields(o, [
    'data_entrega_realizada','entregue_em','data_entregue','dataEntrega','delivered_at','concluidaEm'
  ]);
}

function getOrderDispatchISO(o){
  return firstISODateFromFields(o, [
    'data_despacho','despachado_em','data_rota','saiu_em','saiuParaEntregaEm','criadoEm'
  ]);
}

function sameOperationalDate(isoA, isoB){
  return !!isoA && !!isoB && String(isoA).slice(0,10) === String(isoB).slice(0,10);
}

function isSelectedOperationalDateToday(){
  return sameOperationalDate(getSelectedOperationalDateISO(), getBrazilTodayISO());
}

function shouldShowOrderForQueueDate(o){
  const selectedISO = getSelectedOperationalDateISO();
  const scheduledISO = getOrderScheduledISO(o);
  if(scheduledISO) return sameOperationalDate(scheduledISO, selectedISO);
  return isSelectedOperationalDateToday();
}

function shouldShowSeparatedForOperationalDate(o){
  const selectedISO = getSelectedOperationalDateISO();
  const sepISO = getOrderSeparationISO(o);

  if(sepISO && sameOperationalDate(sepISO, selectedISO)) return true;

  // Regra solicitada: separado em dia anterior e ainda não saiu para entrega
  // continua aparecendo no dia atual como separado/disponível para rota.
  if(isSelectedOperationalDateToday() && isStillSeparatedNotOut(o)) return true;

  // Fallback: se o backend ainda não devolve data de separação, mantém visível hoje.
  if(!sepISO && isSelectedOperationalDateToday() && isSeparatedReadyStatus(o)) return true;

  return false;
}

function shouldShowLogisticForOperationalDate(o){
  const selectedISO = getSelectedOperationalDateISO();
  const scheduledISO = getOrderScheduledISO(o);
  const sepISO = getOrderSeparationISO(o);
  const dispatchISO = getOrderDispatchISO(o);
  const deliveryISO = getOrderDeliveryISO(o);

  if(scheduledISO && sameOperationalDate(scheduledISO, selectedISO)) return true;
  if(sepISO && sameOperationalDate(sepISO, selectedISO)) return true;
  if(dispatchISO && sameOperationalDate(dispatchISO, selectedISO)) return true;
  if(deliveryISO && sameOperationalDate(deliveryISO, selectedISO)) return true;

  if(isSelectedOperationalDateToday() && isStillSeparatedNotOut(o)) return true;
  if(!scheduledISO && !sepISO && !dispatchISO && !deliveryISO && isSelectedOperationalDateToday()) return true;

  return false;
}

function shouldShowDeliveredForOperationalDate(o){
  const selectedISO = getSelectedOperationalDateISO();
  const deliveryISO = getOrderDeliveryISO(o) || getOrderDispatchISO(o) || getOrderSeparationISO(o);
  return deliveryISO ? sameOperationalDate(deliveryISO, selectedISO) : isSelectedOperationalDateToday();
}

function shouldShowFlexForOperationalDate(f){
  const selectedISO = getSelectedOperationalDateISO();
  const scheduledISO = getOrderScheduledISO(f);
  const sepISO = getOrderSeparationISO(f);
  if(scheduledISO) return sameOperationalDate(scheduledISO, selectedISO);
  if(sepISO) return sameOperationalDate(sepISO, selectedISO);
  return isSelectedOperationalDateToday();
}

function routeBelongsToOperationalDate(r){
  const selectedISO = getSelectedOperationalDateISO();
  const createdISO = dateValueToISO(r && r.criadoEm);
  const concludedISO = dateValueToISO(r && r.concluidaEm);
  if(createdISO && sameOperationalDate(createdISO, selectedISO)) return true;
  if(concludedISO && sameOperationalDate(concludedISO, selectedISO)) return true;
  // Rotas pendentes/em andamento permanecem visíveis no dia atual.
  if(isSelectedOperationalDateToday() && r && r.status !== 'concluida') return true;
  return false;
}

function syncGlobalOrderState(){
  try {
    window.orders = orders;
    window.flexOrders = flexOrders;
    if(window.appDebug) {
      window.appDebug.orders = orders;
      window.appDebug.flexOrders = flexOrders;
    }
  } catch(e) {}
}

// --- Helpers básicos ---
function debounce(fn, ms = 60) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
function scheduleRender() {
  if (typeof syncGlobalOrderState === 'function') syncGlobalOrderState();
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 60);
}
function escapeHtml(t){ if(t === null || t === undefined) return ''; return String(t).replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]); }
function normalizeOrderNumber(n){
  if(n === null || n === undefined) return '';
  let s = String(n).trim();
  s = s.replace(/^#/, '').replace(/\s+/g, '');
  s = s.replace(/[^0-9A-Za-z\-_.]/g,'');
  return s;
}
function normalizeEcomNumber(v){
  if(v === null || v === undefined) return '';
  let s = String(v).trim();
  const digits = s.replace(/\D/g,'');
  if(digits.length >= 5) return digits;
  s = s.replace(/\s+/g, '').replace(/[^0-9A-Za-z\-_]/g,'');
  return s || '';
}
function parseNumberLoose(v){
  if(v === null || v === undefined) return NaN;
  if(typeof v === 'number') return v;
  return parseFloat(String(v).trim().replace(/\s+/g,'').replace(',', '.').replace(/[^0-9\.\-]/g, ''));
}
function _isValidLat(v){ return Number.isFinite(v) && Math.abs(v) <= 90; }
function _isValidLon(v){ return Number.isFinite(v) && Math.abs(v) <= 180; }
function _tryNormalizeNumber(v, isLat){
  if(v === null || v === undefined) return null;
  const n = parseNumberLoose(v);
  if(!Number.isFinite(n)) return null;
  if(isLat && _isValidLat(n)) return n;
  if(!isLat && _isValidLon(n)) return n;
  const divisors = [1e6, 1e7, 1e5, 1e3, 1e2];
  for(const d of divisors){
    const nv = n / d;
    if(isLat && _isValidLat(nv)) return nv;
    if(!isLat && _isValidLon(nv)) return nv;
  }
  return null;
}
function getCoords(item) {
  if (!item) return null;
  const laRaw = item.lat ?? item.latitude ?? item.latitude_local ?? item.lat_br ?? item.lat_local ?? item.geo_lat ?? item.latitud ?? '';
  const loRaw = item.lon ?? item.longitude ?? item.longitude_local ?? item.lon_br ?? item.lon_local ?? item.geo_lon ?? item.longitud ?? '';
  const lat = _tryNormalizeNumber(laRaw, true);
  const lon = _tryNormalizeNumber(loRaw, false);
  if(lat === null || lon === null) return null;
  return { lat: lat, lon: lon };
}

// -------------------------
// DATA: FUNÇÃO DEFINITIVA
// -------------------------

function excelSerialToDate(serial) {
  const days = Number(serial);
  if (!Number.isFinite(days)) return null;
  const epoch = new Date(Date.UTC(1899, 11, 30));
  const ms = epoch.getTime() + Math.round(days * 24 * 60 * 60 * 1000);
  const d = new Date(ms);
  return isNaN(d) ? null : d;
}

function formatToDDMMYYYY(d){
  if(!d || isNaN(d)) return '';
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function extractFirstDateLikeString(s){
  if(!s) return '';
  const str = String(s);
  const regexes = [
    /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/, 
    /(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/,   
    /(\d{10,13})/                          
  ];
  for(const r of regexes){
    const m = str.match(r);
    if(m) return m[1];
  }
  return '';
}

function parseAnyDateValue(v){
  if(v === null || v === undefined) return null;
  if(typeof v === 'number') {
    if (v > 20000 && v < 60000) {
      const d = excelSerialToDate(v);
      if(d) return d;
    }
    if(v > 1e11) { const d = new Date(v); if(!isNaN(d)) return d; }
  }
  const s = String(v).trim();
  if(!s) return null;
  if(/^\d{10,13}$/.test(s)) {
    const n = parseInt(s,10);
    const ts = (s.length === 10) ? n*1000 : n;
    const d = new Date(ts);
    if(!isNaN(d)) return d;
  }
  if(/^\d{5,6}$/.test(s) && Number(s) > 20000 && Number(s) < 60000) {
    const d = excelSerialToDate(Number(s));
    if(d) return d;
  }
  const isoMatch = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if(isoMatch) {
    const y = Number(isoMatch[1]), m = Number(isoMatch[2]) - 1, day = Number(isoMatch[3]);
    const dd = new Date(y, m, day);
    if(!isNaN(dd)) return dd;
  }
  const brMatch = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if(brMatch) {
    let day = Number(brMatch[1]), month = Number(brMatch[2]) - 1, year = Number(brMatch[3]);
    if(year < 100) year += 2000;
    const dd = new Date(year, month, day);
    if(!isNaN(dd)) return dd;
  }
  const d2 = new Date(s);
  if(!isNaN(d2)) return d2;
  return null;
}

function extractDateDefinitive(input){
  if(input && typeof input === 'object' && !Array.isArray(input)) {
    const preferredKeys = [
      'data_prevista','data','data_previsao','data_previsão','previsao','dataentrega',
      'deliverydate','expecteddate','dateexpected','eta','scheduled','scheduledat','data_prev'
    ];
    for(const k of preferredKeys){
      for(const key in input){
        if(!Object.prototype.hasOwnProperty.call(input, key)) continue;
        if(key.toLowerCase().replace(/[^a-z0-9]/g,'').includes(k.replace(/[^a-z0-9]/g,''))) {
          const v = input[key];
          if(v !== undefined && v !== null && String(v).trim() !== '') {
            const candidate = String(v).trim();
            const substr = extractFirstDateLikeString(candidate) || candidate;
            const parsed = parseAnyDateValue(substr);
            if(parsed) return formatToDDMMYYYY(parsed);
            if(/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(candidate)) {
              const parts = candidate.split(/[\/\-]/);
              let day = parts[0].padStart(2,'0'), month = parts[1].padStart(2,'0'), year = parts[2];
              if(year.length === 2) year = '20' + year;
              return `${day}/${month}/${year}`;
            }
          }
        }
      }
    }
    for(const k in input){
      if(!Object.prototype.hasOwnProperty.call(input, k)) continue;
      const v = input[k];
      if(v === null || v === undefined) continue;
      const candidateString = String((typeof v === 'object') ? (v.value || v.text || v.date || '') : v);
      const substr = extractFirstDateLikeString(candidateString);
      if(substr) {
        const parsed = parseAnyDateValue(substr);
        if(parsed) return formatToDDMMYYYY(parsed);
      }
    }
    try {
      const all = JSON.stringify(input);
      const substr = extractFirstDateLikeString(all);
      if(substr) {
        const parsed = parseAnyDateValue(substr);
        if(parsed) return formatToDDMMYYYY(parsed);
      }
    } catch(e){}
    return '';
  }
  if(Array.isArray(input) && input.length > 0 && Array.isArray(input[0])) {
    const header = input[0].map(h => String(h || '').trim());
    const headerNorm = header.map(h => h.toLowerCase().replace(/[^a-z0-9]/g,''));
    const dateCandidates = ['dataprevista','data_prevista','data','previsao','dataentrega','deliverydate','expecteddate','eta','scheduled'];
    let idx = -1;
    for(let i=0;i<headerNorm.length;i++) if(dateCandidates.includes(headerNorm[i])) { idx = i; break; }
    if(idx === -1) {
      for(let i=0;i<headerNorm.length;i++) if(/prev|previs|entreg|delivery|date|data/.test(headerNorm[i])) { idx = i; break; }
    }
    if(idx !== -1 && input.length > 1) {
      const raw = input[1][idx];
      const substr = extractFirstDateLikeString(String(raw||''));
      const parsed = parseAnyDateValue(substr || raw);
      if(parsed) return formatToDDMMYYYY(parsed);
    }
    if(input.length > 1) {
      for(const cell of input[1]) {
        const substr = extractFirstDateLikeString(String(cell||''));
        if(substr) {
          const parsed = parseAnyDateValue(substr);
          if(parsed) return formatToDDMMYYYY(parsed);
        }
      }
    }
    return '';
  }
  const raw = input;
  let candidate = extractFirstDateLikeString(raw) || String(raw||'').trim();
  const parsed = parseAnyDateValue(candidate);
  if(parsed) return formatToDDMMYYYY(parsed);
  return '';
}

function extractDateDefinitiveWithDebug(input){
  const result = extractDateDefinitive(input);
  if(DEBUG_DATES) {
    try { console.info('DATE_EXTRACT DEBUG', { input, result }); } catch(e){}
  }
  return result;
}

// -------------------------
// Geocoding (Fila Lenta de Socorro - PLANO B)
// -------------------------
function normalizeAddressKey(addr){
  if(!addr) return '';
  return String(addr).trim().replace(/\s+/g,' ').toLowerCase();
}

function geocodeAddress(address){
  return new Promise((resolve, reject) => {
    if(!address || String(address).trim() === '') return resolve(null);
    const key = normalizeAddressKey(address);
    if(geocodeCache.hasOwnProperty(key)) return resolve(geocodeCache[key]);
    
    geocodeQueue.push({ address, resolve, reject });
    processGeocodeQueue();
  });
}

function processGeocodeQueue(){
  if(geocodeProcessing) return;
  geocodeProcessing = true;
  
  const next = () => {
    const item = geocodeQueue.shift();
    if(!item){ geocodeProcessing = false; return; }

    const address = item.address;
    const key = normalizeAddressKey(address);
    const q = encodeURIComponent(address + ', Brasil'); // Força a busca no Brasil
    const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&addressdetails=0`;

    fetch(url, { headers: { 'Accept-Language': 'pt-BR' } })
      .then(r => r.json())
      .then(js => {
        if(Array.isArray(js) && js.length > 0){
          const p = js[0];
          const res = { lat: parseFloat(p.lat), lon: parseFloat(p.lon) };
          geocodeCache[key] = res; // Salva na memória do navegador
          item.resolve(res);
        } else {
          geocodeCache[key] = null;
          item.resolve(null);
        }
      }).catch(err => {
        console.warn('Erro no Geocode de Socorro (Plano B)', err);
        geocodeCache[key] = null;
        item.resolve(null);
      }).finally(() => {
        setTimeout(next, 1500);
      });
  };
  next();
}

function tryGeocodeIfNeeded(item, onResolved){
  const coords = getCoords(item);
  if(coords){ 
    if(typeof onResolved === 'function') onResolved(coords); 
    return; 
  }
  const addr = (item.endereco_completo || item.endereco || '').trim();
  if(!addr) { 
    if(typeof onResolved === 'function') onResolved(null); 
    return;
  }
  const cacheKey = normalizeAddressKey(addr);
  if(geocodeCache.hasOwnProperty(cacheKey)) {
    const c = geocodeCache[cacheKey];
    if(typeof onResolved === 'function') onResolved(c ? {lat: c.lat, lon: c.lon} : null);
    return;
  }
  geocodeAddress(addr).then(res => {
    if(typeof onResolved === 'function') onResolved(res ? { lat: res.lat, lon: res.lon } : null);
  });
}

// -------------------------
// Ícone, jsonp, util, findArrayInObject
// -------------------------
function createPinSVG(color='#eab308', size=28){
  const inner = Math.max(8, Math.round(size * 0.35));
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2C8.686 2 6 4.686 6 8c0 4.418 6 12 6 12s6-7.582 6-12c0-3.314-2.686-6-6-6z" fill="${color}" stroke="#ffff" stroke-width="1.2"/>
      <circle cx="12" cy="8" r="${inner/4}" fill="#fff" />
    </svg>
  `;
}
function jsonpFetch(url, cb) {
  const cbName = '__jsonp_cb_' + Math.random().toString(36).substr(2,9);
  const script = document.createElement('script');
  const timeout = setTimeout(() => {
     try { delete window[cbName]; } catch(e){}
     if (script.parentNode) script.remove();
     if (typeof cb === 'function') cb(new Error("Timeout"), null);
  }, 15000);
  window[cbName] = function(res) {
    clearTimeout(timeout);
    try { if (typeof cb === 'function') cb(null, res); } catch(e){ console.error(e); }
    try { delete window[cbName]; } catch(e){}
    if (script.parentNode) script.remove();
  };
  const sep = url.indexOf('?') === -1 ? '?' : '&';
  script.src = `${url}${sep}callback=${cbName}`;
  script.id = cbName;
  document.head.appendChild(script);
}
function jsonpFetchPromise(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const cbName = '__jsonp_cb_' + Math.random().toString(36).substr(2,9);
    const script = document.createElement('script');
    let timer = null;
    function cleanup() {
      if (timer) clearTimeout(timer);
      try { delete window[cbName]; } catch(e){}
      if (script.parentNode) script.remove();
    }
    window[cbName] = function(res){
      cleanup();
      resolve({ jsonp: true, resp: res });
    };
    script.onerror = function(ev){
      cleanup();
      reject(new Error('JSONP script error'));
    };
    timer = setTimeout(() => {
      cleanup();
      reject(new Error('JSONP timeout'));
    }, timeoutMs);
    const sep = url.indexOf('?') === -1 ? '?' : '&';
    script.src = `${url}${sep}callback=${cbName}`;
    document.head.appendChild(script);
  });
}
function findArrayInObject(obj) {
  if (!obj) return null;
  if (Array.isArray(obj)) return obj;
  if (typeof obj !== 'object') return null;
  for (const k in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
    const v = obj[k];
    if (Array.isArray(v)) return v;
  }
  for (const k in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
    const v = obj[k];
    if (v && typeof v === 'object') {
      for (const k2 in v) {
        if (!Object.prototype.hasOwnProperty.call(v, k2)) continue;
        if (Array.isArray(v[k2])) return v[k2];
      }
    }
  }
  return null;
}

// -------------------------
// Normalizadores
// -------------------------
function normalizeKeyName(k){
  if(k === null || k === undefined) return '';
  return String(k).toString().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
}
function extractClientNameFromAny(obj) {
  if (!obj) return '';
  const keys = [
    'cliente_nome','cliente','destinatario','destinatário','nome','receiver','recipient',
    'customer_name','customer','client','nome_cliente','destinatario_nome','nome_destinatario',
    'consignee','to_name','ship_to_name','dest'
  ];
  for (const k of keys) {
    if (k in obj && obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') {
      return String(obj[k]).trim();
    }
  }
  for (const k in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
    const v = obj[k];
    if (typeof v === 'string' && /[A-Za-zÀ-ú]+(\s+[A-Za-zÀ-ú]+){1,4}/.test(v) && v.length < 90) {
      return v.trim();
    }
  }
  return '';
}
function extractEcomNumberFromAny(obj) {
  if (!obj) return '';
  const keys = [
    'numero_ecommerce','numero_ecom','ecom','ecom_id','order_reference','order_ref',
    'reference','referencia','reference_number','merchant_order_id','marketplace_order_id',
    'external_id','external_reference','codigo_externo','order_id','orderNumber','id'
  ];
  for (const k of keys) {
    if (k in obj && obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') {
      return normalizeEcomNumber(obj[k]);
    }
  }
  const fallbackCandidates = ['reference','referencia','order_id','codigo_externo','id'];
  for (const f of fallbackCandidates) {
    if (f in obj && obj[f]) {
      const s = String(obj[f]).trim();
      const digits = s.replace(/\D/g, '');
      if (digits.length >= 5) return digits;
      if (s.length >= 4) return s;
    }
  }
  return '';
}
function extractStoreNameFromAny(obj) {
  if (!obj) return '';
  const keys = [
    'conta','loja','store','store_name','nome_loja','account','seller','shop','marketplace','loja_nome','store_id','merchant','conta'
  ];
  for (const k of keys) {
    if (k in obj && obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') {
      return String(obj[k]).trim();
    }
  }
  for (const k in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
    const v = String(obj[k] || '');
    const m = v.match(/(loja[:\s]+[A-Za-z0-9\-\s]+)/i);
    if (m && m[1]) return m[1].replace(/loja[:\s]+/i, '').trim();
  }
  return '';
}

// -------------------------
// Carregamento dos dados
// -------------------------
function load(){
  // ERP (JSONP)
  const apiUrlComData = (typeof appendOperationalDateToUrl === 'function') ? appendOperationalDateToUrl(API) : API;
  jsonpFetch(apiUrlComData, function(err, resp){
    if (resp && resp.success) {
      let dadosErp = (resp.data || []).filter(o => (o.numero || o.id || o.pedido));
      orders = dadosErp.map(normalizeOrderObject);
      orders.forEach(o => {
        o.data_prevista = o.data_prevista && String(o.data_prevista).trim() ? extractDateDefinitiveWithDebug(o.data_prevista) : extractDateDefinitiveWithDebug(o);
      });
      scheduleRender();
    } else if (Array.isArray(resp)) {
      orders = (resp || []).map(normalizeOrderObject);
      orders.forEach(o => { o.data_prevista = o.data_prevista && String(o.data_prevista).trim() ? extractDateDefinitiveWithDebug(o.data_prevista) : extractDateDefinitiveWithDebug(o); });
      scheduleRender();
    } else {
      orders = [];
      scheduleRender();
    }
  });

  // FLEX
  (function fetchFlexRobust(){
    const urlBase = (typeof appendOperationalDateToUrl === 'function') ? appendOperationalDateToUrl(`${API_FLEX}?action=separacoesIndex`) : `${API_FLEX}?action=separacoesIndex`;
    const JSONP_TIMEOUT = 15000;

    jsonpFetchPromise(urlBase, JSONP_TIMEOUT).then(result => {
      processFlexResponse(result.resp);
    }).catch(jsonpErr => {
      fetch(urlBase, { cache: 'no-store' }).then(r => r.text()).then(txt => {
        try {
          const parsed = JSON.parse(txt);
          processFlexResponse(parsed);
        } catch(e) {
          const m = txt.match(/^[^(]*\(([\s\S]*)\)\s*;?\s*$/);
          if (m && m[1]) {
            try {
              const parsed2 = JSON.parse(m[1]);
              processFlexResponse(parsed2);
              return;
            } catch(e2){}
          }
          try {
            const maybe = JSON.parse(txt.replace(/\n/g,''));
            processFlexResponse(maybe);
            return;
          } catch(e3){}
          flexOrders = [];
          scheduleRender();
        }
      }).catch(fetchErr => {
        flexOrders = [];
        scheduleRender();
      });
    });

    function processFlexResponse(resp){
      let dadosBrutos = findArrayInObject(resp) || (Array.isArray(resp) ? resp : null);
      if(!dadosBrutos || dadosBrutos.length === 0) {
        dadosBrutos = [];
        const q = [resp];
        while(q.length && dadosBrutos.length === 0) {
          const n = q.shift();
          for(const k in n){
            if(!Object.prototype.hasOwnProperty.call(n,k)) continue;
            const v = n[k];
            if(Array.isArray(v)) { dadosBrutos = v; break; }
            if(v && typeof v === 'object') q.push(v);
          }
        }
      }
      if(!dadosBrutos) dadosBrutos = [];

      if (Array.isArray(dadosBrutos) && dadosBrutos.length > 0 && Array.isArray(dadosBrutos[0])) {
        const headerRow = dadosBrutos[0].map(h => String(h || '').trim());
        const headerNorm = headerRow.map(h => normalizeKeyName(h || ''));
        const dataRows = dadosBrutos.slice(1);
        const possibleDateKeys = ['dataprevista','data_prevista','data','previsao','dataentrega','deliverydate','expecteddate','eta','scheduled'];
        let idxDate = -1;
        for (let i = 0; i < headerNorm.length; i++) {
          if (possibleDateKeys.includes(headerNorm[i])) { idxDate = i; break; }
        }
        if (idxDate === -1) {
          for (let i = 0; i < headerNorm.length; i++){
            if (/(prev|previs|entreg|delivery|expected|date|data)/i.test(headerNorm[i])) { idxDate = i; break; }
          }
        }
        const possibleStoreKeys = ['conta','loja','store','store_name','nome_loja','account','merchant'];
        let idxStore = -1;
        for (let i = 0; i < headerNorm.length; i++) {
          if (possibleStoreKeys.includes(headerNorm[i])) { idxStore = i; break; }
        }
        if (idxStore === -1) {
          for (let i = 0; i < headerNorm.length; i++){
            if (/(conta|loja|store|merchant|seller)/i.test(headerNorm[i])) { idxStore = i; break; }
          }
        }

        dadosBrutos = dataRows.map(row => {
          const obj = {};
          for (let i = 0; i < headerRow.length; i++) {
            const key = headerRow[i] || `col${i}`;
            obj[key] = row[i];
          }
          if (idxDate !== -1) obj['data_prevista_raw'] = row[idxDate];
          if (idxStore !== -1) obj['store_raw'] = row[idxStore];
          return obj;
        });
      }

      const normalized = dadosBrutos.map(raw => {
        const f = Object.assign({}, raw);
        f.numero = String(f.numero || f.id || f.pedido || f.order_id || f.orderNumber || f.reference || f.referencia || '').trim();
        f.cliente_nome = extractClientNameFromAny(f) || f.destinatario || f.cliente || f.nome || '';

        let candidate = null;
        if (f.data_prevista_raw !== undefined && f.data_prevista_raw !== null && String(f.data_prevista_raw).trim() !== '') candidate = f.data_prevista_raw;
        else {
          for(const key in f){
            if(!Object.prototype.hasOwnProperty.call(f,key)) continue;
            const nkey = normalizeKeyName(key);
            if(/prev|previs|data|entreg|sched|eta|delivery|expected/i.test(nkey) && String(f[key]).trim() !== '') {
              candidate = f[key];
              break;
            }
          }
        }
        f.data_prevista = candidate ? extractDateDefinitiveWithDebug(candidate) : extractDateDefinitiveWithDebug(f);

        f.numero_ecommerce = extractEcomNumberFromAny(f) || normalizeEcomNumber(f.numero_ecommerce || f.referencia || f.reference || f.id || '');
        const rawStoreCandidate = (f.store_raw !== undefined && f.store_raw !== null && String(f.store_raw).trim() !== '') ? String(f.store_raw).trim()
          : ( (f.conta !== undefined && f.conta !== null && String(f.conta).trim() !== '') ? String(f.conta).trim() : null );
        f.store_name = rawStoreCandidate || extractStoreNameFromAny(f) || (f.loja || f.store || f.merchant || f.conta || '');
        f.endereco_completo = f.endereco_completo || f.endereco || f.address || f.full_address || '';
        f.lat = f.lat || f.latitude || f.latitude_local || f.geo_lat || f.lat_br || '';
        f.lon = f.lon || f.longitude || f.longitude_local || f.geo_lon || f.lon_br || '';
        f.situacao_nome = f.situacao_nome || f.status || f.situacao || '';
        f.id = f.id || f.numero || f.pedido || (f.order_id || '');
        return f;
      });

      flexOrders = normalized;
      scheduleRender();
    }
  })();
}

function normalizeOrderObject(item) {
  const obj = Object.assign({}, item);
  obj.numero = obj.numero || obj.id || obj.pedido || obj.order_id || obj.orderNumber || obj.reference || obj.referencia || '';
  obj.numero = String(obj.numero || '').trim();
  obj.cliente_nome = String(obj.cliente_nome || obj.cliente || obj.destinatario || obj.nome || obj.receiver || obj.recipient || '').trim();
  obj.endereco_completo = obj.endereco_completo || obj.endereco || obj.address || obj.full_address || obj.address_line || '';
  obj.lat = obj.lat || obj.latitude || obj.latitude_local || obj.geo_lat || obj.lat_br || '';
  obj.lon = obj.lon || obj.longitude || obj.longitude_local || obj.geo_lon || obj.lon_br || '';
  obj.data_prevista = obj.data_prevista || obj.data_previsao || obj.previsao || obj.data_prev || obj.data_entrega || '';
  obj.status_logistica = obj.status_logistica || obj.status || obj.situacao || '';
  obj.id = obj.id || obj.numero || '';
  obj.data_prevista = obj.data_prevista && String(obj.data_prevista).trim() ? extractDateDefinitiveWithDebug(obj.data_prevista) : extractDateDefinitiveWithDebug(obj);
  return obj;
}

// -------------------------
// Plotagem de marcadores (COM CORREÇÃO DE DUPLICAÇÃO ASYNC)
// -------------------------
window.activeMainMarkers = {};
window.activeFlexMarkers = {};

let flexBoundsTimer = null;
let mainBoundsTimer = null;

function plotMapMarkers(orderList, flexList){
  if(!markerCluster || !markerClusterFlex) return;

  currentMapRenderToken++;
  const myToken = currentMapRenderToken;

  markerCluster.clearLayers();
  markerClusterFlex.clearLayers();

  window.activeMainMarkers = {};
  window.activeFlexMarkers = {};

  function debouncedFitBoundsMain() {
    clearTimeout(mainBoundsTimer);
    mainBoundsTimer = setTimeout(() => {
        if(myToken !== currentMapRenderToken) return;
        try {
            if (markerCluster.getLayers().length > 0) {
                const b = markerCluster.getBounds();
                if(b && b.isValid && b.isValid()) map.fitBounds(b.pad(0.12), { maxZoom: 14 });
            }
        } catch(e){}
    }, 600);
  }

  function debouncedFitBoundsFlex() {
    clearTimeout(flexBoundsTimer);
    flexBoundsTimer = setTimeout(() => {
        if(myToken !== currentMapRenderToken) return;
        try {
            if (markerClusterFlex.getLayers().length > 0) {
                const b = markerClusterFlex.getBounds();
                if(b && b.isValid && b.isValid()) mapFlex.fitBounds(b.pad(0.12), { maxZoom: 14 });
            }
        } catch(e){}
    }, 600);
  }

  function addMainMarker(item, lat, lon){
    if (myToken !== currentMapRenderToken) return; // Async bleeding cancelado!
    
    const ecomNum = (item.numero_ecommerce || getEcomNum(item) || '').toString();
    const normNum = normalizeOrderNumber(item.numero || item.id || item.pedido || '');
    
    if (window.activeMainMarkers[normNum]) return; 

    const popupHtml = `<div class='p-1 font-sans'><b class='text-blue-600 text-sm'>Pedido #${escapeHtml(String(item.numero || ''))}</b><br><small class='text-xs text-slate-600 font-medium'>${escapeHtml(String(item.endereco_completo || ''))}</small><br><div class='text-[13px] text-slate-800 font-semibold mt-1'>${escapeHtml(String(item.cliente_nome || ''))}</div><div class='text-xs text-slate-500 mt-1'>Data Prevista: <b>${escapeHtml(String(item.data_prevista || '—'))}</b></div><div class='text-xs text-slate-400 mt-1'>ecom: ${escapeHtml(ecomNum || '—')}</div></div>`;
    const svgHtml = createPinSVG('#004f9f', 30);
    const icon = L.divIcon({ html: svgHtml, className: '', iconSize: [30,30], iconAnchor: [15,30] });
    const m = L.marker([lat, lon], { icon }).bindPopup(popupHtml);
    
    markerCluster.addLayer(m);
    try { if(normNum) window.activeMainMarkers[normNum] = m; if(ecomNum) window.activeMainMarkers[ecomNum] = m; window.activeMainMarkers[String(item.numero || item.id || '')] = m; } catch(e){}
    debouncedFitBoundsMain();
  }

  function addFlexMarker(item, lat, lon){
    if (myToken !== currentMapRenderToken) return; // Async bleeding cancelado!

    const ecomNum = (item.numero_ecommerce || '').toString();
    const normNum = normalizeOrderNumber(item.numero || item.id || '');

    if (window.activeFlexMarkers[normNum]) return; 

    const popupHtml = `<div class='p-1 font-sans'><b class='text-amber-500 text-sm'>Flex #${escapeHtml(String(item.numero || item.id || ''))}</b><br><small class='text-xs text-slate-600 font-medium'>${escapeHtml(String(item.endereco_completo || ''))}</small><br><div class='text-[13px] text-slate-800 font-semibold mt-1'>${escapeHtml(String(item.cliente_nome || ''))}</div><div class='text-xs text-slate-500 mt-1'>Data Prevista: <b>${escapeHtml(String(item.data_prevista || '—'))}</b></div><div class='text-xs text-slate-400 mt-1'>ecom: ${escapeHtml(ecomNum || '—')}</div><div class='text-xs text-slate-400 mt-1'>Loja: ${escapeHtml(item.store_name || '—')}</div></div>`;
    const svgHtmlFlex = createPinSVG('#eab308', 30);
    const iconFlex = L.divIcon({ html: svgHtmlFlex, className: '', iconSize: [30,30], iconAnchor: [15,30] });
    const mFlex = L.marker([lat, lon], { icon: iconFlex }).bindPopup(popupHtml);
    
    markerClusterFlex.addLayer(mFlex);
    try { if(normNum) window.activeFlexMarkers[normNum] = mFlex; if(ecomNum) window.activeFlexMarkers[ecomNum] = mFlex; window.activeFlexMarkers[String(item.numero || item.id || '')] = mFlex; } catch(e){}
    debouncedFitBoundsFlex();
  }

  for(const item of (orderList||[])){
    const coords = getCoords(item);
    if(coords){
      addMainMarker(item, coords.lat, coords.lon);
    } else {
      tryGeocodeIfNeeded(item, (c) => {
        if(c) addMainMarker(item, c.lat, c.lon);
      });
    }
  }

  for(const item of (flexList||[])){
    const coords = getCoords(item);
    if(coords){
      addFlexMarker(item, coords.lat, coords.lon);
    } else {
      tryGeocodeIfNeeded(item, (c) => {
        if(c) addFlexMarker(item, c.lat, c.lon);
      });
    }
  }
}

function getEcomNum(item){
  if(!item) return '';
  const candidates = [
    item.numero_ecommerce, item.numero_ecom, item.ecom_num, item.id_ecom,
    item.referencia, item.reference, item.ref, item.ecom, item.ecommerce_id,
    item.order_reference, item.order_ref, item.orderNumber, item.order_id, item.order,
    item.codigo_externo, item.codigo
  ];
  for(const c of candidates){
    if(c !== undefined && c !== null && String(c).trim() !== '') {
      const normalized = normalizeEcomNumber(c);
      if(normalized) return normalized;
    }
  }
  const fallback = item.numero || item.id || item.pedido || '';
  const maybe = normalizeEcomNumber(fallback);
  return maybe || '';
}

// -------------------------
// Render da UI (tabelas)
// -------------------------
function render(){
  const searchEl = document.getElementById('search');
  const searchQ = (searchEl && searchEl.value) ? searchEl.value.toLowerCase() : '';
  const tbodyFila = document.getElementById('table-fila');
  const tbodySepHoje = document.getElementById('table-separados-hoje');
  const tbodyPend = document.getElementById('table-pendencias');
  const tbodyLog = document.getElementById('table-logistica');
  const tbodyFlexCorpo = document.getElementById('table-envios-flex-corpo');
  const tbodyEntregues = document.getElementById('table-entregues');

  // 1. FILA ATIVA (ERP)
  const filaOrders = orders.filter(o => {
    const st = String(o.status_logistica || '').toLowerCase().trim();
    const matchBusca = (String(o.numero || '').toLowerCase().includes(searchQ) || String(o.cliente_nome || '').toLowerCase().includes(searchQ));
    const matchData = (typeof shouldShowOrderForQueueDate === 'function') ? shouldShowOrderForQueueDate(o) : true;
    return (st === 'a separar' || st === 'em separação') && matchBusca && matchData;
  });

  if (tbodyFila) {
    if (filaOrders.length === 0) {
      tbodyFila.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400 font-semibold">Nenhum pedido aguardando separação.</td></tr>`;
    } else {
      tbodyFila.innerHTML = filaOrders.map((o, idx) => {
        const id = o.id || o.numero || '';
        const statusAtual = o.status_logistica || 'A Separar';
        const statusLower = String(statusAtual).toLowerCase().trim();
        
        let badgeStyle = 'badge-strict-vermelho', dotStyle = 'dot-blink-red';
        if(statusLower.includes('em separa')) { badgeStyle = 'badge-strict-amarelo'; dotStyle = 'dot-strict-amarelo'; } 
        else if(statusLower.includes('a separar')) { badgeStyle = 'badge-strict-vermelho'; dotStyle = 'dot-blink-red'; } 
        else if(statusLower.includes('pronto')) { badgeStyle = 'badge-strict-verde'; dotStyle = 'dot-strict-verde'; } 
        else { badgeStyle = 'badge-strict-azul'; dotStyle = 'dot-strict-azul'; }
        
        const displayDataPrev = (o.data_prevista && String(o.data_prevista).trim()) ? String(o.data_prevista).trim() : '—';
        const ecomRaw = getEcomNum(o) || '';
        const ecomNorm = normalizeEcomNumber(ecomRaw);
        
        const instrucaoStr = String(o.instrucao_entrega || o.forma_pagamento || '—').toUpperCase();
        let paymentBadgeClass = "bg-slate-50 text-slate-600 border-slate-200"; 
        
        if (instrucaoStr.includes('JÁ PAGO')) {
          paymentBadgeClass = "bg-emerald-50 text-emerald-700 border-emerald-200";
        } else if (instrucaoStr.includes('CONFERIR')) {
          paymentBadgeClass = "bg-amber-50 text-amber-700 border-amber-200";
        } else if (instrucaoStr.includes('MAQUININHA')) {
          paymentBadgeClass = "bg-blue-50 text-blue-700 border-blue-200";
        } else if (instrucaoStr.includes('DINHEIRO')) {
          paymentBadgeClass = "bg-indigo-50 text-indigo-700 border-indigo-200";
        }

        return `
          <tr id="row-pedido-${escapeHtml(id)}" data-num="${escapeHtml(normalizeOrderNumber(o.numero || ''))}" data-ecom="${escapeHtml(ecomNorm)}" class="${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} hover:bg-slate-100/70 transition-colors text-xs md:text-sm">
            <td class="p-3 pl-4"><span class="status-pill ${badgeStyle}"><span class="status-dot ${dotStyle}"></span><span>${escapeHtml(statusAtual)}</span></span></td>
            
            <td class="p-3 font-bold text-slate-900">#${escapeHtml(o.numero || 'S/N')}
              <div class="text-[12px] text-slate-800 font-semibold mt-1">${escapeHtml(o.cliente_nome || '')}</div>
            </td>
            
            <td class="p-3 text-center"><input type="time" class="bg-white border border-slate-200 rounded-lg px-2 py-0.5 text-center font-bold text-xs md:text-sm w-20 shadow-sm focus:border-blue-500 outline-none" value="${o.alarme || ''}" onchange="updateAlarmTimeJsonp('${escapeHtml(id)}', this.value)"></td>
            
            <td class="p-3 text-center font-mono text-[#004f9f] font-bold hidden md:table-cell">${escapeHtml(displayDataPrev)}</td>
            
            <td class="p-3 text-xs text-slate-500 max-w-xs truncate hidden lg:table-cell">${escapeHtml(o.endereco_completo || '')}</td>
            
            <td class="p-3 align-middle">
              <span class="text-[11px] font-bold px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-sm border ${paymentBadgeClass}">
                ${escapeHtml(instrucaoStr)}
              </span>
            </td>

            <td class="p-3 pr-4 align-middle text-right">
              <div class="flex items-center justify-end gap-1.5">
                <button class="bg-amber-500 hover:bg-amber-600 text-white px-2.5 py-1.5 rounded-lg font-bold text-[11px] shadow-sm transition-all" onclick="moverParaPendenciaPrompt('${escapeHtml(id)}')">Pendência</button>
                <button class="bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1.5 rounded-lg font-bold text-[11px] shadow-sm transition-all" onclick="updateStatusJsonp('${escapeHtml(id)}','Em Separação')">Iniciar</button>
                <button class="bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1.5 rounded-lg font-bold text-[11px] shadow-sm transition-all" onclick="updateStatusJsonp('${escapeHtml(id)}','Pronto p/ Entrega')">Concluir</button>
              </div>
            </td>
          </tr>`;
      }).join('');
    }
  }

  // Separados hoje
  if (tbodySepHoje) {
    const prontosOrders = orders.filter(o => {
      const matchStatus = (typeof isSeparatedReadyStatus === 'function') ? isSeparatedReadyStatus(o) : String(o.status_logistica || '').toLowerCase().trim().includes('pronto');
      const matchData = (typeof shouldShowSeparatedForOperationalDate === 'function') ? shouldShowSeparatedForOperationalDate(o) : true;
      const matchBusca = (String(o.numero || '').toLowerCase().includes(searchQ) || String(o.cliente_nome || '').toLowerCase().includes(searchQ));
      return matchStatus && matchData && matchBusca;
    });
    tbodySepHoje.innerHTML = prontosOrders.length === 0 ? `<tr><td colspan="5" class="p-4 text-center text-slate-400 font-semibold">Nenhum registro encontrado.</td></tr>` : prontosOrders.map((o, idx) => `
      <tr class="${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} hover:bg-slate-100/70 text-xs md:text-sm">
        <td class="p-3 pl-4 font-bold text-slate-900">#${escapeHtml(o.numero)}</td>
        <td class="p-3 font-semibold text-slate-800">${escapeHtml(o.cliente_nome)}</td>
        <td class="p-3 text-center"><span class="text-blue-700 font-mono font-bold bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-100">${escapeHtml(o.tempo_separacao || '—')}</span></td>
        <td class="p-3 text-center"><span class="status-pill badge-strict-verde"><span class="status-dot dot-strict-verde"></span>Separado</span></td>
        <td class="p-3 pr-4 text-right"><button class="bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 px-3 py-1 rounded-lg font-bold text-[11px] transition-all" onclick="updateStatusJsonp('${escapeHtml(o.id)}','A Separar')"><i class="fas fa-rotate-left mr-1"></i>Refazer</button></td>
      </tr>`).join('');
  }

// Pendências - Novo Fluxo com Lista, Link do Tiny e Edição
  if (tbodyPend) {
    const pendOrders = orders.filter(o => {
      const matchData = (typeof shouldShowLogisticForOperationalDate === 'function') ? shouldShowLogisticForOperationalDate(o) : true;
      return String(o.status_logistica || '').toLowerCase().trim() === 'pendente' && matchData;
    });
    tbodyPend.innerHTML = pendOrders.length === 0 ? `<tr><td colspan="4" class="p-4 text-center text-slate-400 font-semibold">Nenhuma pendência ativa no momento.</td></tr>` : pendOrders.map((o, idx) => {
      
      const obsOriginal = o.observacao_logistica || o.observacao || '';
      const hasSolucao = obsOriginal.includes('[Solução]');
      
      let inputHtml = '';
      let btnHtml = '';

      if (hasSolucao) {
          const matchSolucao = obsOriginal.split('[Solução]')[1].trim();
          const partes = matchSolucao.split('[Link]');
          const solucaoText = partes[0].trim();
          const linkText = partes[1] ? partes[1].trim() : '';

          const listItems = solucaoText.split('\n').filter(item => item.trim() !== '').map(item => `<li><i class="fas fa-check text-emerald-500 mr-1"></i> ${escapeHtml(item.trim())}</li>`).join('');
          
          inputHtml = `<div class="bg-emerald-50 px-3 py-2 rounded-lg border border-emerald-100 w-full">
                         <ul class="text-xs font-bold text-emerald-700 space-y-1">${listItems}</ul>`;
          
          if (linkText) {
              inputHtml += `<div class="mt-2.5 border-t border-emerald-200/60 pt-2">
                              <a href="${escapeHtml(linkText)}" target="_blank" class="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg text-[10px] uppercase tracking-wider inline-flex items-center gap-1.5 shadow-sm transition-all">
                                <i class="fas fa-file-invoice"></i> PEDIDO Atualizado
                              </a>
                            </div>`;
          }
          inputHtml += `</div>`;

          btnHtml = `
            <div class="flex flex-col gap-1.5">
              <button class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-[11px] font-bold shadow-sm transition-all whitespace-nowrap" onclick="updateStatusJsonp('${escapeHtml(o.id)}', 'Pronto p/ Entrega', '${escapeHtml(obsOriginal)}')"><i class="fas fa-box mr-1"></i>Registrar Separado</button>
              <button class="bg-white hover:bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg text-[10px] font-bold shadow-sm transition-all border border-slate-200" onclick="editarSolucaoPendencia('${escapeHtml(o.id)}')"><i class="fas fa-edit mr-1"></i>Alterar Produto</button>
            </div>`;
     } else {
          inputHtml = `
            <div class="space-y-2 w-full">
              <textarea id="solucao-${escapeHtml(o.id)}" rows="2" class="w-full bg-slate-50 border border-slate-200 px-3 py-2 rounded-lg text-xs outline-none focus:border-amber-500 focus:bg-white transition-all font-semibold text-slate-800 resize-none" placeholder="Digite os produtos (pressione Enter para listar)"></textarea>
              <div class="relative">
                <i class="fas fa-link absolute left-2.5 top-2.5 text-slate-400 text-[10px]"></i>
                <input type="text" id="link-${escapeHtml(o.id)}" class="w-full bg-slate-50 border border-slate-200 pl-6 pr-3 py-1.5 rounded-lg text-[11px] outline-none focus:border-amber-500 focus:bg-white transition-all font-semibold text-slate-600 font-mono" placeholder="Cole o link do Tiny aqui (OBRIGATÓRIO)">
              </div>
            </div>`;
          btnHtml = `<button class="bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg text-[11px] font-bold shadow-sm transition-all whitespace-nowrap" onclick="salvarSolucaoPendencia('${escapeHtml(o.id)}')"><i class="fas fa-save mr-1"></i>Salvar Solução</button>`;
      }

      const motivoExibicao = obsOriginal.split('|')[0] || obsOriginal;

      return `
      <tr class="${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} text-xs md:text-sm text-slate-700 hover:bg-slate-100/50">
        <td class="p-3 pl-4 font-black text-slate-900 align-top">#${escapeHtml(o.numero)}</td>
        <td class="p-3 align-top">
          <div class="font-bold text-slate-800 mb-1">${escapeHtml(o.cliente_nome)}</div>
          <div class="text-red-600 font-medium text-[10px] bg-red-50 inline-block px-2 py-0.5 rounded border border-red-100"><i class="fas fa-circle-exclamation"></i> ${escapeHtml(motivoExibicao)}</div>
        </td>
        <td class="p-3 align-top w-2/5">${inputHtml}</td>
        <td class="p-3 pr-4 text-right align-top">${btnHtml}</td>
      </tr>`;
    }).join('');
  }

  // FLEX (AGORA COM BOTÃO DE FOCO)
  if (tbodyFlexCorpo) {
    const flexFiltrados = (flexOrders || []).filter(f => {
      const q = (searchQ || '').toLowerCase();
      const matchData = (typeof shouldShowFlexForOperationalDate === 'function') ? shouldShowFlexForOperationalDate(f) : true;
      const matchBusca = (
        String(f.numero || '').toLowerCase().includes(q) ||
        String(f.cliente_nome || '').toLowerCase().includes(q) ||
        String(f.endereco_completo || '').toLowerCase().includes(q) ||
        String(f.numero_ecommerce || '').toLowerCase().includes(q) ||
        String(f.store_name || '').toLowerCase().includes(q)
      );
      return matchData && matchBusca;
    });

    if (!flexFiltrados || flexFiltrados.length === 0) {
      tbodyFlexCorpo.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400 font-semibold">Nenhum pedido Flex detectado.</td></tr>`;
    } else {
      tbodyFlexCorpo.innerHTML = flexFiltrados.map((f, idx) => {
        const numeroDoc = f.numero || 'S/N';
        const numeroEcom = f.numero_ecommerce || f.referencia || '—';
        const volumesNum = f.qtd_volumes || f.volumes || f.items_count || '1';
        const clienteNome = f.cliente_nome || f.destinatario || f.cliente || '—';
        const lojaNome = f.store_name || '—';
        const addrDisplay = f.endereco_completo || '';
        const dataPrev = f.data_prevista || '—';
        const situacaoFlex = f.situacao_nome || f.situacao || '—';
        const focusId = escapeHtml(normalizeEcomNumber(numeroEcom) || normalizeOrderNumber(numeroDoc));
        
        const valorDisplay = f.valor && f.valor !== '—' && f.valor !== '' ? f.valor : 'R$ 0,00';
        const produtosDisplay = f.produtos && f.produtos !== '—' && f.produtos !== '' ? f.produtos : 'Sincronize para ver os itens...';

        return `
          <tr data-num="${escapeHtml(normalizeOrderNumber(f.numero || ''))}" data-ecom="${escapeHtml(normalizeEcomNumber(numeroEcom))}" class="${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} hover:bg-slate-100/70 text-xs md:text-sm text-slate-700 cursor-pointer" onclick="focusFlexOnMap('${focusId}')">
            <td class="p-3 pl-4 font-bold text-slate-900">
              <div class="flex items-center gap-1.5">
                <span>#${escapeHtml(numeroDoc)}</span>
                <button class="ml-2 bg-amber-50 hover:bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center transition-all border border-amber-200" title="Ver localização no mapa" onclick="event.stopPropagation(); focusFlexOnMap('${focusId}')">
                  <i class="fas fa-crosshairs"></i>
                </button>
              </div>
              <div class="text-[11px] text-slate-400">E‑com: ${escapeHtml(numeroEcom)}</div>
            </td>
            <td class="p-3 text-center">${escapeHtml(String(volumesNum))}</td>
            <td class="p-3">
              <b class="text-slate-900">${escapeHtml(clienteNome)}</b>
              <div class="text-[11px] text-slate-500 mt-0.5">${escapeHtml(addrDisplay)}</div>
              <div class="flex items-center gap-3 text-[10px] text-slate-500 mt-1.5 font-medium">
                 <span>Loja: <b class="text-slate-700">${escapeHtml(lojaNome)}</b></span>
                 <span>Valor: <b class="text-emerald-600">${escapeHtml(valorDisplay)}</b></span>
              </div>
              <div class="text-[10px] text-blue-700 mt-2 font-bold leading-tight bg-blue-50/80 p-1.5 rounded border border-blue-100 inline-block w-full">
                <i class="fas fa-box-open mr-1 text-blue-500"></i> ${escapeHtml(produtosDisplay)}
              </div>
            </td>
            <td class="p-3 text-center hidden md:table-cell"><span class="font-mono text-slate-700 font-bold">${escapeHtml(dataPrev)}</span></td>
            <td class="p-3 hidden md:table-cell">${escapeHtml(situacaoFlex)}</td>
            <td class="p-3 pr-4 text-right">
              <div style="display:flex;gap:8px;justify-content:flex-end;align-items:center;">
                <button class="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-xl font-bold text-[11px] shadow-sm transition-all" onclick="event.stopPropagation(); markFlexDelivered('${escapeHtml(f.id || f.numero)}','${escapeHtml(numeroDoc)}')"><i class="fas fa-check-double"></i> Entregue</button>
              </div>
            </td>
          </tr>`;
      }).join('');
    }
  }

  // Entregues
  if (tbodyEntregues) {
    const entregueOrders = orders.filter(o => {
      const matchData = (typeof shouldShowDeliveredForOperationalDate === 'function') ? shouldShowDeliveredForOperationalDate(o) : true;
      const matchBusca = (String(o.numero || '').toLowerCase().includes(searchQ) || String(o.cliente_nome || '').toLowerCase().includes(searchQ));
      return String(o.status_logistica || '').toLowerCase().trim() === 'entregue' && matchData && matchBusca;
    });
    
    tbodyEntregues.innerHTML = entregueOrders.length === 0 ? `<tr><td colspan="5" class="p-4 text-center text-slate-400 font-semibold">Nenhum despacho realizado.</td></tr>` : entregueOrders.map((o, idx) => {
      
      let recNome = o.nome_recebedor;
      let recDoc = o.doc_recebedor;

      if (!recNome) {
         const strTotal = JSON.stringify(o);
         const match = strTotal.match(/Recebido por:\s*(.*?)\s*\(Doc:\s*(.*?)\)/);
         if (match) {
           recNome = match[1].trim();
           recDoc = match[2].trim();
         }
      }

      const displayNome = recNome || '—';
      const displayDoc = recDoc || '—';

      return `
      <tr class="${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} hover:bg-slate-100/70 text-xs md:text-sm">
        <td class="p-3 pl-4 font-black text-slate-900">#${escapeHtml(o.numero)}</td>
        <td class="p-3 font-semibold text-slate-800">${escapeHtml(o.cliente_nome)}</td>
        
        <td class="p-3 hidden md:table-cell">
          <div class="font-bold text-slate-800 flex items-center gap-1.5"><i class="fas fa-user-check text-blue-500"></i>${escapeHtml(displayNome)}</div>
          <div class="text-[11px] text-slate-500 mt-0.5 font-mono"><i class="fas fa-id-card text-slate-400 mr-1"></i>Doc: ${escapeHtml(displayDoc)}</div>
        </td>

        <td class="p-3 text-center text-emerald-700 font-mono font-bold">${escapeHtml(o.tempo_separacao || '—')}</td>
        <td class="p-3 pr-4 text-center"><span class="bg-slate-100 text-slate-600 font-bold border border-slate-200 px-3 py-1 rounded-xl text-[10px] uppercase tracking-wider inline-flex items-center gap-1"><i class="fas fa-archive text-slate-400"></i> Finalizado</span></td>
      </tr>`;
    }).join('');
  }

  // LOGÍSTICA — preenchimento correto (resolução do problema)
  if (tbodyLog) {
    const logFiltrados = (orders || []).filter(o => {
      if (!o) return false;
      const frete = String(o.nomeformafenvio || o.nome_forma_envio || o.forma_envio || '').toLowerCase();
      if (frete.includes('flex') || frete.includes('mercado')) return false;
      const matchData = (typeof shouldShowLogisticForOperationalDate === 'function') ? shouldShowLogisticForOperationalDate(o) : true;
      if (!matchData) return false;
      if (searchQ) {
        return (String(o.numero || '').toLowerCase().includes(searchQ) ||
                String(o.cliente_nome || '').toLowerCase().includes(searchQ) ||
                String(o.endereco_completo || '').toLowerCase().includes(searchQ) ||
                String(o.numero_ecommerce || '').toLowerCase().includes(searchQ));
      }
      return true;
    });

    if (logFiltrados.length === 0) {
      tbodyLog.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400 font-semibold">Nenhum pedido logístico disponível.</td></tr>`;
    } else {
      tbodyLog.innerHTML = logFiltrados.map((o, idx) => {
        const id = o.id || o.numero || '';
        const dataPrev = o.data_prevista ? (parseAnyDateValue(o.data_prevista) ? formatToDDMMYYYY(parseAnyDateValue(o.data_prevista)) : String(o.data_prevista)) : '—';
        const status = (typeof getOperationalEventLabel === 'function' ? getOperationalEventLabel(o) : '') || o.situacao_nome || '—';
        const endereco = o.endereco_completo || o.endereco || '';
        return `
          <tr id="log-row-${escapeHtml(String(id))}" class="${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} hover:bg-slate-100/70 text-xs md:text-sm border-b border-slate-100">
            <td class="p-3 pl-4 font-bold text-slate-900">#${escapeHtml(String(o.numero || id))}</td>
            <td class="p-3 text-center font-mono text-[#004f9f] font-bold hidden md:table-cell">${escapeHtml(dataPrev)}</td>
            <td class="p-3">
              <div class="font-semibold">${escapeHtml(o.cliente_nome || '—')}</div>
              <div class="text-[11px] text-slate-500 mt-1 truncate hidden lg:block">${escapeHtml(endereco)}</div>
            </td>
            <td class="p-3 hidden md:table-cell">${escapeHtml(status)}</td>
            <td class="p-3 align-middle text-xs">
              <span class="px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 text-[11px]">${escapeHtml(String(o.forma_pagamento || o.nomeformafenvio || '—'))}</span>
            </td>
            <td class="p-3 pr-4 text-right">
              <div class="flex items-center justify-end gap-1.5">
                <button class="bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1.5 rounded-lg font-bold text-[11px]" onclick="focusOrderOnMap('${escapeHtml(String(o.numero || id))}')"><i class="fas fa-crosshairs mr-1"></i>Localizar</button>
                <button class="bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1.5 rounded-lg font-bold text-[11px]" onclick="updateStatusJsonp('${escapeHtml(String(id))}','Pronto p/ Entrega')">Concluir</button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }
  }

  // Sumários
  const sumSepararEl = document.getElementById('sum-separar');
  const sumProcessoEl = document.getElementById('sum-processo');
  const sumTotalEl = document.getElementById('sum-total');
  const sumFlexEl = document.getElementById('sum-flex-total');
  if(sumSepararEl) sumSepararEl.innerText = orders.filter(o => (!o.status_logistica || String(o.status_logistica).toLowerCase().includes('a separar')) && ((typeof shouldShowOrderForQueueDate === 'function') ? shouldShowOrderForQueueDate(o) : true)).length;
  if(sumProcessoEl) sumProcessoEl.innerText = orders.filter(o => String(o.status_logistica).toLowerCase().includes('em separa') && ((typeof shouldShowOrderForQueueDate === 'function') ? shouldShowOrderForQueueDate(o) : true)).length;
  if(sumTotalEl) sumTotalEl.innerText = orders.filter(o => (typeof shouldShowLogisticForOperationalDate === 'function') ? shouldShowLogisticForOperationalDate(o) : true).length;
  if(sumFlexEl) {
     const flexFiltrados = (flexOrders || []).filter(f => String(f.numero || '').trim() !== '' && ((typeof shouldShowFlexForOperationalDate === 'function') ? shouldShowFlexForOperationalDate(f) : true));
     sumFlexEl.innerText = flexFiltrados.length;
  }

  document.querySelectorAll('tr[data-num]').forEach(tr => {
    const raw = tr.getAttribute('data-num') || '';
    tr.setAttribute('data-num', normalizeOrderNumber(raw));
  });
  document.querySelectorAll('tr[data-ecom]').forEach(tr => {
    const raw = tr.getAttribute('data-ecom') || '';
    tr.setAttribute('data-ecom', normalizeEcomNumber(raw));
  });

  try {
    const logOrdersForMap = (orders || []).filter(o => {
      const frete = String(o.nomeformafenvio || o.nome_forma_envio || o.forma_envio || '').toLowerCase();
      const matchData = (typeof shouldShowLogisticForOperationalDate === 'function') ? shouldShowLogisticForOperationalDate(o) : true;
      return !frete.includes('flex') && !frete.includes('mercado') && matchData;
    });
    const flexFiltradosParaMapa = (flexOrders || []).filter(f => String(f.numero || '').trim() !== '' && ((typeof shouldShowFlexForOperationalDate === 'function') ? shouldShowFlexForOperationalDate(f) : true));
    plotMapMarkers(logOrdersForMap, flexFiltradosParaMapa);
  } catch (e) {
    console.warn('plotMapMarkers erro', e);
  }
  // Dispara a atualização do painel do motorista se implementado
  if (typeof renderMotorista === 'function') try { renderMotorista(); } catch(e) {}
}
// Ajusta automaticamente a altura da área rolável e aplica comportamento sticky no mapa
function initScrollablePanels(options = {}) {
  const headerOffset = options.headerOffset ?? 100; // ajuste se seu header for maior/menor
  const leftSelectors = options.leftSelectors ?? ['#view-logistica .card', '#view-separacao .card', '.left-panel', '.list-column'];
  const rightMapSelectors = options.mapSelectors ?? ['#map', '#map-active', '#map-wrapper', '#map-flex'];

  // procura o primeiro item que exista no DOM
  let leftEl = null;
  for (const s of leftSelectors) { leftEl = document.querySelector(s); if (leftEl) break; }
  let mapEl = null;
  for (const s of rightMapSelectors) { mapEl = document.querySelector(s); if (mapEl) break; }

  if (leftEl) {
    // cria wrapper scroll-area se não existir
    if (!leftEl.querySelector('.scroll-area')) {
      const wrapper = document.createElement('div');
      wrapper.className = 'scroll-area';
      // move conteúdo atual para o wrapper
      while (leftEl.firstChild) wrapper.appendChild(leftEl.firstChild);
      leftEl.appendChild(wrapper);
    }
    const scrollArea = leftEl.querySelector('.scroll-area');
    function resizeLeft() {
      scrollArea.style.maxHeight = `calc(100vh - ${headerOffset}px)`;
    }
    window.addEventListener('resize', resizeLeft);
    resizeLeft();
  }

  if (mapEl) {
    // aplica classe sticky ao container do mapa
    const parent = mapEl.parentElement;
    if (parent && !parent.classList.contains('map-sticky')) {
      parent.classList.add('map-sticky');
      parent.style.top = `${headerOffset - 10}px`;
      parent.style.height = `calc(100vh - ${headerOffset}px)`;
    }
    // se o mapa já foi inicializado, força invalidateSize quando rolar a area
    const scrollArea = (leftEl && leftEl.querySelector('.scroll-area')) ? leftEl.querySelector('.scroll-area') : null;
    if (scrollArea && map) {
      scrollArea.addEventListener('scroll', debounce(() => {
        try { if (map) map.invalidateSize(); if (mapFlex) mapFlex.invalidateSize(); } catch(e){}
      }, 150));
    }
  }
}

// chamar na inicialização
document.addEventListener('DOMContentLoaded', () => {
  // ajuste headerOffset se precisar
  initScrollablePanels({ headerOffset: 100 });
});
// --- Inits, mapas e handlers menores ---
function initMap() {
  try {
    const mapEl = document.getElementById('map') || document.getElementById('map-active') || document.getElementById('map-active');
    const mapFlexEl = document.getElementById('map-flex');
    if (!mapEl || !mapFlexEl) {
      return;
    }
    if (window._vesco_map_inited) return;
    window._vesco_map_inited = true;

    map = L.map(mapEl.id || 'map').setView([-23.55052, -46.633308], 11);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png', { attribution: '&copy; CartoDB', maxZoom: 19 }).addTo(map);
    if (typeof L.markerClusterGroup === 'function') {
      markerCluster = L.markerClusterGroup({ iconCreateFunction: function(cluster) { return new L.DivIcon({ html: '<div><span>' + cluster.getChildCount() + '</span></div>', className: 'marker-cluster marker-cluster-main', iconSize: new L.Point(40, 40) }); } });
    } else { markerCluster = L.layerGroup(); }
    map.addLayer(markerCluster);

    mapFlex = L.map(mapFlexEl.id || 'map-flex').setView([-23.55052, -46.633308], 11);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png', { attribution: '&copy; CartoDB', maxZoom: 19 }).addTo(mapFlex);
    if (typeof L.markerClusterGroup === 'function') {
      markerClusterFlex = L.markerClusterGroup({ chunkedLoading: true, iconCreateFunction: function(cluster) { return new L.DivIcon({ html: '<div><span>' + cluster.getChildCount() + '</span></div>', className: 'marker-cluster marker-cluster-flex', iconSize: new L.Point(40, 40) }); } });
    } else { markerClusterFlex = L.layerGroup(); }
    mapFlex.addLayer(markerClusterFlex);

    window.map = map;
    window.mapFlex = mapFlex;
    window.markerCluster = markerCluster;
    window.markerClusterFlex = markerClusterFlex;

    setTimeout(()=>{ try { if (map) map.invalidateSize(); if (mapFlex) mapFlex.invalidateSize(); } catch(e){} }, 300);
  } catch(e){ console.warn('initMap erro', e); }
}

// focus helpers
function findMainMarkerByKey(key){
  if(!key) return null;
  const k1 = normalizeEcomNumber(key);
  const k2 = normalizeOrderNumber(key);
  if(k1 && window.activeMainMarkers[k1]) return window.activeMainMarkers[k1];
  if(k2 && window.activeMainMarkers[k2]) return window.activeMainMarkers[k2];
  if(window.activeMainMarkers[key]) return window.activeMainMarkers[key];
  return null;
}
function findFlexMarkerByKey(key){
  if(!key) return null;
  const k1 = normalizeEcomNumber(key);
  const k2 = normalizeOrderNumber(key);
  if(k1 && window.activeFlexMarkers[k1]) return window.activeFlexMarkers[k1];
  if(k2 && window.activeFlexMarkers[k2]) return window.activeFlexMarkers[k2];
  if(window.activeFlexMarkers[key]) return window.activeFlexMarkers[key];
  return null;
}

function focusOrderOnMap(numeroOrEcom) {
  const marker = findMainMarkerByKey(numeroOrEcom);
  if (marker) {
    switchTab('logistica');
    setTimeout(() => { // Aguarda a aba ser trocada antes de centralizar
        const latLng = marker.getLatLng();
        map.setView(latLng, 16);
        marker.openPopup();
        document.getElementById('map')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 350);
  } else {
    showToast("Aguardando carregamento das coordenadas no mapa...");
  }
}
function focusFlexOnMap(numeroOrEcom) {
  const marker = findFlexMarkerByKey(numeroOrEcom);
  if (marker) {
    switchTab('envios_flex');
    setTimeout(() => { // Aguarda a aba ser trocada antes de centralizar
        const latLng = marker.getLatLng();
        mapFlex.setView(latLng, 16);
        marker.openPopup();
        document.getElementById('map-flex')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 350);
  } else {
    showToast("Aguardando carregamento das coordenadas no mapa...");
  }
}

// UI small utils
function showLoading(on){ const el = document.getElementById('loadingOverlay') || document.getElementById('loading-overlay'); if(el) el.style.display = on ? 'flex' : 'none'; }
function showToast(msg, ms=2500){ const t=document.getElementById('toast') || document.getElementById('toast-container'); if(!t) { console.log(msg); return; } t.innerHTML=String(msg); t.style.display='block'; setTimeout(()=>t.style.display='none', ms); }

// --- JSONP updates (única versão mantida) ---
function updateStatusJsonp(id, status, observacao = ''){
  showLoading(true);

  // Normaliza o status que vamos enviar para o backend
  let sendStatus = status;
  if (status === 'Pronto p/ Entrega') {
    sendStatus = 'Separado';
  }

  const hoje = new Date();
  const yyyy = hoje.getFullYear();
  const mm = String(hoje.getMonth() + 1).padStart(2, '0');
  const dd = String(hoje.getDate()).padStart(2, '0');
  const dataSeparacaoBR = `${dd}/${mm}/${yyyy}`;

  const url = `${API}?action=updateStatus&id=${encodeURIComponent(id)}&status=${encodeURIComponent(sendStatus)}&operador=${encodeURIComponent(currentOperator)}&observacao=${encodeURIComponent(observacao)}&dataSeparacao=${encodeURIComponent(dataSeparacaoBR)}`;

  jsonpFetch(url, function(err, response){
  showLoading(false);
  if(err) { showToast('Erro ao atualizar status', 3500); return; }
  // Aqui: se o status enviado indica que o pedido está pronto para entrega, notifica motorista
  const normalizedSend = sendStatus.toLowerCase();
  if (normalizedSend === 'separado' || normalizedSend === 'pronto p/ entrega') {
    // encontra o pedido localmente para enviar ao motorista
    const order = (orders || []).find(o => String(o.id) === String(id) || String(o.numero) === String(id));
    if (order) {
      sendDriverNotification(order).then(res => {
        console.info('Driver notification result', res);
      }).catch(err => console.warn('Driver notify error', err));
    }
  }
  load();
  setTimeout(()=>{ if(typeof switchTab === 'function') switchTab('logistica'); }, 600);
});
}

function updateFlexStatusJsonp(id, status, observacao = '', cb){
  showLoading(true);
  const url = `${API_FLEX}?action=updateStatus&id=${encodeURIComponent(id)}&status=${encodeURIComponent(status)}&operador=${encodeURIComponent(currentOperator)}&observacao=${encodeURIComponent(observacao)}`;
  jsonpFetch(url, function(err, resp){
    showLoading(false);
    if(typeof cb === 'function') cb(err, resp);
    load();
  });
}

function updateAlarmTimeJsonp(id, timeValue) {
  if (!timeValue) return;
  showLoading(true);
  const url = `${API}?action=updateStatus&id=${id}&alarme=${encodeURIComponent(timeValue)}&operador=${encodeURIComponent(currentOperator)}`;
  jsonpFetch(url, function(){ showLoading(false); load(); });
}

function markFlexDelivered(id, numero){
  if(!id) return;
  if(!confirm(`Confirmar entrega do Flex ${numero || id} ?`)) return;
  const f = (flexOrders||[]).find(x => String(x.id || x.numero) === String(id));
  updateFlexStatusJsonp(id, 'Entregue', `Confirmado via painel por ${currentOperator}`, function(err, resp){
    if(f){
      const newOrder = { id: f.id || f.numero || (`flex-${Date.now()}`), numero: f.numero || f.id || '', cliente_nome: f.destinatario || f.cliente || f.nome || '', endereco_completo: f.endereco_completo || '', tempo_separacao: '—', status_logistica: 'Entregue' };
      flexOrders = (flexOrders || []).filter(x => String(x.id || x.numero) !== String(id));
      orders = orders || [];
      orders.push(newOrder);
      scheduleRender();
      switchTab('entregues');
      showToast(`Flex ${numero || id} marcado como entregue.`);
    } else {
      load();
      showToast(`Atualizando — verifique se Flex ${numero || id} foi registrado.`);
    }
  });
}

function switchTab(which){
  document.getElementById('view-tarefas')?.classList.toggle('hidden', which !== 'tarefas');
  if(document.getElementById('main-tarefas')) document.getElementById('main-tarefas').className = which === 'tarefas' ? 'tab-btn active' : 'tab-btn';
  document.getElementById('view-separacao')?.classList.toggle('hidden', which !== 'separacao');
  document.getElementById('view-separados_hoje')?.classList.toggle('hidden', which !== 'separados_hoje');
  document.getElementById('view-logistica')?.classList.toggle('hidden', which !== 'logistica');
  document.getElementById('view-envios_flex')?.classList.toggle('hidden', which !== 'envios_flex');
  document.getElementById('view-rotas')?.classList.toggle('hidden', which !== 'rotas');
  document.getElementById('view-entregues')?.classList.toggle('hidden', which !== 'entregues');
  document.getElementById('view-motorista')?.classList.toggle('hidden', which !== 'motorista');
  
  if(document.getElementById('main-sep')) document.getElementById('main-sep').className = which === 'separacao' ? 'tab-btn active' : 'tab-btn';
  if(document.getElementById('main-sephoje')) document.getElementById('main-sephoje').className = which === 'separados_hoje' ? 'tab-btn active' : 'tab-btn';
  if(document.getElementById('main-log')) document.getElementById('main-log').className = which === 'logistica' ? 'tab-btn active' : 'tab-btn';
  if(document.getElementById('main-flex')) document.getElementById('main-flex').className = which === 'envios_flex' ? 'tab-btn active' : 'tab-btn';
  if(document.getElementById('main-rotas')) document.getElementById('main-rotas').className = which === 'rotas' ? 'tab-btn active' : 'tab-btn';
  if(document.getElementById('main-ent')) document.getElementById('main-ent').className = which === 'entregues' ? 'tab-btn active' : 'tab-btn';
  if(document.getElementById('main-mot')) document.getElementById('main-mot').className = which === 'motorista' ? 'tab-btn active' : 'tab-btn';
  
  if(which === 'logistica') {
    setTimeout(() => {
      try {
        if (map) map.invalidateSize();
        const b = markerCluster && markerCluster.getBounds && markerCluster.getBounds();
        if(b && b.isValid && b.isValid()) map.fitBounds(b.pad(0.12), { maxZoom: 14, animate: false });
      } catch(e){}
    }, 250);
  }
  if(which === 'envios_flex') { 
    setTimeout(() => {
      try { 
        if (mapFlex) mapFlex.invalidateSize(); 
        if(markerClusterFlex && markerClusterFlex.getLayers && markerClusterFlex.getLayers().length > 0){
          const b = markerClusterFlex.getBounds();
          if(b && b.isValid && b.isValid()) {
            if(b.getSouthWest().equals(b.getNorthEast())) mapFlex.setView(b.getSouthWest(), 14);
            else mapFlex.fitBounds(b.pad(0.12), { maxZoom: 14, animate: false });
          }
        }
      } catch(e){}
    }, 300);
  }
  if(which === 'rotas') {
    setTimeout(() => {
       try { if (typeof plotRotasMap === 'function') plotRotasMap(); } catch(e){}
       try { if (typeof renderRotas === 'function') renderRotas(); } catch(e){}
    }, 300);
  }
  if(which === 'motorista') {
    setTimeout(() => {
      if(typeof resizeCanvas === 'function') resizeCanvas();
    }, 200);
  }
}

function switchSubTab(name){
  document.getElementById('subview-fila')?.classList.toggle('hidden', name !== 'fila');
  document.getElementById('subview-pendencias')?.classList.toggle('hidden', name !== 'pendencias');
  document.getElementById('sub-fila') && (document.getElementById('sub-fila').className = name==='fila' ? 'bg-slate-900 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-sm transition-all' : 'bg-slate-50 text-slate-600 hover:bg-slate-100 px-4 py-2 rounded-xl text-xs font-bold border border-slate-200 transition-all');
  document.getElementById('sub-pend') && (document.getElementById('sub-pend').className = name==='pendencias' ? 'bg-slate-900 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-sm transition-all' : 'bg-slate-50 text-slate-600 hover:bg-slate-100 px-4 py-2 rounded-xl text-xs font-bold border border-slate-200 transition-all');
}

function checkOperator() { if (!currentOperator) { const modal = document.getElementById('operatorModal'); if(modal) modal.classList.remove('hidden'); } else { const el = document.getElementById('activeOperatorDisplay'); if(el) el.innerText = `Op: ${currentOperator}`; } }
function saveOperator() { const name = (document.getElementById('operatorNameInput')?.value || '').trim(); if(name) { localStorage.setItem('vesco_operator', name); currentOperator = name; const modal = document.getElementById('operatorModal'); if(modal) modal.classList.add('hidden'); const el = document.getElementById('activeOperatorDisplay'); if(el) el.innerText = `Op: ${currentOperator}`; } }

// --- Eventos da tabela foram removidos, usamos os botões Crosshair e Onclick da Row ---
document.addEventListener('DOMContentLoaded', function(){
  (function ensureFlexScrollableInit(){
    const flexCard = document.querySelector('#view-envios_flex .card');
    if(flexCard){
      const offset = 240;
      flexCard.style.maxHeight = (window.innerHeight - offset) + 'px';
      flexCard.style.overflowY = 'auto';
      flexCard.style.overflowX = 'auto';
    }
  })();
});

// --- Inicialização principal (bootstrap) ---
document.addEventListener('DOMContentLoaded', function() {
  try {
    setTodayDate();
    initMap();
    let attempts = 0;
    const tryInit = setInterval(()=>{ attempts++; if(window._vesco_map_inited) { clearInterval(tryInit); return; } initMap(); if(attempts>6) clearInterval(tryInit); }, 500);

    checkOperator();
    load();

    // Preservado, porém controlado: o painel não atualiza sozinho; somente pelo botão Atualizar.
    if (!window.VESCO_DISABLE_AUTO_REFRESH) setInterval(load, 60000);
    setInterval(()=> {
      const horaBrasiliaStr = new Date().toLocaleTimeString('pt-BR', {timeZone: 'America/Sao_Paulo'});
      const clockEl = document.getElementById('clock');
      if (clockEl) clockEl.innerText = horaBrasiliaStr;
      if (typeof window.checkTimeAlarms === 'function') window.checkTimeAlarms(horaBrasiliaStr);
    }, 1000);
  } catch(e) {
    console.warn('Erro na inicialização principal', e);
  }
});

function setTodayDate() {
  const dBr = new Date();
  const offset = dBr.getTimezoneOffset();
  const topCalendar = document.getElementById('topCalendar');
  if (topCalendar) {
    const savedISO = currentOperationalDateISO || localStorage.getItem('vesco_operational_date_iso') || '';
    topCalendar.value = dateValueToISO(savedISO) || new Date(dBr.getTime() - (offset*60*1000)).toISOString().split('T')[0];
    if (typeof setSelectedOperationalDateISO === 'function') setSelectedOperationalDateISO(topCalendar.value);
  }
}
// =================================================================
// 1. SISTEMA DE NOTIFICAÇÕES E RASTREIO DE OPERADOR
// =================================================================

function showToast(msg, type = 'info', ms = 4000) {
  const t = document.getElementById('toast') || document.getElementById('toast-container');
  if(!t) { console.log(msg); return; }
  
  let bg = 'bg-slate-800';
  if(type === 'success') bg = 'bg-emerald-600';
  if(type === 'warning') bg = 'bg-amber-500';
  if(type === 'error') bg = 'bg-red-600';

  t.className = `toast fixed top-4 right-4 ${bg} text-white px-5 py-3 rounded-xl shadow-2xl font-bold text-sm flex items-center gap-3 z-[9999] transition-all transform translate-y-0 opacity-100`;
  t.innerHTML = `<i class="fas fa-bell"></i> <div>${msg}</div>`;
  t.style.display = 'flex';
  
  setTimeout(() => {
    t.classList.add('opacity-0', '-translate-y-5');
    setTimeout(() => t.style.display = 'none', 300);
  }, ms);
}

// Atualizamos a função de enviar o status para gerar a notificação na tela
// (A versão unificada está acima — esta chamada adicional é compatibilidade)
window.moverParaPendenciaPrompt = (id) => {
  document.getElementById('pendenciaId').value = id;
  document.getElementById('pendenciaPedidoDisplay').innerText = `Pedido #${id}`;
  document.getElementById('pendenciaDetalhes').value = '';
  document.getElementById('pendenciaModal').classList.remove('hidden');
};

window.fecharPendenciaModal = () => {
  document.getElementById('pendenciaModal').classList.add('hidden');
};

window.salvarPendenciaModal = () => {
  const id = document.getElementById('pendenciaId').value;
  const motivo = document.getElementById('pendenciaMotivo').value;
  const detalhes = document.getElementById('pendenciaDetalhes').value;
  
  if(detalhes.trim() === '') return alert("Por favor, especifique os detalhes/produtos faltantes.");
  
  const observacaoFinal = `[${motivo}] ${detalhes}`;
  fecharPendenciaModal();
  updateStatusJsonp(id, 'Pendente', observacaoFinal);
};

// --- Alarme / pop-up ---
window.checkTimeAlarms = (horaAtualStr) => {
  const horaMinutoAtual = horaAtualStr.slice(0, 5); 
  (orders || []).forEach(o => {
    if (o.alarme && o.alarme === horaMinutoAtual && !o.alarmeTocado) {
      o.alarmeTocado = true;
      if(typeof playBeepSound === 'function') playBeepSound();
      const modal = document.getElementById('snoozeModal');
      const numDisplay = document.getElementById('modalOrderNum');
      if (modal && numDisplay) {
        numDisplay.innerText = `#${o.numero || o.id}`;
        modal.classList.remove('hidden');
      }
    }
  });
};
document.getElementById('btnSnoozeAction')?.addEventListener('click', function() {
  document.getElementById('snoozeModal')?.classList.add('hidden');
  stopAudioAlarm();
});

// =================================================================
// ASSINATURA DIGITAL (APP MOTORISTA) & envios
// =================================================================
let canvas, ctx, desenhando = false;
function resizeCanvas() {
  if(!canvas) return;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#1e293b';
}
function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const ev = e.touches ? e.touches[0] : e;
  return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
}
function startPosition(e) { desenhando = true; draw(e); }
function endPosition() { desenhando = false; ctx && ctx.beginPath(); }
function draw(e) {
  if (!desenhando || !ctx) return;
  e.preventDefault();
  const pos = getPos(e);
  ctx.lineTo(pos.x, pos.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y);
}
document.addEventListener("DOMContentLoaded", () => {
  canvas = document.getElementById('signatureCanvas');
  if(!canvas) return;
  ctx = canvas.getContext('2d');
  canvas.addEventListener('mousedown', startPosition);
  canvas.addEventListener('mouseup', endPosition);
  canvas.addEventListener('mousemove', draw);
  canvas.addEventListener('touchstart', startPosition, {passive: true});
  canvas.addEventListener('touchend', endPosition);
  canvas.addEventListener('touchmove', draw, {passive: false});
});

window.limparAssinatura = () => {
  if(ctx && canvas) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
  }
};

window.enviarComprovante = () => {
  const pedidoId = document.getElementById('motPedidoInput').value.trim();
  const recebedor = document.getElementById('motRecebedor').value.trim();
  const documento = document.getElementById('motDocumento').value.trim();
  const transportador = document.getElementById('motTransportador').value;
  
  if(!pedidoId || !recebedor) return alert("Por favor, preencha o Nome de quem recebeu a mercadoria.");
  
  const docLimpo = (documento || '').replace(/\D/g, '');
  if (docLimpo.length < 8 || docLimpo.length > 14) {
      return alert("Documento inválido. Digite um RG ou CPF real (mínimo de 8 números).");
  }
  showLoading(true);

  const info = getOrderAndApi(pedidoId);
  const realId = info.order ? (info.order.id || info.order.numero) : pedidoId;

  const docFinal = documento || 'Não informado';
  const msgAudit = `Entregue via: ${transportador || '—'} | Recebido por: ${recebedor} (Doc: ${docFinal})`;

  if (info.order) {
      info.order.status_logistica = 'Entregue';
      info.order.situacao_nome = 'Entregue'; 
      info.order.nome_recebedor = recebedor;
      info.order.doc_recebedor = docFinal;
  }

  const form = document.getElementById('form-assinatura-motorista');
  if (form) form.classList.add('hidden');
  document.getElementById('motRecebedor').value = '';
  document.getElementById('motDocumento').value = '';
  
  if (typeof renderMotorista === 'function') renderMotorista();
  if (typeof render === 'function') render();
  
  const url = `${info.api}?action=updateStatus&id=${encodeURIComponent(realId)}&status=Entregue&operador=${encodeURIComponent(currentOperator)}&observacao=${encodeURIComponent(msgAudit)}`;
  
  jsonpFetch(url, function(){ 
     showLoading(false);
     showToast(`Entrega #${pedidoId} finalizada com sucesso!`, 'success', 5000);
     load(); 
  });
};

// =================================================================
// FUNÇÕES MOTORISTA / DESPACHO
// =================================================================
function getOrderAndApi(rawId) {
    const norm = String(rawId || '').replace(/[^0-9A-Za-z]/g, '');
    if (typeof flexOrders !== 'undefined') {
        const f = flexOrders.find(o => String(o.numero || o.id).replace(/[^0-9A-Za-z]/g, '') === norm || String(o.id).replace(/[^0-9A-Za-z]/g, '') === norm);
        if (f) return { order: f, api: API_FLEX };
    }
    if (typeof orders !== 'undefined') {
        const o = orders.find(x => String(x.numero || x.id).replace(/[^0-9A-Za-z]/g, '') === norm || String(x.id).replace(/[^0-9A-Za-z]/g, '') === norm);
        if (o) return { order: o, api: API };
    }
    return { order: null, api: typeof API !== 'undefined' ? API : '' };
}

window.renderMotorista = () => {
  const tbodyMot = document.getElementById('table-motorista');
  if (!tbodyMot) return;

  const todosPedidos = [...(typeof orders !== 'undefined' ? orders : []), ...(typeof flexOrders !== 'undefined' ? flexOrders : [])];
  const emRota = todosPedidos.filter(o => String(o.status_logistica || o.situacao_nome || '').toLowerCase() === 'despachado');

  if (emRota.length === 0) {
    tbodyMot.innerHTML = `<tr><td colspan="3" class="p-8 text-center text-slate-400 font-bold"><i class="fas fa-box-open text-3xl mb-2 block"></i>Nenhuma entrega em rota no momento.</td></tr>`;
    return;
  }

  tbodyMot.innerHTML = emRota.map(o => `
    <tr class="hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0">
      <td class="p-3 font-black text-slate-800 text-sm">#${escapeHtml(o.numero || o.id)}</td>
      <td class="p-3 leading-tight">
        <span class="font-bold text-slate-700 text-sm">${escapeHtml(o.cliente_nome || o.destinatario || '')}</span><br>
        <span class="text-[11px] text-slate-400 font-normal"><i class="fas fa-location-dot text-slate-300 mr-1"></i>${escapeHtml(o.endereco_completo || o.endereco || '')}</span>
      </td>
      <td class="p-3 text-right">
        <button onclick="abrirAssinaturaMotorista('${escapeHtml(o.numero || o.id)}')" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-bold text-[11px] shadow-sm transition-all uppercase whitespace-nowrap"><i class="fas fa-signature mr-1"></i> Entregar</button>
      </td>
    </tr>
  `).join('');
};

window.prepararDespachoMotorista = (numeroPedido) => {
  const info = getOrderAndApi(numeroPedido);
  const realId = info.order ? (info.order.id || info.order.numero) : numeroPedido;

  if (info.order) {
      info.order.status_logistica = 'Despachado';
      info.order.situacao_nome = 'Despachado';
  }

  showToast(`Pedido #${numeroPedido} Despachado com sucesso!`, 'success', 4000);
  switchTab('motorista');

  if (typeof renderMotorista === 'function') renderMotorista();
  if (typeof render === 'function') render();

  const url = `${info.api}?action=updateStatus&id=${encodeURIComponent(realId)}&status=Despachado&operador=${encodeURIComponent(currentOperator)}&observacao=Saiu%20para%20entrega`;

  jsonpFetch(url, function() {
    console.log("Despacho gravado. ID Real: " + realId);
  });
};

window.abrirAssinaturaMotorista = (numeroPedido) => {
  const form = document.getElementById('form-assinatura-motorista');
  if (form) form.classList.remove('hidden'); 
  
  const inputPedido = document.getElementById('motPedidoInput');
  if (inputPedido) inputPedido.value = numeroPedido; 

  const inputRecebedor = document.getElementById('motRecebedor');
  if (inputRecebedor) {
    inputRecebedor.value = ''; 
    inputRecebedor.focus();
  }
  
  if (form) form.scrollIntoView({ behavior: 'smooth', block: 'end' });
};

// =================================================================
// PENDÊNCIAS / SOLUÇÃO (vendedor)
// =================================================================
window.salvarSolucaoPendencia = function(id) {
  const inputSolucao = document.getElementById(`solucao-${id}`);
  const inputLink = document.getElementById(`link-${id}`);
  
  if(!inputSolucao || !inputSolucao.value.trim()) return alert("Operação cancelada: Informe o produto para continuar!");
  
  const solucaoTxt = inputSolucao.value.trim();
  const linkTxt = inputLink ? inputLink.value.trim() : '';
  
  if(!linkTxt) {
      return alert("Operação cancelada: É OBRIGATÓRIO colar o link do pedido atualizado no Tiny ERP para liberar a separação!");
  }
  
  const order = orders.find(o => String(o.id) === String(id) || String(o.numero) === String(id));
  const currentObs = order ? (order.observacao_logistica || order.observacao || '') : 'Pendente';
  
  const novaObs = `${currentObs} | [Solução] ${solucaoTxt} [Link] ${linkTxt}`;
  
  showLoading(true);
  
  const url = `${API}?action=updateStatus&id=${encodeURIComponent(id)}&status=Pendente&operador=${encodeURIComponent(currentOperator)}&observacao=${encodeURIComponent(novaObs)}`;
  
  jsonpFetch(url, function(){
    showLoading(false);
    showToast(`Solução registrada. Liberado para separação!`, 'success');
    load();
  });
};

window.editarSolucaoPendencia = function(id) {
  const order = orders.find(o => String(o.id) === String(id) || String(o.numero) === String(id));
  if (!order) return;
  
  const currentObs = order.observacao_logistica || order.observacao || '';
  const obsLimpa = currentObs.split('| [Solução]')[0].trim();
  
  showLoading(true);
  
  const url = `${API}?action=updateStatus&id=${encodeURIComponent(id)}&status=Pendente&operador=${encodeURIComponent(currentOperator)}&observacao=${encodeURIComponent(obsLimpa)}`;
  
  jsonpFetch(url, function(){
    showLoading(false);
    load(); // Atualiza a tela
  });
};

// =================================================================
// TAREFAS FROTA (front)
// =================================================================
window.tarefasFrota = window.tarefasFrota || [];

window.adicionarTarefaFrota = function() {
  const tipo = document.getElementById('novaTarefaTipo')?.value || 'Externa';
  const local = document.getElementById('novaTarefaLocal')?.value.trim() || '';
  const endereco = document.getElementById('novaTarefaEndereco')?.value.trim() || '';
  const motorista = document.getElementById('novaTarefaMotorista')?.value.trim() || '';
  
  if(!local || !motorista) return alert("Por favor, preencha o Local e o Motorista/Horário.");
  
  const novaTarefa = {
    id: Date.now(),
    tipo: tipo,
    local: local,
    endereco: endereco || '—',
    motorista: motorista,
    horaRegistro: new Date().toLocaleTimeString('pt-BR').slice(0,5)
  };
  
  window.tarefasFrota.push(novaTarefa);
  
  document.getElementById('novaTarefaLocal') && (document.getElementById('novaTarefaLocal').value = '');
  document.getElementById('novaTarefaEndereco') && (document.getElementById('novaTarefaEndereco').value = '');
  document.getElementById('novaTarefaMotorista') && (document.getElementById('novaTarefaMotorista').value = '');
  
  renderTarefasFrota();
  showToast("Tarefa registrada com sucesso! Motorista liberado.", "info");
};

window.concluirTarefaFrota = function(id) {
  window.tarefasFrota = window.tarefasFrota.filter(t => t.id !== id);
  renderTarefasFrota();
  showToast("Tarefa concluída! Motorista retornou à base.", "success");
};

window.renderTarefasFrota = function() {
  const tbody = document.getElementById('table-tarefas');
  if(!tbody) return;
  
  if(window.tarefasFrota.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-slate-400 font-semibold">Nenhuma tarefa externa em andamento.</td></tr>`;
    return;
  }
  
  tbody.innerHTML = window.tarefasFrota.map(t => `
    <tr class="hover:bg-slate-50 transition-colors border-b border-slate-100 text-xs md:text-sm">
      <td class="p-3 pl-4">
        <div class="font-bold text-teal-700 flex items-center gap-1.5"><i class="fas fa-truck text-slate-400"></i> ${escapeHtml(t.tipo)}</div>
        <div class="text-slate-800 font-semibold mt-0.5">${escapeHtml(t.local)}</div>
      </td>
      <td class="p-3 text-slate-500 font-medium">${escapeHtml(t.endereco)}</td>
      <td class="p-3 text-center">
        <div class="inline-flex items-center gap-2 bg-slate-100 px-3 py-1 rounded-lg border border-slate-200">
          <span class="font-bold text-slate-700">${escapeHtml(t.motorista)}</span>
          <span class="text-[10px] text-slate-400"><i class="far fa-clock"></i> Reg: ${escapeHtml(t.horaRegistro)}</span>
        </div>
      </td>
      <td class="p-3 pr-4 text-right">
        <button onclick="concluirTarefaFrota(${t.id})" class="bg-white hover:bg-emerald-50 text-emerald-600 border border-emerald-200 px-4 py-2 rounded-lg font-bold text-[11px] shadow-sm transition-all uppercase"><i class="fas fa-check mr-1"></i> Retornou</button>
      </td>
    </tr>
  `).join('');
};

// Compatibilidade: quando a aba 'tarefas' for aberta, renderiza
const switchTabBackupTarefas = window.switchTab;
window.switchTab = function(which) {
  if (typeof switchTabBackupTarefas === 'function') {
      switchTabBackupTarefas(which);
  }
  if (which === 'tarefas' && typeof renderTarefasFrota === 'function') {
      renderTarefasFrota();
  }
};

// Export util para debug
window.appDebug = { load, render, orders, flexOrders, updateStatusJsonp, updateFlexStatusJsonp, plotMapMarkers, initMap };

console.log('app.js atualizado carregado — Logística corrigida e otimizações aplicadas.');
// ================================
// ================================
// Aba "Saiu para entrega" — Rotas
// ================================
(function () {
  const STORAGE_KEY = 'vesco_saiu_rotas_v1';

  window.saiuRotas = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  window.rotaTemp = window.rotaTemp || { motorista: '', nome: '', pedidos: [] };

  function persistRotas() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(window.saiuRotas || []));
  }

  function getPedidosSeparadosHoje() {
    const source = [...(window.orders || []), ...(window.flexOrders || [])];

    return source.filter(o => {
      try {
        if (typeof shouldShowSeparatedForOperationalDate === 'function') {
          return shouldShowSeparatedForOperationalDate(o);
        }

        const rawStatus = String(o.status_logistica || o.situacao_nome || o.situacao || o.status || '').toLowerCase();
        const flagHoje = !!(o.separadoHoje || o.separado_hoje || o.separados_hoje || o.separado_today || o.separadoHojeFlag);
        if (rawStatus.includes('separ') && flagHoje) return true;
        return false;
      } catch (e) {
        return false;
      }
    }).map(o => ({
      id: o.id || o.numero || '',
      numero: normalizeOrderNumber(o.numero || o.id || ''),
      cliente: extractClientNameFromAny(o) || o.cliente_nome || o.razao_social || '',
      endereco: o.endereco_completo || o.endereco || o.logradouro || '',
      raw: o
    }));
  }

  function getSelectedEcomsForRoute() {
    const checkboxes = document.querySelectorAll('#saiu-pedidos-list input[type="checkbox"]:checked');
    return Array.from(checkboxes).map(cb => {
      const ecom =
        cb.getAttribute('data-num') ||
        cb.getAttribute('data-ecom') ||
        cb.value ||
        cb.closest('.pedido-item')?.querySelector('input[type="checkbox"]')?.getAttribute('data-num') ||
        '';
      if (ecom && ecom !== 'on') return String(ecom).trim();

      const rowText = cb.closest('.pedido-item')?.innerText || cb.closest('.saiu-row')?.innerText || '';
      const match = rowText.match(/#?(\d{5,})/);
      return match ? match[1] : null;
    }).filter(Boolean);
  }

  function renderSelectedTemp() {
    const el = document.getElementById('saiu-rota-selected') || document.getElementById('pedidos-rota-lista');
    if (!el) return;

    const pedidos = getSelectedEcomsForRoute();

    if (pedidos.length === 0) {
      el.innerHTML = `<div class="p-2 text-slate-500 text-sm">Nenhum pedido selecionado.</div>`;
      return;
    }

    el.innerHTML = pedidos.map(id => `
      <div class="flex justify-between items-center p-2 bg-blue-50 mb-1 rounded border border-blue-100 text-xs">
        <span class="font-bold">#${escapeHtml(id)}</span>
        <button type="button" class="text-red-500" onclick="window.desmarcarPedido('${escapeHtml(id)}')">×</button>
      </div>
    `).join('');
  }

  window.renderSelectedTemp = renderSelectedTemp;

  window.desmarcarPedido = function (ecom) {
    const cb =
      document.querySelector(`#saiu-pedidos-list input[type="checkbox"][data-num="${ecom}"]`) ||
      document.querySelector(`#saiu-pedidos-list input[type="checkbox"][data-ecom="${ecom}"]`) ||
      Array.from(document.querySelectorAll('#saiu-pedidos-list input[type="checkbox"]')).find(input => {
        const row = input.closest('.pedido-item') || input.closest('.saiu-row');
        return row && row.innerText.includes(`#${ecom}`);
      });

    if (cb) {
      cb.checked = false;
      renderSelectedTemp();
    }
  };

  function renderPedidosDisponiveis() {
    const el = document.getElementById('saiu-pedidos-list');
    if (!el) return;

    const list = getPedidosSeparadosHoje();

    if (list.length === 0) {
      const dataTxt = (typeof isoToBRDate === 'function' && typeof getSelectedOperationalDateISO === 'function') ? isoToBRDate(getSelectedOperationalDateISO()) : 'hoje';
      el.innerHTML = `<div class="p-4 text-slate-500 text-sm">Nenhum pedido separado disponível para ${escapeHtml(dataTxt)}.</div>`;
      return;
    }

    const checkedSet = new Set(getSelectedEcomsForRoute());

    const header = `
      <div class="flex items-center justify-between mb-2">
        <div class="text-sm text-slate-600 font-semibold">${list.length} pedido(s) separado(s) disponíveis na data selecionada</div>
        <button type="button" id="saiu-selecionar-tudo" class="text-xs bg-slate-100 text-slate-700 px-3 py-1 rounded">
          Selecionar todos
        </button>
      </div>
    `;

    const items = list.map(p => {
      const pid = String(p.numero || p.id || '').trim();
      const checked = checkedSet.has(pid) ? 'checked' : '';

      return `
        <div class="flex items-start gap-3 p-3 border rounded mb-2 bg-white shadow-sm pedido-item" data-num="${escapeHtml(pid)}">
          <div class="flex-none">
            <input type="checkbox"
                   data-num="${escapeHtml(pid)}"
                   value="${escapeHtml(pid)}"
                   ${checked}
                   class="mt-1" />
          </div>
          <div class="flex-1">
            <div class="flex items-center justify-between gap-3">
              <div>
                <div class="text-sm font-semibold">#${escapeHtml(pid)} <span class="text-xs text-slate-400 ml-2">${escapeHtml(p.cliente)}</span></div>
                <div class="text-xs text-slate-500 mt-1">${escapeHtml(p.endereco)}</div>
              </div>
              <div class="flex flex-col items-end gap-2">
                <button type="button"
                        class="bg-blue-600 text-white text-xs px-3 py-1 rounded"
                        onclick="focusOrderOnMap('${escapeHtml(pid)}')">
                  Localizar
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    el.innerHTML = header + items;

    const btnAll = document.getElementById('saiu-selecionar-tudo');
    if (btnAll) {
      btnAll.onclick = () => {
        window.rotaTemp.pedidos = list.map(p => String(p.numero || p.id || '').trim()).filter(Boolean);
        renderSelectedTemp();
        renderPedidosDisponiveis();
      };
    }

    el.querySelectorAll('input[type="checkbox"][data-num]').forEach(cb => {
      cb.onchange = function () {
        const v = String(cb.getAttribute('data-num') || cb.value || '').trim();
        window.rotaTemp.pedidos = window.rotaTemp.pedidos || [];

        if (cb.checked) {
          if (!window.rotaTemp.pedidos.includes(v)) window.rotaTemp.pedidos.push(v);
        } else {
          window.rotaTemp.pedidos = window.rotaTemp.pedidos.filter(x => x !== v);
        }

        renderSelectedTemp();
      };
    });
  }

  function renderRotas() {
    const el = document.getElementById('saiu-rotas-list');
    if (!el) return;

    const rotasFiltradas = (window.saiuRotas || []).filter(r => (typeof routeBelongsToOperationalDate === 'function') ? routeBelongsToOperationalDate(r) : true);

    if (!rotasFiltradas || rotasFiltradas.length === 0) {
      const dataTxt = (typeof isoToBRDate === 'function' && typeof getSelectedOperationalDateISO === 'function') ? isoToBRDate(getSelectedOperationalDateISO()) : 'a data selecionada';
      el.innerHTML = `<div class="p-4 text-slate-500">Nenhuma rota criada ou ativa para ${escapeHtml(dataTxt)}.</div>`;
      return;
    }

    el.innerHTML = rotasFiltradas.map(r => {
      const qnt = (r.pedidos || []).length;
      const statusBadge =
        r.status === 'pendente'
          ? '<span class="px-2 py-1 rounded bg-amber-100 text-amber-700 text-xs">Pendente</span>'
          : r.status === 'despachada'
          ? '<span class="px-2 py-1 rounded bg-blue-100 text-blue-700 text-xs">Em Rota</span>'
          : '<span class="px-2 py-1 rounded bg-emerald-100 text-emerald-700 text-xs">Concluída</span>';

      return `
        <div class="border rounded p-3 mb-3">
          <div class="flex justify-between items-start">
            <div>
              <div class="font-bold">
                ${escapeHtml(r.nome)}
                <small class="text-xs text-slate-500 ml-2">(${escapeHtml(r.motorista)})</small>
              </div>
              <div class="text-xs text-slate-500 mt-1">
                ${qnt} pedido(s) • Criada: ${escapeHtml(new Date(r.criadoEm).toLocaleString())}
              </div>
            </div>
            <div class="text-right">
              ${statusBadge}
              <div class="mt-2 space-x-2">
                ${r.status === 'pendente' ? `<button type="button" class="bg-blue-600 text-white px-3 py-1 rounded text-xs" onclick="window.iniciarRota && window.iniciarRota('${escapeHtml(r.id)}')">Iniciar Rota</button>` : ''}
                ${r.status === 'despachada' ? `<button type="button" class="bg-emerald-600 text-white px-3 py-1 rounded text-xs" onclick="window.concluirRota && window.concluirRota('${escapeHtml(r.id)}')">Concluir Rota</button>` : ''}
                <button type="button" class="bg-slate-100 text-slate-700 px-3 py-1 rounded text-xs" onclick="window.verRotaMapa && window.verRotaMapa('${escapeHtml(r.id)}')">Ver no mapa</button>
                <button type="button" class="bg-white text-red-600 border border-red-100 px-3 py-1 rounded text-xs" onclick="window.removerRota && window.removerRota('${escapeHtml(r.id)}')">Remover</button>
              </div>
            </div>
          </div>
          <div class="mt-3 text-xs text-slate-600">
            <b>Pedidos:</b> ${(r.pedidos || []).map(p => `#${escapeHtml(p)}`).join(', ')}
          </div>
        </div>
      `;
    }).join('');
  }

  window.renderRotas = renderRotas;
  window.renderPedidosDisponiveisSaiu = renderPedidosDisponiveis;

  window.iniciarRota = function (rotaId) {
    const rota = (window.saiuRotas || []).find(r => r.id === rotaId);
    if (!rota) return showToast('Rota inexistente', 'error');
    if (!confirm(`Iniciar rota "${rota.nome}" com ${rota.pedidos.length} pedido(s) e motorista ${rota.motorista}?`)) return;

    rota.status = 'despachada';
    persistRotas();
    renderRotas();

    (rota.pedidos || []).forEach((pedidoNum, idx) => {
      setTimeout(() => {
        try {
          updateStatusJsonp(pedidoNum, 'Despachado', `Saiu para entrega — Rota: ${rota.nome} Motorista: ${rota.motorista}`);
        } catch (e) {
          console.warn('Erro ao enviar updateStatusJsonp para', pedidoNum, e);
        }
      }, idx * 400);
    });

    showToast('Rota iniciada — pedidos marcados como Despachado.', 'info', 3500);
    render();
  };

  window.concluirRota = function (rotaId) {
    const rota = (window.saiuRotas || []).find(r => r.id === rotaId);
    if (!rota) return showToast('Rota inexistente', 'error');
    if (!confirm(`Confirmar conclusão da rota "${rota.nome}"? Isso marcará ${rota.pedidos.length} pedido(s) como Entregue.`)) return;

    rota.status = 'concluida';
    rota.concluidaEm = new Date().toISOString();
    persistRotas();
    renderRotas();

    (rota.pedidos || []).forEach((pedidoNum, idx) => {
      setTimeout(() => {
        try {
          updateStatusJsonp(pedidoNum, 'Entregue', `Rota concluída: ${rota.nome} Motorista: ${rota.motorista}`);
        } catch (e) {
          console.warn('Erro ao enviar updateStatusJsonp para', pedidoNum, e);
        }
      }, idx * 400);
    });

    showToast('Rota concluída — pedidos marcados como Entregue.', 'success', 3500);
    render();
  };

  window.removerRota = function (id) {
    if (!confirm('Remover rota permanentemente?')) return;
    window.saiuRotas = (window.saiuRotas || []).filter(r => r.id !== id);
    persistRotas();
    renderRotas();
  };

  window.verRotaMapa = async function (id) {
    const rota = (window.saiuRotas || []).find(r => r.id === id);
    if (!rota) return showToast('Rota não encontrada', 'error');

    for (const pedidoNum of (rota.pedidos || [])) {
      const marker = findMainMarkerByKey(pedidoNum) || findFlexMarkerByKey(pedidoNum);
      if (marker) {
        try {
          const latLng = marker.getLatLng();
          if (marker._icon && map) {
            switchTab('logistica');
            setTimeout(() => { map.setView(latLng, 15); marker.openPopup(); }, 400);
          } else if (mapFlex) {
            switchTab('envios_flex');
            setTimeout(() => { mapFlex.setView(latLng, 15); marker.openPopup(); }, 400);
          }
          await new Promise(r => setTimeout(r, 900));
        } catch (e) {}
      }
    }

    showToast('Navegação pela rota concluída.', 'info', 2500);
  };

  function initSaiu() {
    renderPedidosDisponiveis();
    renderSelectedTemp();
    renderRotas();
  }

  const switchTabBackupForSaiu = window.switchTab;
  window.switchTab = function (which) {
    if (typeof switchTabBackupForSaiu === 'function') switchTabBackupForSaiu(which);
    document.getElementById('view-saiu')?.classList.toggle('hidden', which !== 'saiu');
    if (which === 'saiu') initSaiu();
  };

  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('btnCriarRota') || document.getElementById('btn-criar-rota');
    if (btn) {
      btn.onclick = null;
      btn.addEventListener('click', function (e) {
        e.preventDefault();

        const motorista = (document.getElementById('rotaMotorista')?.value || '').trim();
        const nome = (document.getElementById('rotaNome')?.value || '').trim() || `Rota ${new Date().toLocaleString()}`;
        const pedidos = getSelectedEcomsForRoute();

        if (!motorista) return alert('Informe o nome do motorista.');
        if (pedidos.length === 0) return alert('Adicione ao menos 1 pedido à rota.');

        const nova = {
          id: 'rota-' + Date.now(),
          nome,
          motorista,
          pedidos: Array.from(new Set(pedidos)),
          status: 'pendente',
          criadoEm: new Date().toISOString()
        };

        window.saiuRotas.push(nova);
        persistRotas();

        window.rotaTemp = { motorista: '', nome: '', pedidos: [] };

        const motorEl = document.getElementById('rotaMotorista');
        const nomeEl = document.getElementById('rotaNome');
        if (motorEl) motorEl.value = '';
        if (nomeEl) nomeEl.value = '';

        renderPedidosDisponiveis();
        renderSelectedTemp();
        renderRotas();

        showToast('Rota criada com sucesso!', 'success');
      });
    }
  });

  window.renderSelectedTemp = renderSelectedTemp;
  window._saiuDebug = {
    renderRotas,
    renderPedidosDisponiveis,
    getPedidosSeparadosHoje,
    getSelectedEcomsForRoute,
    persistRotas
  };

})();
/* 
   EVOLUÇÃO LOGÍSTICA - CAMADA DE RESILIÊNCIA DE GEOCODIFICAÇÃO (REGRA DE PRESERVAÇÃO ATIVA)
   Esta camada intercepta falhas de rede e redireciona para o Proxy do Google Apps Script.
*/

// CONSTANTE DE CONFIGURAÇÃO (Substitua pela URL do seu Script Web App implantado)
/* 
   EVOLUÇÃO LOGÍSTICA - CAMADA DE RESILIÊNCIA DE GEOCODIFICAÇÃO
   Preserva a função original e usa JSONP para evitar CORS.
*/

const GAS_GEO_PROXY_URL = "https://script.google.com/macros/s/AKfycbxEzbxBABMDwi7B7tn_1p-lC0vc50JjHFOrH3w42Oog2-5R2-WMYSrQ27ED7wduJUN6/exec";

function geocodeViaVescoProxy(address) {
    return new Promise((resolve) => {
        const callbackName = 'jsonp_callback_' + Math.round(100000 * Math.random());
        const script = document.createElement('script');

        const timeout = setTimeout(() => {
            console.warn("⏱️ Timeout no Geocode Proxy para:", address);
            try { delete window[callbackName]; } catch (e) {}
            if (script.parentNode) script.parentNode.removeChild(script);
            resolve(null);
        }, 4000);

        window[callbackName] = function(data) {
            clearTimeout(timeout);
            try { delete window[callbackName]; } catch (e) {}
            if (script.parentNode) script.parentNode.removeChild(script);

            if (data && data.lat && data.lon) {
                resolve({ lat: parseFloat(data.lat), lon: parseFloat(data.lon) });
            } else {
                resolve(null);
            }
        };

        const url = `${GAS_GEO_PROXY_URL}?action=geocode&address=${encodeURIComponent(address)}&callback=${callbackName}`;
        script.src = url;
        document.body.appendChild(script);
    });
}
/**
 * REINJEÇÃO DE LÓGICA (OVERRIDE SEGURO):
 * Redefinimos a chamada de geocodificação para tentar o Proxy ANTES do Nominatim.
 * Preservamos a função original geocodeAddress renomeando-a ou usando-a como fallback.
 */
const originalGeocodeAddress = typeof geocodeAddress !== 'undefined' ? geocodeAddress : null;

window.geocodeAddress = async function(address) {
    console.log(`🔍 Iniciando Geocodificação Resiliente: ${address}`);
    
    // 1. Tenta via Proxy (Resolução de CORS e 429)
    const proxyCoords = await geocodeViaVescoProxy(address);
    if (proxyCoords) return proxyCoords;

    // 2. Se o proxy falhar, recorre à lógica original (Preservação)
    if (originalGeocodeAddress) {
        console.warn("⚠️ Recorrendo ao método original (Nominatim)...");
        return originalGeocodeAddress(address);
    }

    return null;
};

console.log("🚀 Camada de Resiliência Logística Injetada: CORS/429 mitigados.");
// >>> Proteção segura para o botão "Atualizar" (preserva a função load original)
(function(){
  // Selecionador do botão: mantém compatibilidade com seu HTML atual
  const btnSelector = 'button[onclick="load()"]';
  const btn = document.querySelector(btnSelector);

  // Mantém a referência da função original (se existir)
  const originalLoad = window.load && typeof window.load === 'function' ? window.load : null;

  // Wrapper seguro
  window.load = function safeLoad(...args) {
    // Desabilita botão visualmente
    if (btn) {
      btn.disabled = true;
      btn.classList.add('opacity-60');
      // se quiser adicionar pointer-events-none para bloquear clique
      btn.classList.add('pointer-events-none');
    }

    // Timeout de segurança (10s por padrão) — ajustável
    const SAFETY_TIMEOUT = 10000;
    let timeoutId = setTimeout(() => {
      console.warn('safeLoad: tempo excedido (' + SAFETY_TIMEOUT + 'ms). Reabilitando UI.');
      if (btn) { btn.disabled = false; btn.classList.remove('opacity-60','pointer-events-none'); }
    }, SAFETY_TIMEOUT);

    try {
      // Se não existir a função original, não interrompemos: apenas logamos e retornamos Promise resolvida
      if (!originalLoad) {
        clearTimeout(timeoutId);
        if (btn) { btn.disabled = false; btn.classList.remove('opacity-60','pointer-events-none'); }
        console.warn('safeLoad: função original load() não encontrada.');
        return Promise.resolve();
      }

      // Chama a função original; se retornar Promise, tratamos; se síncrona, também tratamos
      const result = originalLoad.apply(this, args);

      if (result && typeof result.then === 'function') {
        // Promise: aguarda e trata erros
        return result.then(res => {
          clearTimeout(timeoutId);
          if (btn) { btn.disabled = false; btn.classList.remove('opacity-60','pointer-events-none'); }
          return res;
        }).catch(err => {
          clearTimeout(timeoutId);
          if (btn) { btn.disabled = false; btn.classList.remove('opacity-60','pointer-events-none'); }
          console.error('safeLoad: erro na Promise retornada por load():', err);
          // opcional: mostrar feedback ao usuário
          return Promise.reject(err);
        });
      } else {
        // Síncrono: reabilita e retorna valor
        clearTimeout(timeoutId);
        if (btn) { btn.disabled = false; btn.classList.remove('opacity-60','pointer-events-none'); }
        return result;
      }
    } catch (e) {
      // Erro síncrono
      clearTimeout(timeoutId);
      if (btn) { btn.disabled = false; btn.classList.remove('opacity-60','pointer-events-none'); }
      console.error('safeLoad: exceção ao executar load():', e);
      return Promise.reject(e);
    }
  };

  // Global handlers para ajudar no diagnóstico de erros que travam o load
  window.addEventListener('unhandledrejection', function(ev) {
    console.error('UnhandledPromiseRejection:', ev.reason);
  });
  window.addEventListener('error', function(ev) {
    console.error('GlobalError:', ev.error || ev.message || ev);
  });

  console.log('safeLoad instalado — botão Atualizar protegido.');
})();


// =================================================================
// BOTÃO ATUALIZAR + CALENDÁRIO — PRESERVAÇÃO V2
// Esta camada envolve o load já existente, persiste a data do calendário,
// força renderização da data selecionada e mantém compatibilidade com onclick="load()".
// =================================================================
(function installOperationalDateRefreshLayer(){
  const preservedLoad = (typeof window.load === 'function') ? window.load : (typeof load === 'function' ? load : null);

  function setRefreshButtonsDisabled(disabled){
    const selectors = [
      'button[onclick="load()"]',
      '#btnAtualizar', '#btn-atualizar', '#refreshButton', '#btnRefresh',
      '[data-action="refresh"]', '[data-refresh="true"]'
    ];
    const buttons = selectors.flatMap(sel => Array.from(document.querySelectorAll(sel)));
    Array.from(new Set(buttons)).forEach(btn => {
      btn.disabled = !!disabled;
      btn.classList.toggle('opacity-60', !!disabled);
      btn.classList.toggle('pointer-events-none', !!disabled);
    });
  }

  function enhancedLoad(...args){
    const input = getOperationalDateInputElement && getOperationalDateInputElement();
    if(input && input.value && typeof setSelectedOperationalDateISO === 'function') {
      setSelectedOperationalDateISO(input.value);
    }

    setRefreshButtonsDisabled(true);
    if(typeof showLoading === 'function') showLoading(true);

    let finished = false;
    const finish = () => {
      if(finished) return;
      finished = true;
      setRefreshButtonsDisabled(false);
      if(typeof showLoading === 'function') showLoading(false);
      if(typeof syncGlobalOrderState === 'function') syncGlobalOrderState();
      if(typeof scheduleRender === 'function') scheduleRender();
      if(typeof window.renderRotas === 'function') {
        try { window.renderRotas(); } catch(e) {}
      }
    };

    const SAFETY_TIMEOUT = 12000;
    const timer = setTimeout(finish, SAFETY_TIMEOUT);

    try {
      const result = preservedLoad ? preservedLoad.apply(this, args) : null;
      // O load antigo usa JSONP e nem sempre retorna Promise. O timeout curto abaixo
      // atualiza a UI assim que os callbacks começarem a preencher orders/flexOrders.
      setTimeout(() => {
        clearTimeout(timer);
        finish();
      }, 900);

      if(result && typeof result.then === 'function') {
        return result.finally(() => {
          clearTimeout(timer);
          finish();
        });
      }
      return result;
    } catch(e) {
      clearTimeout(timer);
      finish();
      console.error('enhancedLoad: erro ao atualizar pela data operacional:', e);
      throw e;
    }
  }

  window.load = enhancedLoad;
  try { load = enhancedLoad; } catch(e) {}

  function bindOperationalDateControls(){
    const input = getOperationalDateInputElement && getOperationalDateInputElement();
    if(input && !input.dataset.vescoOperationalDateBound) {
      input.dataset.vescoOperationalDateBound = '1';
      if(!input.value && typeof setSelectedOperationalDateISO === 'function') setSelectedOperationalDateISO(getBrazilTodayISO());
      input.addEventListener('change', function(){
        if(typeof setSelectedOperationalDateISO === 'function') setSelectedOperationalDateISO(this.value);
        if(typeof scheduleRender === 'function') scheduleRender();
      });
    }

    const selectors = [
      'button[onclick="load()"]',
      '#btnAtualizar', '#btn-atualizar', '#refreshButton', '#btnRefresh',
      '[data-action="refresh"]', '[data-refresh="true"]'
    ];
    const buttons = selectors.flatMap(sel => Array.from(document.querySelectorAll(sel)));
    Array.from(new Set(buttons)).forEach(btn => {
      if(btn.dataset.vescoRefreshBound) return;
      btn.dataset.vescoRefreshBound = '1';
      const refreshHandler = function(e){
        if(e) {
          e.preventDefault();
          if(typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
          else if(typeof e.stopPropagation === 'function') e.stopPropagation();
        }
        enhancedLoad();
        return false;
      };
      // Substitui apenas o gatilho do botão Atualizar para evitar duplo clique
      // quando já existe onclick="load()" no HTML. A função load antiga foi preservada
      // dentro de preservedLoad/enhancedLoad.
      btn.onclick = refreshHandler;
      btn.addEventListener('click', refreshHandler, true);
    });
  }

  if(document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindOperationalDateControls);
  } else {
    bindOperationalDateControls();
  }

  console.log('Camada de data operacional ativa — Atualizar respeita topCalendar e preserva separados pendentes.');
})();


// =================================================================
// CAMADA DE HISTÓRICO OPERACIONAL — PRESERVAÇÃO V3
// Regra: calendário NÃO filtra por data prevista. Ele consulta o
// histórico do processo: lançado, separado, saiu para entrega e entregue.
// Separado permanece visível nos dias seguintes até sair para entrega
// ou ser marcado como entregue.
// =================================================================
(function installOperationalHistoryV3(){
  const HISTORY_KEY = 'vesco_order_operational_history_v3';
  const LEGACY_HISTORY_KEY = 'vesco_order_history_v1';

  function safeParseJson(str, fallback){
    try { return JSON.parse(str || ''); } catch(e) { return fallback; }
  }

  function loadOperationalHistory(){
    const newer = safeParseJson(localStorage.getItem(HISTORY_KEY), null);
    if(newer && typeof newer === 'object') return newer;
    const legacy = safeParseJson(localStorage.getItem(LEGACY_HISTORY_KEY), null);
    return (legacy && typeof legacy === 'object') ? legacy : {};
  }

  function saveOperationalHistory(hist){
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(hist || {})); } catch(e) {}
  }

  function normalizeHistoryKey(v){
    if(v === null || v === undefined) return '';
    const raw = String(v).trim();
    if(!raw) return '';
    if(typeof normalizeOrderNumber === 'function') {
      const n = normalizeOrderNumber(raw);
      if(n) return n;
    }
    return raw.replace(/^#/, '').replace(/\s+/g, '');
  }

  function getOrderHistoryKeys(input){
    const keys = [];
    const add = (v) => {
      const k = normalizeHistoryKey(v);
      if(k && !keys.includes(k)) keys.push(k);
    };

    if(input && typeof input === 'object') {
      add(input.id);
      add(input.numero);
      add(input.pedido);
      add(input.order_id);
      add(input.orderNumber);
      add(input.reference);
      add(input.referencia);
      add(input.numero_ecommerce);
      if(typeof getEcomNum === 'function') add(getEcomNum(input));
    } else {
      add(input);
    }
    return keys;
  }

  function getHistoryForOrder(input){
    const hist = loadOperationalHistory();
    const keys = getOrderHistoryKeys(input);
    for(const k of keys){
      if(hist[k]) return Object.assign({}, hist[k], { _historyKey: k });
    }
    return {};
  }

  function mergeHistoryAliases(input, patch){
    const hist = loadOperationalHistory();
    const keys = getOrderHistoryKeys(input);
    if(keys.length === 0) return;

    let merged = {};
    for(const k of keys){
      if(hist[k]) merged = Object.assign(merged, hist[k]);
    }
    merged = Object.assign(merged, patch || {});
    merged.updatedAt = new Date().toISOString();

    for(const k of keys){
      hist[k] = Object.assign({}, merged);
    }
    saveOperationalHistory(hist);
  }

  function compareISO(a, b){
    const aa = String(a || '').slice(0, 10);
    const bb = String(b || '').slice(0, 10);
    if(!aa || !bb) return 0;
    return aa < bb ? -1 : (aa > bb ? 1 : 0);
  }

  function minISO(a, b){
    if(!a) return b || '';
    if(!b) return a || '';
    return compareISO(a, b) <= 0 ? a : b;
  }

  function maxISO(a, b){
    if(!a) return b || '';
    if(!b) return a || '';
    return compareISO(a, b) >= 0 ? a : b;
  }

  function getTodayISOForHistory(){
    return (typeof getBrazilTodayISO === 'function') ? getBrazilTodayISO() : new Date().toISOString().slice(0,10);
  }

  function readISOFromAnyField(o, keys){
    if(!o) return '';
    for(const k of keys){
      if(o[k] !== undefined && o[k] !== null && String(o[k]).trim() !== '') {
        const iso = (typeof dateValueToISO === 'function') ? dateValueToISO(o[k]) : '';
        if(iso) return iso;
      }
    }
    return '';
  }

  function readISOFromText(o, keys){
    if(!o || typeof extractFirstDateLikeString !== 'function') return '';
    for(const k of keys){
      const raw = String(o[k] || '').trim();
      if(!raw) continue;
      const found = extractFirstDateLikeString(raw);
      const iso = found && typeof dateValueToISO === 'function' ? dateValueToISO(found) : '';
      if(iso) return iso;
    }
    return '';
  }

  function getOrderCreatedISO(o){
    const direct = readISOFromAnyField(o, [
      'data_lancamento','data_lançamento','lancado_em','lançado_em','lancadoEm','criado_em',
      'criadoEm','created_at','createdAt','data_criacao','data_criação','dt_criacao','dt_criação',
      'data_pedido','dataPedido','pedido_em','pedidoEm','emissao','data_emissao','data_venda','dataVenda',
      'data_inclusao','dataInclusao','included_at','inserted_at','timestamp'
    ]);
    if(direct) return direct;

    const hist = getHistoryForOrder(o);
    if(hist.createdISO) return hist.createdISO;
    if(hist.firstSeenISO) return hist.firstSeenISO;

    return '';
  }

  function getOrderSeparationISO(o){
    const direct = readISOFromAnyField(o, [
      'dataSeparacao','data_separacao','data_separação','separado_em','separadoEm','separado_data',
      'data_separado','dataSeparado','data_separacao_extrato','dt_separacao','dt_separação',
      'separation_date','separated_at','separatedAt','separadoHojeData'
    ]);
    if(direct) return direct;

    const textISO = readISOFromText(o, ['observacao_logistica','observacao','audit','historico','historico_status','log_status']);
    if(textISO && isSeparatedReadyStatus(o)) return textISO;

    const hist = getHistoryForOrder(o);
    return hist.separatedISO || '';
  }

  function getOrderDispatchISO(o){
    const direct = readISOFromAnyField(o, [
      'data_despacho','despachado_em','despachadoEm','data_rota','dataRota','saiu_em',
      'saiuEm','saiuParaEntregaEm','saiu_para_entrega_em','dispatch_at','dispatched_at'
    ]);
    if(direct) return direct;

    const hist = getHistoryForOrder(o);
    return hist.dispatchedISO || '';
  }

  function getOrderDeliveryISO(o){
    const direct = readISOFromAnyField(o, [
      'data_entrega_realizada','entregue_em','entregueEm','data_entregue','dataEntregue',
      'dataEntrega','delivered_at','deliveredAt','concluidaEm','concluido_em','finalizado_em'
    ]);
    if(direct) return direct;

    const hist = getHistoryForOrder(o);
    return hist.deliveredISO || '';
  }

  function sameOperationalDate(isoA, isoB){
    return !!isoA && !!isoB && String(isoA).slice(0,10) === String(isoB).slice(0,10);
  }

  function selectedISO(){
    return (typeof getSelectedOperationalDateISO === 'function') ? getSelectedOperationalDateISO() : getTodayISOForHistory();
  }

  function selectedIsToday(){
    return sameOperationalDate(selectedISO(), getTodayISOForHistory());
  }

  function happenedOnSelected(iso){
    return sameOperationalDate(iso, selectedISO());
  }

  function isBeforeOrEqual(a, b){
    if(!a || !b) return false;
    return compareISO(a, b) <= 0;
  }

  function isAfter(a, b){
    if(!a || !b) return false;
    return compareISO(a, b) > 0;
  }

  function wasSeparatedAndStillNotOutOnSelectedDate(o){
    const sel = selectedISO();
    const sep = getOrderSeparationISO(o);
    const disp = getOrderDispatchISO(o);
    const del = getOrderDeliveryISO(o);

    if(sep && isBeforeOrEqual(sep, sel)) {
      if(disp && !isAfter(disp, sel)) return false;
      if(del && !isAfter(del, sel)) return false;
      return true;
    }

    // Fallback seguro para o dia atual: se o backend ainda não devolve data de separação,
    // mantém separado visível enquanto não saiu para entrega/entregue.
    if(!sep && selectedIsToday() && isStillSeparatedNotOut(o)) return true;

    return false;
  }

  function getOperationalEventLabel(o){
    const labels = [];
    if(happenedOnSelected(getOrderCreatedISO(o))) labels.push('Lançado na plataforma');
    if(happenedOnSelected(getOrderSeparationISO(o))) labels.push('Separado neste dia');
    if(wasSeparatedAndStillNotOutOnSelectedDate(o) && !happenedOnSelected(getOrderSeparationISO(o))) labels.push('Separado pendente de entrega');
    if(happenedOnSelected(getOrderDispatchISO(o))) labels.push('Saiu para entrega');
    if(happenedOnSelected(getOrderDeliveryISO(o))) labels.push('Entregue neste dia');
    return labels.join(' • ');
  }

  function enrichOrderWithOperationalHistory(o){
    if(!o || typeof o !== 'object') return o;
    const hist = getHistoryForOrder(o);
    const created = getOrderCreatedISO(o) || hist.firstSeenISO || '';
    const sep = getOrderSeparationISO(o) || '';
    const disp = getOrderDispatchISO(o) || '';
    const del = getOrderDeliveryISO(o) || '';

    o._createdISO = created;
    o._separatedISO = sep;
    o._dispatchedISO = disp;
    o._deliveredISO = del;
    o._evento_operacional = getOperationalEventLabel(o);
    return o;
  }

  function captureLoadedOrdersInHistory(){
    const today = getTodayISOForHistory();
    const all = [].concat(Array.isArray(orders) ? orders : [], Array.isArray(flexOrders) ? flexOrders : []);

    all.forEach(o => {
      if(!o || typeof o !== 'object') return;

      const hist = getHistoryForOrder(o);
      const directCreated = readISOFromAnyField(o, [
        'data_lancamento','data_lançamento','lancado_em','lançado_em','lancadoEm','criado_em',
        'criadoEm','created_at','createdAt','data_criacao','data_criação','dt_criacao','dt_criação',
        'data_pedido','dataPedido','pedido_em','pedidoEm','emissao','data_emissao','data_venda','dataVenda',
        'data_inclusao','dataInclusao','included_at','inserted_at','timestamp'
      ]);

      const patch = {};
      const knownCreated = directCreated || hist.createdISO || hist.firstSeenISO || '';
      if(knownCreated) {
        patch.createdISO = minISO(hist.createdISO || hist.firstSeenISO || '', knownCreated);
        patch.firstSeenISO = patch.createdISO;
      } else if(!hist.firstSeenISO && selectedIsToday()) {
        // Sem campo de lançamento no backend: começa a armazenar a partir do primeiro carregamento real do dia.
        patch.firstSeenISO = today;
      }

      const directSep = readISOFromAnyField(o, [
        'dataSeparacao','data_separacao','data_separação','separado_em','separadoEm','separado_data',
        'data_separado','dataSeparado','data_separacao_extrato','dt_separacao','dt_separação',
        'separation_date','separated_at','separatedAt','separadoHojeData'
      ]);
      if(directSep) patch.separatedISO = hist.separatedISO ? minISO(hist.separatedISO, directSep) : directSep;

      const directDispatch = readISOFromAnyField(o, [
        'data_despacho','despachado_em','despachadoEm','data_rota','dataRota','saiu_em',
        'saiuEm','saiuParaEntregaEm','saiu_para_entrega_em','dispatch_at','dispatched_at'
      ]);
      if(directDispatch) patch.dispatchedISO = hist.dispatchedISO ? minISO(hist.dispatchedISO, directDispatch) : directDispatch;

      const directDelivery = readISOFromAnyField(o, [
        'data_entrega_realizada','entregue_em','entregueEm','data_entregue','dataEntregue',
        'dataEntrega','delivered_at','deliveredAt','concluidaEm','concluido_em','finalizado_em'
      ]);
      if(directDelivery) patch.deliveredISO = hist.deliveredISO ? minISO(hist.deliveredISO, directDelivery) : directDelivery;

      if(Object.keys(patch).length) mergeHistoryAliases(o, patch);
    });

    if(Array.isArray(orders)) orders = orders.map(enrichOrderWithOperationalHistory);
    if(Array.isArray(flexOrders)) flexOrders = flexOrders.map(enrichOrderWithOperationalHistory);
    if(typeof syncGlobalOrderState === 'function') syncGlobalOrderState();
  }

  function rememberStatusTransition(id, status){
    const today = getTodayISOForHistory();
    const st = String(status || '').toLowerCase();
    const all = [].concat(Array.isArray(orders) ? orders : [], Array.isArray(flexOrders) ? flexOrders : []);
    const found = all.find(o => getOrderHistoryKeys(o).includes(normalizeHistoryKey(id))) || id;

    const patch = {};
    if(st.includes('pronto') || st.includes('separado')) patch.separatedISO = today;
    if(st.includes('despach') || st.includes('rota') || st.includes('saiu para entrega')) patch.dispatchedISO = today;
    if(st.includes('entregue') || st.includes('finaliz') || st.includes('conclu')) patch.deliveredISO = today;

    if(Object.keys(patch).length) mergeHistoryAliases(found, patch);
  }

  // O calendário deixa de ser enviado como filtro da API para impedir que o backend
  // interprete a data como data prevista. A data passa a ser usada apenas no histórico operacional.
  window.appendOperationalDateToUrl = appendOperationalDateToUrl = function(url){
    return String(url || '');
  };

  window.getOrderCreatedISO = getOrderCreatedISO;
  window.getOrderSeparationISO = getOrderSeparationISO;
  window.getOrderDispatchISO = getOrderDispatchISO;
  window.getOrderDeliveryISO = getOrderDeliveryISO;
  window.getOperationalEventLabel = getOperationalEventLabel;
  window.captureLoadedOrdersInHistory = captureLoadedOrdersInHistory;
  window.rememberStatusTransition = rememberStatusTransition;

  window.shouldShowOrderForQueueDate = shouldShowOrderForQueueDate = function(o){
    const sel = selectedISO();
    const created = getOrderCreatedISO(o);
    const sep = getOrderSeparationISO(o);
    const del = getOrderDeliveryISO(o);

    // Fila mostra o que entrou na operação até a data selecionada e ainda não foi separado naquela data.
    if(del && !isAfter(del, sel)) return false;
    if(sep && !isAfter(sep, sel)) return false;
    if(created) return isBeforeOrEqual(created, sel);

    // Sem histórico no backend/localStorage, mantém compatibilidade do dia atual.
    return selectedIsToday();
  };

  window.shouldShowSeparatedForOperationalDate = shouldShowSeparatedForOperationalDate = function(o){
    return wasSeparatedAndStillNotOutOnSelectedDate(o);
  };

  window.shouldShowLogisticForOperationalDate = shouldShowLogisticForOperationalDate = function(o){
    if(happenedOnSelected(getOrderCreatedISO(o))) return true;
    if(happenedOnSelected(getOrderSeparationISO(o))) return true;
    if(wasSeparatedAndStillNotOutOnSelectedDate(o)) return true;
    if(happenedOnSelected(getOrderDispatchISO(o))) return true;
    if(happenedOnSelected(getOrderDeliveryISO(o))) return true;

    // Dia atual continua mostrando ativos quando ainda não existe histórico suficiente.
    if(selectedIsToday() && !isDeliveredStatus(o)) return true;
    return false;
  };

  window.shouldShowDeliveredForOperationalDate = shouldShowDeliveredForOperationalDate = function(o){
    return happenedOnSelected(getOrderDeliveryISO(o));
  };

  window.shouldShowFlexForOperationalDate = shouldShowFlexForOperationalDate = function(f){
    if(happenedOnSelected(getOrderCreatedISO(f))) return true;
    if(happenedOnSelected(getOrderSeparationISO(f))) return true;
    if(wasSeparatedAndStillNotOutOnSelectedDate(f)) return true;
    if(happenedOnSelected(getOrderDispatchISO(f))) return true;
    if(happenedOnSelected(getOrderDeliveryISO(f))) return true;
    return selectedIsToday();
  };

  const oldScheduleRender = scheduleRender;
  scheduleRender = function(...args){
    try { captureLoadedOrdersInHistory(); } catch(e) { console.warn('Histórico operacional: erro ao capturar pedidos', e); }
    return oldScheduleRender.apply(this, args);
  };
  window.scheduleRender = scheduleRender;

  const oldUpdateStatusJsonp = updateStatusJsonp;
  updateStatusJsonp = function(id, status, observacao = ''){
    try { rememberStatusTransition(id, status); } catch(e) { console.warn('Histórico operacional: erro ao gravar status', e); }
    return oldUpdateStatusJsonp.apply(this, arguments);
  };
  window.updateStatusJsonp = updateStatusJsonp;

  const oldUpdateFlexStatusJsonp = updateFlexStatusJsonp;
  updateFlexStatusJsonp = function(id, status, observacao = '', cb){
    try { rememberStatusTransition(id, status); } catch(e) { console.warn('Histórico operacional Flex: erro ao gravar status', e); }
    return oldUpdateFlexStatusJsonp.apply(this, arguments);
  };
  window.updateFlexStatusJsonp = updateFlexStatusJsonp;

  // Bloqueio adicional da atualização automática, preservando o relógio e alarmes.
  if(!window.__vescoNoAutoRefreshIntervalGuard){
    window.__vescoNoAutoRefreshIntervalGuard = true;
    const nativeSetInterval = window.setInterval.bind(window);
    window.setInterval = function(callback, delay, ...args){
      const cbName = callback && callback.name ? callback.name : '';
      if(Number(delay) === 60000 && (callback === load || cbName === 'load')) {
        console.info('Atualização automática bloqueada. Use o botão Atualizar.');
        return -1;
      }
      return nativeSetInterval(callback, delay, ...args);
    };
  }

  if(document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){
      try { captureLoadedOrdersInHistory(); } catch(e) {}
    });
  } else {
    try { captureLoadedOrdersInHistory(); } catch(e) {}
  }

  console.log('Histórico operacional V3 ativo — calendário por eventos, sem filtro por data prevista e sem atualização automática.');
})();

// =================================================================
// CAMADA V4 — ROTAS SAINDO PARA ENTREGA + PENDÊNCIA EM ENTREGUES
// Regra de Preservação: esta camada apenas integra e sobrescreve handlers
// por composição, sem remover funções legadas.
// =================================================================
(function installVescoRouteDispatchAndDeliveredPendenciaV4(){
  if (window.__vescoRouteDispatchAndDeliveredPendenciaV4) return;
  window.__vescoRouteDispatchAndDeliveredPendenciaV4 = true;

  const ROUTES_KEY = 'vesco_saiu_rotas_v1';
  const LAST_ROUTE_URL_KEY = 'vesco_last_google_route_url_v4';

  function v4Toast(msg, type = 'info', ms = 3500){
    try {
      if (typeof showToast === 'function') return showToast(msg, type, ms);
    } catch(e) {}
    try { console.log(msg); } catch(e) {}
  }

  function v4Escape(v){
    try { return typeof escapeHtml === 'function' ? escapeHtml(v) : String(v ?? ''); }
    catch(e){ return String(v ?? ''); }
  }

  function v4Normalize(v){
    try { return typeof normalizeOrderNumber === 'function' ? normalizeOrderNumber(v) : String(v ?? '').trim(); }
    catch(e){ return String(v ?? '').trim(); }
  }

  function v4NormalizeEcom(v){
    try { return typeof normalizeEcomNumber === 'function' ? normalizeEcomNumber(v) : String(v ?? '').replace(/\D/g,''); }
    catch(e){ return String(v ?? '').trim(); }
  }

  function v4TodayBR(){
    try {
      if (typeof isoToBRDate === 'function' && typeof getBrazilTodayISO === 'function') return isoToBRDate(getBrazilTodayISO());
    } catch(e) {}
    const d = new Date();
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  }

  function v4PersistRoutes(){
    try { localStorage.setItem(ROUTES_KEY, JSON.stringify(window.saiuRotas || [])); } catch(e) {}
  }

  function v4AllOrders(){
    const a = Array.isArray(window.orders) ? window.orders : [];
    const b = Array.isArray(window.flexOrders) ? window.flexOrders : [];
    return a.concat(b);
  }

  function v4OrderKeys(o){
    if(!o) return [];
    const vals = [
      o.id, o.numero, o.pedido, o.order_id, o.orderNumber, o.reference, o.referencia,
      o.numero_ecommerce, o.numero_ecom, o.ecom, o.ecom_id, o.codigo_externo, o.codigo
    ];
    const keys = [];
    vals.forEach(v => {
      if(v === undefined || v === null || String(v).trim() === '') return;
      const raw = String(v).trim();
      keys.push(raw, v4Normalize(raw), v4NormalizeEcom(raw));
    });
    return Array.from(new Set(keys.filter(Boolean)));
  }

  function v4FindOrder(key){
    const targetRaw = String(key ?? '').trim();
    const targetNorm = v4Normalize(targetRaw);
    const targetEcom = v4NormalizeEcom(targetRaw);
    return v4AllOrders().find(o => {
      const keys = v4OrderKeys(o);
      return keys.includes(targetRaw) || keys.includes(targetNorm) || keys.includes(targetEcom);
    }) || null;
  }

  function v4OrderAddress(o){
    if(!o) return '';
    return String(o.endereco_completo || o.endereco || o.address || o.full_address || o.logradouro || '').trim();
  }

  function v4OrderClient(o){
    try { return extractClientNameFromAny(o) || o.cliente_nome || o.cliente || o.nome || o.destinatario || ''; }
    catch(e){ return o && (o.cliente_nome || o.cliente || o.nome || o.destinatario) || ''; }
  }

  function v4MarkerLatLng(key){
    try {
      const m = (typeof findMainMarkerByKey === 'function' && findMainMarkerByKey(key)) ||
                (typeof findFlexMarkerByKey === 'function' && findFlexMarkerByKey(key));
      if(m && typeof m.getLatLng === 'function') {
        const ll = m.getLatLng();
        if(ll && Number.isFinite(ll.lat) && Number.isFinite(ll.lng)) return { lat: ll.lat, lon: ll.lng };
      }
    } catch(e) {}
    return null;
  }

  function v4OrderCoords(o, key){
    try {
      const direct = typeof getCoords === 'function' ? getCoords(o) : null;
      if(direct && Number.isFinite(direct.lat) && Number.isFinite(direct.lon)) return direct;
    } catch(e) {}
    return v4MarkerLatLng(key || (o && (o.numero || o.id)));
  }

  function v4BuildStops(pedidos){
    return Array.from(new Set((pedidos || []).map(v => String(v || '').trim()).filter(Boolean))).map(pedido => {
      const order = v4FindOrder(pedido);
      const coords = v4OrderCoords(order, pedido);
      return {
        pedido,
        id: order && (order.id || order.numero) || pedido,
        numero: order && (order.numero || order.id) || pedido,
        cliente: v4OrderClient(order),
        endereco: v4OrderAddress(order),
        lat: coords ? coords.lat : null,
        lon: coords ? coords.lon : null,
        origem: order && Array.isArray(window.flexOrders) && window.flexOrders.includes(order) ? 'flex' : 'erp'
      };
    });
  }

  function v4EncodeStop(stop){
    if(stop && Number.isFinite(Number(stop.lat)) && Number.isFinite(Number(stop.lon))) {
      return `${Number(stop.lat)},${Number(stop.lon)}`;
    }
    return String((stop && stop.endereco) || (stop && stop.cliente) || (stop && stop.numero) || '').trim();
  }

  function v4BuildGoogleMapsRouteUrl(rota){
    const stops = (rota && rota.paradas && rota.paradas.length ? rota.paradas : v4BuildStops(rota && rota.pedidos || []))
      .filter(s => v4EncodeStop(s));

    if(stops.length === 0) return '';
    if(stops.length === 1) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v4EncodeStop(stops[0]))}`;
    }

    const limited = stops.slice(0, 25);
    const origin = v4EncodeStop(limited[0]);
    const destination = v4EncodeStop(limited[limited.length - 1]);
    const waypointStops = limited.slice(1, -1).map(v4EncodeStop).filter(Boolean);
    let url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving`;
    if(waypointStops.length) url += `&waypoints=${encodeURIComponent(waypointStops.join('|'))}`;
    return url;
  }

  function v4FindRouteById(id){
    return (window.saiuRotas || []).find(r => String(r.id) === String(id)) || null;
  }

  function v4FindOrCreateRouteMap(){
    const globals = ['routeMap','rotasMap','mapRotas','mapaRotas','mapRoute','saiuMap','map','mapFlex'];
    for(const name of globals){
      const m = window[name];
      if(m && typeof m.setView === 'function' && typeof m.addLayer === 'function') return m;
    }

    if(typeof L === 'undefined') return null;
    const ids = ['map-rotas','rotas-map','route-map','map-route','routeMap','map-saiu','saiu-map'];
    for(const id of ids){
      const el = document.getElementById(id);
      if(el && !el._leaflet_id) {
        try {
          const m = L.map(el).setView([-23.55052, -46.633308], 11);
          L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png', { attribution: '&copy; CartoDB', maxZoom: 19 }).addTo(m);
          window.routeMap = m;
          return m;
        } catch(e) {}
      }
    }
    return null;
  }

  async function v4ResolveStopCoords(stop){
    if(stop && Number.isFinite(Number(stop.lat)) && Number.isFinite(Number(stop.lon))) return { lat: Number(stop.lat), lon: Number(stop.lon) };
    const byMarker = v4MarkerLatLng(stop && stop.numero || stop && stop.pedido);
    if(byMarker) return byMarker;
    if(!stop || !stop.endereco || typeof geocodeAddress !== 'function') return null;
    try {
      const timeout = new Promise(resolve => setTimeout(() => resolve(null), 4500));
      const geo = geocodeAddress(stop.endereco);
      const res = await Promise.race([geo, timeout]);
      if(res && Number.isFinite(Number(res.lat)) && Number.isFinite(Number(res.lon))) {
        stop.lat = Number(res.lat);
        stop.lon = Number(res.lon);
        return { lat: stop.lat, lon: stop.lon };
      }
    } catch(e) {}
    return null;
  }

  async function v4DrawRouteOnMap(rotaOrId){
    const rota = typeof rotaOrId === 'string' ? v4FindRouteById(rotaOrId) : rotaOrId;
    if(!rota) return v4Toast('Rota não encontrada.', 'error');

    const mapTarget = v4FindOrCreateRouteMap();
    if(!mapTarget || typeof L === 'undefined') {
      const url = v4BuildGoogleMapsRouteUrl(rota);
      if(url) window.open(url, '_blank');
      return;
    }

    try {
      if(window.__vescoRouteLayerV4 && typeof window.__vescoRouteLayerV4.remove === 'function') {
        window.__vescoRouteLayerV4.remove();
      }
    } catch(e) {}

    const layer = L.layerGroup().addTo(mapTarget);
    window.__vescoRouteLayerV4 = layer;

    const stops = rota.paradas && rota.paradas.length ? rota.paradas : v4BuildStops(rota.pedidos || []);
    rota.paradas = stops;

    const latlngs = [];
    for(let i = 0; i < stops.length; i++){
      const s = stops[i];
      const coords = await v4ResolveStopCoords(s);
      if(!coords) continue;
      const ll = [coords.lat, coords.lon];
      latlngs.push(ll);
      try {
        L.marker(ll).addTo(layer).bindPopup(`<b>${i + 1}. Pedido #${v4Escape(s.numero || s.pedido)}</b><br>${v4Escape(s.cliente || '')}<br><small>${v4Escape(s.endereco || '')}</small>`);
      } catch(e) {}
    }

    if(latlngs.length > 1) {
      try { L.polyline(latlngs, { weight: 4, opacity: 0.85 }).addTo(layer); } catch(e) {}
    }

    try {
      if(latlngs.length === 1) mapTarget.setView(latlngs[0], 15);
      if(latlngs.length > 1) mapTarget.fitBounds(L.latLngBounds(latlngs).pad(0.18), { maxZoom: 15 });
      setTimeout(() => mapTarget.invalidateSize && mapTarget.invalidateSize(), 200);
    } catch(e) {}

    const url = v4BuildGoogleMapsRouteUrl(rota);
    if(url) {
      try { localStorage.setItem(LAST_ROUTE_URL_KEY, url); } catch(e) {}
      v4RenderRouteInfo(rota, url);
    }

    v4PersistRoutes();
    return url;
  }

  function v4RenderRouteInfo(rota, url){
    const roots = [document.getElementById('view-rotas'), document.getElementById('view-saiu'), document.body].filter(Boolean);
    const root = roots.find(r => r.querySelector && (r.querySelector('#vesco-route-info-panel') || r.textContent.includes('Obter informações da rota') || r.textContent.includes('Traçar Rota'))) || document.body;
    let panel = document.getElementById('vesco-route-info-panel');
    if(!panel) {
      panel = document.createElement('div');
      panel.id = 'vesco-route-info-panel';
      panel.className = 'my-3 p-3 rounded-xl border border-blue-100 bg-blue-50 text-xs text-slate-700';
      const anchor = Array.from(root.querySelectorAll('button')).find(b => /obter informa|tra[cç]ar rota|p\/ motorista/i.test(b.textContent || ''));
      if(anchor && anchor.parentElement) anchor.parentElement.insertAdjacentElement('afterend', panel);
      else root.prepend(panel);
    }

    const stops = rota.paradas || [];
    panel.innerHTML = `
      <div class="font-black text-blue-800 mb-2"><i class="fas fa-route mr-1"></i>Rota montada: ${v4Escape(rota.nome || 'Rota')}</div>
      <div class="mb-2"><b>Motorista:</b> ${v4Escape(rota.motorista || '—')} • <b>Pedidos:</b> ${stops.length || (rota.pedidos || []).length}</div>
      <div class="max-h-32 overflow-auto bg-white/70 border border-blue-100 rounded-lg p-2 mb-2">
        ${(stops || []).map((s, i) => `<div class="mb-1"><b>${i + 1}. #${v4Escape(s.numero || s.pedido)}</b> — ${v4Escape(s.endereco || 'Endereço não localizado')}</div>`).join('') || 'Nenhum endereço localizado.'}
      </div>
      ${url ? `<a href="${v4Escape(url)}" target="_blank" class="inline-flex items-center gap-1 bg-blue-600 text-white px-3 py-1.5 rounded-lg font-bold"><i class="fas fa-map-marked-alt"></i>Abrir rota no Google Maps</a>` : ''}
    `;
  }

  function v4MarkLocalOutForDelivery(pedidoNum, rota){
    const order = v4FindOrder(pedidoNum);
    const todayBR = v4TodayBR();
    const now = new Date().toISOString();
    if(order) {
      order.status_logistica = 'Despachado';
      order.situacao_nome = 'Saiu para entrega';
      order.data_despacho = todayBR;
      order.despachado_em = now;
      order.saiuParaEntregaEm = now;
      const obsAntiga = String(order.observacao_logistica || order.observacao || '').trim();
      const obsNova = `Saiu para entrega — Rota: ${rota.nome || 'Rota'} Motorista: ${rota.motorista || '—'}`;
      order.observacao_logistica = obsAntiga ? `${obsAntiga} | ${obsNova}` : obsNova;
    }
    try { if(typeof rememberStatusTransition === 'function') rememberStatusTransition(pedidoNum, 'Despachado'); } catch(e) {}
    try { if(typeof syncGlobalOrderState === 'function') syncGlobalOrderState(); } catch(e) {}
  }

  function v4DispatchRouteToStreet(rota, opts = {}){
    if(!rota) return;
    const now = new Date().toISOString();
    rota.status = 'despachada';
    rota.despachadaEm = rota.despachadaEm || now;
    rota.saiuEm = rota.saiuEm || now;
    rota.paradas = v4BuildStops(rota.pedidos || []);

    (rota.pedidos || []).forEach((pedidoNum, idx) => {
      v4MarkLocalOutForDelivery(pedidoNum, rota);
      if(opts.skipBackend) return;
      setTimeout(() => {
        try {
          if(typeof updateStatusJsonp === 'function') {
            updateStatusJsonp(pedidoNum, 'Despachado', `Saiu para entrega — Rota: ${rota.nome || 'Rota'} Motorista: ${rota.motorista || '—'}`);
          }
        } catch(e) { console.warn('Erro ao registrar pedido na rua:', pedidoNum, e); }
      }, idx * 650);
    });

    v4PersistRoutes();
    try { if(typeof render === 'function') render(); } catch(e) {}
    try { if(typeof window.renderPedidosDisponiveisSaiu === 'function') window.renderPedidosDisponiveisSaiu(); } catch(e) {}
    try { if(typeof window.renderSelectedTemp === 'function') window.renderSelectedTemp(); } catch(e) {}
    try { if(typeof window.renderRotas === 'function') window.renderRotas(); } catch(e) {}
    v4DrawRouteOnMap(rota);
  }

  function v4GetInputValue(candidates){
    for(const sel of candidates){
      const el = document.querySelector(sel);
      if(el && String(el.value || '').trim()) return String(el.value).trim();
    }
    return '';
  }

  function v4CollectSelectedRoutePedidos(){
    const selectors = [
      '#saiu-pedidos-list input[type="checkbox"]:checked',
      '#view-saiu input[type="checkbox"]:checked',
      '#view-rotas input[type="checkbox"]:checked',
      '#pedidosDisponiveis input[type="checkbox"]:checked',
      '[data-route-order]:checked',
      '[data-num][type="checkbox"]:checked',
      '[data-ecom][type="checkbox"]:checked'
    ];
    const inputs = Array.from(new Set(selectors.flatMap(sel => Array.from(document.querySelectorAll(sel)))));
    const out = [];
    inputs.forEach(cb => {
      let val = cb.getAttribute('data-num') || cb.getAttribute('data-ecom') || cb.getAttribute('data-pedido') || cb.value || '';
      if(!val || val === 'on') {
        const row = cb.closest('tr') || cb.closest('.pedido-item') || cb.closest('[data-num]') || cb.parentElement;
        val = (row && (row.getAttribute('data-num') || row.getAttribute('data-ecom') || row.getAttribute('data-pedido'))) || '';
        if(!val && row) {
          const txt = row.innerText || '';
          const m = txt.match(/#\s*([0-9A-Za-z._-]{4,})/) || txt.match(/\b(\d{5,})\b/);
          if(m) val = m[1];
        }
      }
      val = v4Normalize(val);
      if(val) out.push(val);
    });
    return Array.from(new Set(out));
  }

  function v4IsCreateRouteButton(btn){
    if(!btn || !btn.matches || !btn.matches('button, a, [role="button"], input[type="button"], input[type="submit"]')) return false;
    const idName = `${btn.id || ''} ${btn.name || ''} ${btn.getAttribute('onclick') || ''}`;
    const text = `${btn.value || ''} ${btn.textContent || ''}`.trim();
    if(/btn[-_]?criar[-_]?rota|criarRota|createRoute/i.test(idName)) return true;
    if(/\bcriar\s+rota\b/i.test(text)) {
      return !!(btn.closest('#view-saiu') || btn.closest('#view-rotas') || document.getElementById('rotaMotorista') || document.getElementById('rotaNome'));
    }
    return false;
  }

  function v4IsTraceRouteButton(btn){
    if(!btn || !btn.matches || !btn.matches('button, a, [role="button"], input[type="button"], input[type="submit"]')) return false;
    const idName = `${btn.id || ''} ${btn.name || ''} ${btn.getAttribute('onclick') || ''}`;
    const text = `${btn.value || ''} ${btn.textContent || ''}`.trim();
    return /tracar|tra[cç]ar|route|rotaMapa|obter.*rota/i.test(idName) || /tra[cç]ar\s+rota|obter informa[cç][oõ]es da rota/i.test(text);
  }

  function v4HandleCreateRoute(e, btn){
    e.preventDefault();
    e.stopPropagation();
    if(typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();

    const motorista = v4GetInputValue(['#rotaMotorista', '#motoristaRota', '#routeDriver', 'input[name="motorista"]', 'input[placeholder*="motorista" i]']);
    const nome = v4GetInputValue(['#rotaNome', '#nomeRota', '#routeName', 'input[name="rota"]', 'input[placeholder*="rota" i]']) || `Rota ${new Date().toLocaleString('pt-BR')}`;
    const pedidos = v4CollectSelectedRoutePedidos();

    if(!motorista) return alert('Informe o nome do motorista.');
    if(!pedidos.length) return alert('Selecione ao menos 1 pedido para criar a rota.');

    window.saiuRotas = Array.isArray(window.saiuRotas) ? window.saiuRotas : [];
    const nova = {
      id: 'rota-' + Date.now(),
      nome,
      motorista,
      pedidos,
      status: 'despachada',
      criadoEm: new Date().toISOString(),
      despachadaEm: new Date().toISOString(),
      saiuEm: new Date().toISOString(),
      paradas: v4BuildStops(pedidos)
    };

    window.saiuRotas.push(nova);
    try { window.rotaTemp = { motorista: '', nome: '', pedidos: [] }; } catch(e) {}
    ['#rotaMotorista', '#motoristaRota', '#routeDriver', '#rotaNome', '#nomeRota', '#routeName'].forEach(sel => {
      const el = document.querySelector(sel);
      if(el) el.value = '';
    });

    v4DispatchRouteToStreet(nova);
    v4Toast(`Rota criada. ${pedidos.length} pedido(s) marcado(s) como saiu para entrega.`, 'success', 4500);
  }

  function v4HandleTraceRoute(e, btn){
    const pedidos = v4CollectSelectedRoutePedidos();
    if(!pedidos.length) return;
    e.preventDefault();
    e.stopPropagation();
    if(typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();

    const temp = {
      id: 'rota-preview-' + Date.now(),
      nome: 'Prévia da rota',
      motorista: v4GetInputValue(['#rotaMotorista', '#motoristaRota', '#routeDriver', 'input[name="motorista"]', 'input[placeholder*="motorista" i]']) || '—',
      pedidos,
      status: 'preview',
      criadoEm: new Date().toISOString(),
      paradas: v4BuildStops(pedidos)
    };
    v4DrawRouteOnMap(temp).then(url => {
      v4Toast('Rota traçada com os endereços selecionados.', 'success', 3000);
    });
  }

  document.addEventListener('click', function vescoRouteClickCapture(e){
    const btn = e.target && e.target.closest && e.target.closest('button, a, [role="button"], input[type="button"], input[type="submit"]');
    if(!btn) return;
    if(v4IsCreateRouteButton(btn)) return v4HandleCreateRoute(e, btn);
    if(v4IsTraceRouteButton(btn)) return v4HandleTraceRoute(e, btn);
  }, true);

  const preservedIniciarRota = window.iniciarRota;
  window.iniciarRota = function(rotaId){
    const rota = v4FindRouteById(rotaId);
    if(!rota) return typeof preservedIniciarRota === 'function' ? preservedIniciarRota.apply(this, arguments) : v4Toast('Rota inexistente.', 'error');
    if(!confirm(`Iniciar rota "${rota.nome}" com ${rota.pedidos.length} pedido(s) e motorista ${rota.motorista}?`)) return;
    v4DispatchRouteToStreet(rota);
    v4Toast('Rota iniciada — pedidos marcados como saiu para entrega.', 'success', 3500);
  };

  const preservedVerRotaMapa = window.verRotaMapa;
  window.verRotaMapa = function(rotaId){
    const rota = v4FindRouteById(rotaId);
    if(rota) return v4DrawRouteOnMap(rota);
    if(typeof preservedVerRotaMapa === 'function') return preservedVerRotaMapa.apply(this, arguments);
  };

  window.vescoOpenRouteInGoogle = function(rotaId){
    const rota = v4FindRouteById(rotaId);
    const url = rota ? v4BuildGoogleMapsRouteUrl(rota) : localStorage.getItem(LAST_ROUTE_URL_KEY);
    if(url) window.open(url, '_blank');
    else v4Toast('Nenhuma rota disponível para abrir.', 'warning');
  };

  window.vescoGetRouteInfo = function(rotaId){
    const rota = v4FindRouteById(rotaId);
    if(!rota) return v4Toast('Rota não encontrada.', 'error');
    const url = v4BuildGoogleMapsRouteUrl(rota);
    v4RenderRouteInfo(rota, url);
    return rota;
  };

  function v4InjectRouteExtraButtons(){
    const el = document.getElementById('saiu-rotas-list');
    if(!el) return;
    Array.from(el.children || []).forEach(card => {
      if(card.querySelector && card.querySelector('.vesco-route-v4-actions')) return;
      const html = card.innerHTML || '';
      const m = html.match(/verRotaMapa\s*&&\s*window\.verRotaMapa\('([^']+)'\)/) || html.match(/verRotaMapa\('([^']+)'\)/) || html.match(/concluirRota\s*&&\s*window\.concluirRota\('([^']+)'\)/);
      const id = m && m[1];
      if(!id) return;
      const box = document.createElement('div');
      box.className = 'vesco-route-v4-actions mt-2 flex flex-wrap gap-2 justify-end';
      box.innerHTML = `
        <button type="button" class="bg-indigo-600 text-white px-3 py-1 rounded text-xs font-bold" onclick="window.verRotaMapa && window.verRotaMapa('${v4Escape(id)}')">Traçar no mapa</button>
        <button type="button" class="bg-blue-600 text-white px-3 py-1 rounded text-xs font-bold" onclick="window.vescoOpenRouteInGoogle && window.vescoOpenRouteInGoogle('${v4Escape(id)}')">Google Maps</button>
      `;
      card.appendChild(box);
    });
  }

  const preservedRenderRotas = window.renderRotas;
  if(typeof preservedRenderRotas === 'function') {
    window.renderRotas = function(){
      const res = preservedRenderRotas.apply(this, arguments);
      setTimeout(v4InjectRouteExtraButtons, 0);
      return res;
    };
  }

  function v4InjectDeliveredPendenciaButtons(){
    const tbody = document.getElementById('table-entregues');
    if(!tbody) return;
    Array.from(tbody.querySelectorAll('tr')).forEach(row => {
      if(row.querySelector('.vesco-entregue-pendencia-btn')) return;
      const txt = row.innerText || '';
      const m = txt.match(/#\s*([0-9A-Za-z._-]+)/);
      if(!m) return;
      const numero = m[1];
      const order = v4FindOrder(numero);
      const id = order && (order.id || order.numero) || numero;
      const lastTd = row.querySelector('td:last-child');
      if(!lastTd) return;
      const wrapper = document.createElement('div');
      wrapper.className = 'mt-2 flex justify-center';
      wrapper.innerHTML = `<button type="button" class="vesco-entregue-pendencia-btn bg-amber-500 hover:bg-amber-600 text-white px-3 py-1 rounded-lg font-bold text-[11px] shadow-sm transition-all" onclick="window.moverParaPendenciaPrompt && window.moverParaPendenciaPrompt('${v4Escape(id)}')"><i class="fas fa-triangle-exclamation mr-1"></i>Pendência</button>`;
      lastTd.appendChild(wrapper);
    });
  }

  const preservedRender = typeof render === 'function' ? render : null;
  if(preservedRender) {
    render = function(){
      const res = preservedRender.apply(this, arguments);
      setTimeout(v4InjectDeliveredPendenciaButtons, 0);
      setTimeout(v4InjectRouteExtraButtons, 0);
      return res;
    };
    window.render = render;
  }

  const preservedSwitchTab = window.switchTab;
  if(typeof preservedSwitchTab === 'function') {
    window.switchTab = function(which){
      const res = preservedSwitchTab.apply(this, arguments);
      if(which === 'entregues') setTimeout(v4InjectDeliveredPendenciaButtons, 150);
      if(which === 'saiu' || which === 'rotas') setTimeout(v4InjectRouteExtraButtons, 150);
      return res;
    };
  }

  document.addEventListener('DOMContentLoaded', function(){
    setTimeout(v4InjectDeliveredPendenciaButtons, 500);
    setTimeout(v4InjectRouteExtraButtons, 500);
  });

  window.vescoRouteDispatchV4 = {
    buildStops: v4BuildStops,
    buildGoogleMapsRouteUrl: v4BuildGoogleMapsRouteUrl,
    drawRouteOnMap: v4DrawRouteOnMap,
    dispatchRouteToStreet: v4DispatchRouteToStreet,
    injectDeliveredPendenciaButtons: v4InjectDeliveredPendenciaButtons
  };

  console.log('Rotas V4 ativo — criar rota marca pedidos como saiu para entrega, traça endereços e adiciona Pendência em Entregues.');
})();


// =================================================================
// CAMADA V6 PRE — ROTAS COM PONTO DE PARTIDA + MAPA NO TOPO DIREITO
// Regra de Preservação: camada aditiva antes da V5 para interceptar rotas sem apagar legado.
// =================================================================
(function installVescoRouteOriginAndRightMapV6Pre(){
  if (window.__vescoRouteOriginAndRightMapV6Pre) return;
  window.__vescoRouteOriginAndRightMapV6Pre = true;

  const ROUTES_KEY = 'vesco_saiu_rotas_v1';
  const GEO_CACHE_KEY = 'vesco_route_geocode_cache_v6';
  const LAST_ROUTE_URL_KEY = 'vesco_last_google_route_url_v6';
  const ORIGIN_KEY = 'vesco_route_origin_v6';
  const DEFAULT_CENTER = [-23.55052, -46.633308];

  function v6Log(){ try { console.log.apply(console, arguments); } catch(e) {} }
  function v6Warn(){ try { console.warn.apply(console, arguments); } catch(e) {} }
  function v6Toast(msg, typeOrMs, ms){
    try {
      if (typeof showToast === 'function') {
        if (typeof typeOrMs === 'string') return showToast(msg, typeOrMs, ms || 3500);
        return showToast(msg, typeOrMs || 3500);
      }
    } catch(e) {}
    v6Log(msg);
  }
  function v6Escape(v){
    try { return typeof escapeHtml === 'function' ? escapeHtml(v) : String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
    catch(e){ return String(v ?? ''); }
  }
  function v6Norm(v){
    try { return typeof normalizeOrderNumber === 'function' ? normalizeOrderNumber(v) : String(v ?? '').trim(); }
    catch(e){ return String(v ?? '').trim(); }
  }
  function v6NormEcom(v){
    try { return typeof normalizeEcomNumber === 'function' ? normalizeEcomNumber(v) : String(v ?? '').replace(/\D/g,''); }
    catch(e){ return String(v ?? '').trim(); }
  }
  function v6NowBR(){
    const d = new Date();
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  }
  function v6PersistRoutes(){ try { localStorage.setItem(ROUTES_KEY, JSON.stringify(window.saiuRotas || [])); } catch(e) {} }
  function v6LoadGeoCache(){ try { return JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || '{}') || {}; } catch(e) { return {}; } }
  function v6SaveGeoCache(cache){ try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(cache || {})); } catch(e) {} }
  function v6CleanAddress(addr){
    return String(addr || '')
      .replace(/\s+/g, ' ')
      .replace(/\|/g, ',')
      .replace(/\bSao\b/gi, 'São')
      .trim();
  }
  function v6AddressKey(addr){ return v6CleanAddress(addr).toLowerCase(); }

  function v6AllOrders(){
    const localOrders = (typeof orders !== 'undefined' && Array.isArray(orders)) ? orders : [];
    const localFlex = (typeof flexOrders !== 'undefined' && Array.isArray(flexOrders)) ? flexOrders : [];
    const winOrders = Array.isArray(window.orders) ? window.orders : [];
    const winFlex = Array.isArray(window.flexOrders) ? window.flexOrders : [];
    return Array.from(new Set([].concat(localOrders, localFlex, winOrders, winFlex).filter(Boolean)));
  }
  function v6OrderKeys(o){
    if(!o) return [];
    const vals = [
      o.id, o.numero, o.pedido, o.order_id, o.orderNumber, o.reference, o.referencia,
      o.numero_ecommerce, o.numero_ecom, o.ecom, o.ecom_id, o.codigo_externo, o.codigo
    ];
    const keys = [];
    vals.forEach(v => {
      if(v === undefined || v === null || String(v).trim() === '') return;
      const raw = String(v).trim();
      keys.push(raw, v6Norm(raw), v6NormEcom(raw));
    });
    return Array.from(new Set(keys.filter(Boolean)));
  }
  function v6FindOrder(key){
    const raw = String(key ?? '').trim();
    const norm = v6Norm(raw);
    const ecom = v6NormEcom(raw);
    return v6AllOrders().find(o => {
      const keys = v6OrderKeys(o);
      return keys.includes(raw) || keys.includes(norm) || keys.includes(ecom);
    }) || null;
  }
  function v6OrderAddress(o){
    if(!o) return '';
    return v6CleanAddress(o.endereco_completo || o.endereco || o.address || o.full_address || o.logradouro || '');
  }
  function v6OrderClient(o){
    try { return extractClientNameFromAny(o) || o.cliente_nome || o.cliente || o.nome || o.destinatario || ''; }
    catch(e){ return o && (o.cliente_nome || o.cliente || o.nome || o.destinatario) || ''; }
  }
  function v6DirectCoords(o){
    try {
      const c = typeof getCoords === 'function' ? getCoords(o) : null;
      if(c && Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lon))) return { lat: Number(c.lat), lon: Number(c.lon) };
    } catch(e) {}
    return null;
  }
  function v6MarkerCoords(key){
    try {
      const m = (typeof findMainMarkerByKey === 'function' && findMainMarkerByKey(key)) ||
                (typeof findFlexMarkerByKey === 'function' && findFlexMarkerByKey(key));
      if(m && typeof m.getLatLng === 'function') {
        const ll = m.getLatLng();
        if(ll && Number.isFinite(Number(ll.lat)) && Number.isFinite(Number(ll.lng))) return { lat: Number(ll.lat), lon: Number(ll.lng) };
      }
    } catch(e) {}
    return null;
  }
  function v6BuildStops(pedidos, origem){
    const stops = [];
    const originText = v6CleanAddress(origem || v6GetRouteOrigin(false));
    if(originText) {
      stops.push({ pedido: '__ORIGEM__', id: '__ORIGEM__', numero: 'Origem', cliente: 'Ponto de partida', endereco: originText, isOrigin: true, lat: null, lon: null });
    }
    Array.from(new Set((pedidos || []).map(v => String(v || '').trim()).filter(Boolean))).forEach(pedido => {
      const order = v6FindOrder(pedido);
      const coords = v6DirectCoords(order) || v6MarkerCoords(pedido) || v6MarkerCoords(order && (order.numero || order.id));
      stops.push({
        pedido,
        id: order && (order.id || order.numero) || pedido,
        numero: order && (order.numero || order.id) || pedido,
        cliente: v6OrderClient(order),
        endereco: v6OrderAddress(order),
        lat: coords ? coords.lat : null,
        lon: coords ? coords.lon : null,
        isOrigin: false
      });
    });
    return stops;
  }
  function v6EncodeStop(stop){
    if(stop && Number.isFinite(Number(stop.lat)) && Number.isFinite(Number(stop.lon))) return `${Number(stop.lat)},${Number(stop.lon)}`;
    return v6CleanAddress((stop && stop.endereco) || (stop && stop.cliente) || (stop && stop.numero) || '');
  }
  function v6BuildGoogleMapsRouteUrl(rota){
    const stops = (rota && rota.paradas && rota.paradas.length ? rota.paradas : v6BuildStops(rota && rota.pedidos || [], rota && rota.origem)).filter(s => v6EncodeStop(s));
    if(!stops.length) return '';
    const limited = stops.slice(0, 25);
    if(limited.length === 1) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v6EncodeStop(limited[0]))}`;
    const origin = v6EncodeStop(limited[0]);
    const destination = v6EncodeStop(limited[limited.length - 1]);
    const waypoints = limited.slice(1, -1).map(v6EncodeStop).filter(Boolean);
    let url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving`;
    if(waypoints.length) url += `&waypoints=${encodeURIComponent(waypoints.join('|'))}`;
    return url;
  }
  function v6FindRouteById(id){ return (window.saiuRotas || []).find(r => String(r.id) === String(id)) || null; }

  function v6RouteRoot(){
    const candidates = ['#view-saiu:not(.hidden)', '#view-rotas:not(.hidden)', '#view-saiu', '#view-rotas'];
    for(const sel of candidates){ const el = document.querySelector(sel); if(el) return el; }
    return null;
  }
  function v6InstallRouteCss(){
    if(document.getElementById('vesco-route-v6-style')) return;
    const st = document.createElement('style');
    st.id = 'vesco-route-v6-style';
    st.textContent = `
      #vesco-saiu-layout-v6{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(390px,.9fr);gap:16px;align-items:start;width:100%;}
      #vesco-saiu-left-v6{min-width:0;}
      #vesco-saiu-right-v6{position:sticky;top:92px;align-self:start;z-index:5;}
      #vesco-route-map-panel-v6{border:1px solid #dbe5f1;background:#fff;border-radius:14px;padding:10px;box-shadow:0 8px 22px rgba(15,23,42,.06);}
      #vesco-route-map-v6{height:calc(100vh - 245px);min-height:390px;width:100%;border-radius:12px;overflow:hidden;background:#eef2f7;}
      #vesco-route-info-panel-v6{margin-bottom:12px;padding:12px;border:1px solid #bfdbfe;background:#eff6ff;border-radius:14px;font-size:12px;color:#334155;}
      #vesco-route-map-panel-v5,#vesco-route-info-panel-v5{display:none!important;}
      .vesco-rota-origem-v6 input{width:100%;}
      @media(max-width:1024px){#vesco-saiu-layout-v6{grid-template-columns:1fr;}#vesco-saiu-right-v6{position:relative;top:0;}#vesco-route-map-v6{height:360px;min-height:360px;}}
    `;
    document.head.appendChild(st);
  }
  function v6EnsureLayout(){
    v6InstallRouteCss();
    const root = v6RouteRoot();
    if(!root) return null;
    let shell = document.getElementById('vesco-saiu-layout-v6');
    if(!shell) {
      shell = document.createElement('div');
      shell.id = 'vesco-saiu-layout-v6';
      const left = document.createElement('div'); left.id = 'vesco-saiu-left-v6';
      const right = document.createElement('div'); right.id = 'vesco-saiu-right-v6';
      right.innerHTML = `
        <div id="vesco-route-info-panel-v6">
          <div class="font-black text-blue-800 mb-1"><i class="fas fa-route mr-1"></i>Planejamento da rota</div>
          <div class="text-slate-600">Informe o ponto de partida, selecione os pedidos e clique em <b>Traçar Rota</b> ou <b>Criar Rota</b>.</div>
        </div>
        <div id="vesco-route-map-panel-v6">
          <div class="flex items-center justify-between mb-2">
            <div class="text-[11px] font-black text-slate-500 uppercase">Mapa da rota</div>
            <div class="text-[10px] font-bold text-blue-600 uppercase">Ponto inicial + entregas</div>
          </div>
          <div id="vesco-route-map-v6"></div>
        </div>`;
      const children = Array.from(root.children).filter(ch => ch.id !== 'vesco-saiu-layout-v6');
      root.appendChild(shell);
      shell.appendChild(left); shell.appendChild(right);
      children.forEach(ch => left.appendChild(ch));
    }
    v6InjectOriginField();
    setTimeout(() => { try { const m = v6EnsureRouteMap(); if(m) m.invalidateSize(true); } catch(e) {} }, 120);
    return shell;
  }
  function v6InjectOriginField(){
    if(document.getElementById('vesco-rota-origem-v6')) return;
    const root = v6RouteRoot() || document;
    const saved = localStorage.getItem(ORIGIN_KEY) || '';
    const wrap = document.createElement('div');
    wrap.className = 'vesco-rota-origem-v6 mb-3';
    wrap.innerHTML = `
      <label class="block text-xs font-black text-slate-700 mb-1">Ponto de partida da rota</label>
      <input id="vesco-rota-origem-v6" type="text" value="${v6Escape(saved)}" placeholder="Ex: Rua Conselheiro Dantas, 141 - Brás, São Paulo - SP" class="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm outline-none focus:border-blue-500" />
      <div class="text-[10px] text-slate-400 mt-1">Esse endereço será usado como início no mapa e no Google Maps.</div>`;
    const motorista = root.querySelector('#rotaMotorista, #motoristaRota, #routeDriver, input[name="motorista"], input[placeholder*="motorista" i]');
    const nome = root.querySelector('#rotaNome, #nomeRota, #routeName, input[name="rota"], input[placeholder*="rota" i]');
    const anchor = motorista || nome || root.querySelector('#saiu-pedidos-list') || root.firstElementChild;
    const parent = anchor && (anchor.closest('div') || anchor.parentElement);
    if(parent && parent.parentElement) parent.parentElement.insertBefore(wrap, parent.nextSibling);
    else root.prepend(wrap);
    const input = wrap.querySelector('input');
    input.addEventListener('input', () => { try { localStorage.setItem(ORIGIN_KEY, input.value.trim()); } catch(e) {} });
  }
  function v6GetRouteOrigin(requireValue){
    v6InjectOriginField();
    const el = document.getElementById('vesco-rota-origem-v6');
    const val = v6CleanAddress((el && el.value) || localStorage.getItem(ORIGIN_KEY) || '');
    if(val) { try { localStorage.setItem(ORIGIN_KEY, val); } catch(e) {} }
    if(requireValue && !val) alert('Informe o ponto de partida da rota.');
    return val;
  }
  function v6FindLeafletMapForContainer(el){
    if(!el) return null;
    const seen = new Set();
    const scan = (obj, depth) => {
      if(!obj || seen.has(obj) || depth > 2) return null;
      seen.add(obj);
      try {
        if(obj._container === el && typeof obj.setView === 'function' && typeof obj.invalidateSize === 'function') return obj;
        if(typeof obj === 'object') {
          for(const k in obj){
            if(!Object.prototype.hasOwnProperty.call(obj,k)) continue;
            const v = obj[k];
            if(v && typeof v === 'object') {
              if(v._container === el && typeof v.setView === 'function' && typeof v.invalidateSize === 'function') return v;
              if(depth < 1 && /map|rota|route|saiu|vesco/i.test(k)) {
                const found = scan(v, depth + 1);
                if(found) return found;
              }
            }
          }
        }
      } catch(e) {}
      return null;
    };
    return scan(window, 0);
  }
  function v6EnsureRouteMap(){
    if(typeof L === 'undefined') return null;
    v6EnsureLayout();
    const el = document.getElementById('vesco-route-map-v6');
    if(!el) return null;
    let m = v6FindLeafletMapForContainer(el);
    if(m) { window.routeMapV6 = m; setTimeout(() => { try { m.invalidateSize(true); } catch(e) {} }, 80); return m; }
    try {
      if(el._leaflet_id) { el.innerHTML = ''; try { delete el._leaflet_id; } catch(e) { el._leaflet_id = undefined; } }
      m = L.map(el).setView(DEFAULT_CENTER, 11);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png', { attribution: '&copy; CartoDB', maxZoom: 19 }).addTo(m);
      window.routeMapV6 = m;
      setTimeout(() => { try { m.invalidateSize(true); } catch(e) {} }, 150);
      return m;
    } catch(err) { v6Warn('Falha ao iniciar mapa V6:', err); return null; }
  }
  function v6ClearRouteLayer(mapTarget){
    try { if(window.__vescoRouteLayerV6 && typeof window.__vescoRouteLayerV6.remove === 'function') window.__vescoRouteLayerV6.remove(); } catch(e) {}
    const layer = L.layerGroup().addTo(mapTarget);
    window.__vescoRouteLayerV6 = layer;
    return layer;
  }
  async function v6GeocodeAddressFast(address){
    address = v6CleanAddress(address);
    if(!address) return null;
    const key = v6AddressKey(address);
    const cache = v6LoadGeoCache();
    if(cache[key] && Number.isFinite(Number(cache[key].lat)) && Number.isFinite(Number(cache[key].lon))) return cache[key];
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 3200) : null;
    try {
      const q = encodeURIComponent(address.includes('Brasil') ? address : `${address}, Brasil`);
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&addressdetails=0`, {
        headers: { 'Accept-Language': 'pt-BR' }, signal: controller ? controller.signal : undefined
      });
      if(timer) clearTimeout(timer);
      const js = await res.json();
      if(Array.isArray(js) && js[0]) {
        const out = { lat: Number(js[0].lat), lon: Number(js[0].lon) };
        if(Number.isFinite(out.lat) && Number.isFinite(out.lon)) { cache[key] = out; v6SaveGeoCache(cache); return out; }
      }
    } catch(e) { if(timer) clearTimeout(timer); }
    return null;
  }
  async function v6ResolveStopCoords(stop){
    if(stop && Number.isFinite(Number(stop.lat)) && Number.isFinite(Number(stop.lon))) return { lat: Number(stop.lat), lon: Number(stop.lon) };
    if(stop && !stop.isOrigin) {
      const marker = v6MarkerCoords(stop.numero || stop.pedido);
      if(marker) return marker;
      const order = v6FindOrder(stop.numero || stop.pedido);
      const direct = v6DirectCoords(order);
      if(direct) return direct;
    }
    const geo = await v6GeocodeAddressFast(stop && stop.endereco);
    if(geo && stop) { stop.lat = geo.lat; stop.lon = geo.lon; }
    return geo;
  }
  async function v6ResolveStopsLimited(stops){
    const out = [];
    let index = 0;
    const workers = Array.from({length: Math.min(3, stops.length || 1)}, async () => {
      while(index < stops.length) {
        const i = index++;
        const s = stops[i];
        const coords = await v6ResolveStopCoords(s);
        if(coords) out[i] = { stop: s, coords };
      }
    });
    await Promise.all(workers);
    return out.filter(Boolean);
  }
  function v6RenderRouteInfo(rota, url, subtitle){
    v6EnsureLayout();
    const panel = document.getElementById('vesco-route-info-panel-v6');
    if(!panel) return;
    const stops = rota.paradas || [];
    const origin = rota.origem || (stops[0] && stops[0].isOrigin ? stops[0].endereco : '—');
    panel.innerHTML = `
      <div class="font-black text-blue-800 mb-2"><i class="fas fa-route mr-1"></i>Rota montada: ${v6Escape(rota.nome || 'Rota')}</div>
      <div class="mb-1"><b>Partida:</b> ${v6Escape(origin || '—')}</div>
      <div class="mb-1"><b>Motorista:</b> ${v6Escape(rota.motorista || '—')} • <b>Pedidos:</b> ${(rota.pedidos || []).length}</div>
      ${subtitle ? `<div class="mb-2 text-blue-700 font-bold">${v6Escape(subtitle)}</div>` : ''}
      <div class="max-h-40 overflow-auto bg-white/70 border border-blue-100 rounded-lg p-2 mb-2">
        ${(stops || []).map((s, i) => `<div class="mb-1"><b>${s.isOrigin ? 'Partida' : (i + '. #' + v6Escape(s.numero || s.pedido))}</b> — ${v6Escape(s.endereco || 'Endereço não localizado')}</div>`).join('') || 'Nenhum endereço localizado.'}
      </div>
      ${url ? `<button type="button" onclick="window.open('${v6Escape(url)}','_blank')" class="inline-flex items-center gap-1 bg-blue-600 text-white px-3 py-1.5 rounded-lg font-bold"><i class="fas fa-map-marked-alt"></i>Abrir rota no Google Maps</button>` : ''}`;
  }
  async function v6DrawRouteOnMap(rotaOrId){
    const rota = typeof rotaOrId === 'string' ? v6FindRouteById(rotaOrId) : rotaOrId;
    if(!rota) return v6Toast('Rota não encontrada.', 'error', 3000);
    v6EnsureLayout();
    const mapTarget = v6EnsureRouteMap();
    rota.origem = v6CleanAddress(rota.origem || v6GetRouteOrigin(false));
    rota.paradas = v6BuildStops(rota.pedidos || [], rota.origem);
    const url = v6BuildGoogleMapsRouteUrl(rota);
    if(url) { try { localStorage.setItem(LAST_ROUTE_URL_KEY, url); } catch(e) {} }
    v6RenderRouteInfo(rota, url, 'Carregando pontos no mapa...');
    if(!mapTarget || typeof L === 'undefined') { if(url) window.open(url, '_blank'); return url; }
    const layer = v6ClearRouteLayer(mapTarget);
    try { mapTarget.setView(DEFAULT_CENTER, 11); setTimeout(() => mapTarget.invalidateSize(true), 100); } catch(e) {}
    const resolved = await v6ResolveStopsLimited(rota.paradas);
    const latlngs = [];
    resolved.forEach((item, idx) => {
      const s = item.stop;
      const coords = item.coords;
      const ll = [coords.lat, coords.lon];
      latlngs.push(ll);
      try {
        const color = s.isOrigin ? '#111827' : '#2563eb';
        const label = s.isOrigin ? 'Partida' : `Pedido #${v6Escape(s.numero || s.pedido)}`;
        const icon = L.divIcon({ html: `<div style="width:28px;height:28px;border-radius:999px;background:${color};color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.25)">${s.isOrigin ? 'P' : idx}</div>`, className: '', iconSize: [28,28], iconAnchor: [14,14] });
        L.marker(ll, { icon }).addTo(layer).bindPopup(`<b>${label}</b><br>${v6Escape(s.cliente || '')}<br><small>${v6Escape(s.endereco || '')}</small>`);
      } catch(e) {}
    });
    if(latlngs.length > 1) { try { L.polyline(latlngs, { weight: 5, opacity: 0.88 }).addTo(layer); } catch(e) {} }
    try {
      if(latlngs.length === 1) mapTarget.setView(latlngs[0], 15);
      else if(latlngs.length > 1) mapTarget.fitBounds(L.latLngBounds(latlngs).pad(0.18), { maxZoom: 15 });
      else mapTarget.setView(DEFAULT_CENTER, 11);
      setTimeout(() => mapTarget.invalidateSize(true), 150);
      setTimeout(() => mapTarget.invalidateSize(true), 650);
    } catch(e) {}
    v6RenderRouteInfo(rota, url, `${Math.max(0, latlngs.length - (rota.origem ? 1 : 0))}/${(rota.pedidos || []).length} entrega(s) carregada(s) no mapa.`);
    v6PersistRoutes();
    return url;
  }
  function v6CollectSelectedRoutePedidos(){
    const selectors = [
      '#saiu-pedidos-list input[type="checkbox"]:checked', '#view-saiu input[type="checkbox"]:checked', '#view-rotas input[type="checkbox"]:checked',
      '#pedidosDisponiveis input[type="checkbox"]:checked', '[data-route-order]:checked', '[data-num][type="checkbox"]:checked', '[data-ecom][type="checkbox"]:checked'
    ];
    const inputs = Array.from(new Set(selectors.flatMap(sel => Array.from(document.querySelectorAll(sel)))));
    const out = [];
    inputs.forEach(cb => {
      let val = cb.getAttribute('data-num') || cb.getAttribute('data-ecom') || cb.getAttribute('data-pedido') || cb.value || '';
      if(!val || val === 'on') {
        const row = cb.closest('tr') || cb.closest('.pedido-item') || cb.closest('[data-num]') || cb.parentElement;
        val = row && (row.getAttribute('data-num') || row.getAttribute('data-ecom') || row.getAttribute('data-pedido')) || '';
        if(!val && row) {
          const txt = row.innerText || '';
          const m = txt.match(/#\s*([0-9A-Za-z._-]{4,})/) || txt.match(/\b(\d{5,})\b/);
          if(m) val = m[1];
        }
      }
      val = v6Norm(val);
      if(val && !out.includes(val)) out.push(val);
    });
    return out;
  }
  function v6GetInputValue(candidates){
    for(const sel of candidates){ const el = document.querySelector(sel); if(el && String(el.value || '').trim()) return String(el.value).trim(); }
    return '';
  }
  function v6IsCreateRouteButton(btn){
    if(!btn || !btn.matches || !btn.matches('button, a, [role="button"], input[type="button"], input[type="submit"]')) return false;
    const idName = `${btn.id || ''} ${btn.name || ''} ${btn.getAttribute('onclick') || ''}`;
    const text = `${btn.value || ''} ${btn.textContent || ''}`.trim();
    if(/btn[-_]?criar[-_]?rota|criarRota|createRoute/i.test(idName)) return true;
    return /\bcriar\s+rota\b/i.test(text) && !!(btn.closest('#view-rotas') || btn.closest('#view-saiu') || document.getElementById('rotaMotorista') || document.getElementById('rotaNome'));
  }
  function v6ExtractRouteIdFromButton(btn){
    const onclick = btn && btn.getAttribute && (btn.getAttribute('onclick') || '');
    const m = onclick.match(/['"](rota-[^'"]+)['"]/i) || onclick.match(/['"]([^'"]*\d{10,}[^'"]*)['"]/i);
    if(m) return m[1];
    const card = btn && btn.closest && btn.closest('[data-rota-id], [data-route-id]');
    return card && (card.getAttribute('data-rota-id') || card.getAttribute('data-route-id')) || '';
  }
  function v6IsTraceRouteButton(btn){
    if(!btn || !btn.matches || !btn.matches('button, a, [role="button"], input[type="button"], input[type="submit"]')) return false;
    const idName = `${btn.id || ''} ${btn.name || ''} ${btn.getAttribute('onclick') || ''}`;
    const text = `${btn.value || ''} ${btn.textContent || ''}`.trim();
    if(/google\s*maps/i.test(text)) return !!v6ExtractRouteIdFromButton(btn);
    return /tracar|tra[cç]ar|route|rotaMapa|obter.*rota|verRotaMapa/i.test(idName) || /tra[cç]ar\s+(no\s+mapa|rota)|ver\s+no\s+mapa|obter informa[cç][oõ]es da rota/i.test(text);
  }
  function v6SilentUpdateStatus(id, status, observacao){
    try {
      if(typeof jsonpFetch !== 'function' || typeof API === 'undefined') return;
      const url = `${API}?action=updateStatus&id=${encodeURIComponent(id)}&status=${encodeURIComponent(status)}&operador=${encodeURIComponent(currentOperator || '')}&observacao=${encodeURIComponent(observacao || '')}&dataSeparacao=${encodeURIComponent(v6NowBR())}`;
      jsonpFetch(url, function(err){ if(err) v6Warn('Erro ao salvar status da rota no backend:', id, err); });
    } catch(e) { v6Warn('Falha no update silencioso V6:', e); }
  }
  function v6MarkLocalOutForDelivery(pedidoNum, rota){
    const order = v6FindOrder(pedidoNum);
    const now = new Date().toISOString();
    if(order) {
      order.status_logistica = 'Despachado';
      order.situacao_nome = 'Despachado';
      order.data_despacho = v6NowBR();
      order.despachado_em = now;
      order.saiuParaEntregaEm = now;
      const obsAntiga = String(order.observacao_logistica || order.observacao || '').trim();
      const obsNova = `Saiu para entrega — Rota: ${rota.nome || 'Rota'} Motorista: ${rota.motorista || '—'} Origem: ${rota.origem || '—'}`;
      order.observacao_logistica = obsAntiga ? `${obsAntiga} | ${obsNova}` : obsNova;
    }
    try { if(typeof rememberStatusTransition === 'function') rememberStatusTransition(pedidoNum, 'Despachado'); } catch(e) {}
    try { if(typeof syncGlobalOrderState === 'function') syncGlobalOrderState(); } catch(e) {}
  }
  function v6DispatchRouteToStreet(rota, opts = {}){
    if(!rota) return;
    const now = new Date().toISOString();
    rota.status = 'despachada';
    rota.despachadaEm = rota.despachadaEm || now;
    rota.saiuEm = rota.saiuEm || now;
    rota.paradas = v6BuildStops(rota.pedidos || [], rota.origem);
    (rota.pedidos || []).forEach((pedidoNum, idx) => {
      v6MarkLocalOutForDelivery(pedidoNum, rota);
      if(!opts.skipBackend) setTimeout(() => v6SilentUpdateStatus(pedidoNum, 'Despachado', `Saiu para entrega — Rota: ${rota.nome || 'Rota'} Motorista: ${rota.motorista || '—'} Origem: ${rota.origem || '—'}`), idx * 180);
    });
    v6PersistRoutes();
    try { if(typeof render === 'function') render(); } catch(e) {}
    try { if(typeof window.renderPedidosDisponiveisSaiu === 'function') window.renderPedidosDisponiveisSaiu(); } catch(e) {}
    try { if(typeof window.renderSelectedTemp === 'function') window.renderSelectedTemp(); } catch(e) {}
    try { if(typeof window.renderRotas === 'function') window.renderRotas(); } catch(e) {}
    v6DrawRouteOnMap(rota);
  }
  function v6HandleCreateRoute(e){
    e.preventDefault(); e.stopPropagation(); if(typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    v6EnsureLayout();
    const origem = v6GetRouteOrigin(true);
    if(!origem) return;
    const motorista = v6GetInputValue(['#rotaMotorista', '#motoristaRota', '#routeDriver', 'input[name="motorista"]', 'input[placeholder*="motorista" i]']);
    const nome = v6GetInputValue(['#rotaNome', '#nomeRota', '#routeName', 'input[name="rota"]', 'input[placeholder*="rota" i]']) || `Rota ${new Date().toLocaleString('pt-BR')}`;
    const pedidos = v6CollectSelectedRoutePedidos();
    if(!motorista) return alert('Informe o nome do motorista.');
    if(!pedidos.length) return alert('Selecione ao menos 1 pedido para criar a rota.');
    window.saiuRotas = Array.isArray(window.saiuRotas) ? window.saiuRotas : [];
    const nova = { id: 'rota-' + Date.now(), nome, motorista, origem, pedidos, status: 'despachada', criadoEm: new Date().toISOString(), despachadaEm: new Date().toISOString(), saiuEm: new Date().toISOString(), paradas: v6BuildStops(pedidos, origem) };
    window.saiuRotas.push(nova);
    try { window.rotaTemp = { motorista: '', nome: '', pedidos: [] }; } catch(e) {}
    ['#rotaMotorista', '#motoristaRota', '#routeDriver', '#rotaNome', '#nomeRota', '#routeName'].forEach(sel => { const el = document.querySelector(sel); if(el) el.value = ''; });
    v6DispatchRouteToStreet(nova);
    v6Toast(`Rota criada. ${pedidos.length} pedido(s) marcado(s) como saiu para entrega.`, 'success', 4500);
  }
  function v6HandleTraceRoute(e){
    const routeId = v6ExtractRouteIdFromButton(e.target.closest('button, a, [role="button"], input[type="button"], input[type="submit"]'));
    if(routeId) {
      e.preventDefault(); e.stopPropagation(); if(typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      const rota = v6FindRouteById(routeId);
      if(rota) return v6DrawRouteOnMap(rota);
    }
    const pedidos = v6CollectSelectedRoutePedidos();
    if(!pedidos.length) return;
    e.preventDefault(); e.stopPropagation(); if(typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    v6EnsureLayout();
    const origem = v6GetRouteOrigin(true);
    if(!origem) return;
    const temp = { id: 'rota-preview-' + Date.now(), nome: 'Prévia da rota', motorista: v6GetInputValue(['#rotaMotorista', '#motoristaRota', '#routeDriver', 'input[name="motorista"]', 'input[placeholder*="motorista" i]']) || '—', origem, pedidos, status: 'preview', criadoEm: new Date().toISOString(), paradas: v6BuildStops(pedidos, origem) };
    v6DrawRouteOnMap(temp).then(() => v6Toast('Rota traçada com ponto de partida e entregas selecionadas.', 'success', 3000));
  }

  window.addEventListener('click', function vescoRouteClickCaptureV6(e){
    const btn = e.target && e.target.closest && e.target.closest('button, a, [role="button"], input[type="button"], input[type="submit"]');
    if(!btn) return;
    if(v6IsCreateRouteButton(btn)) return v6HandleCreateRoute(e);
    if(v6IsTraceRouteButton(btn)) return v6HandleTraceRoute(e);
  }, true);

  document.addEventListener('DOMContentLoaded', function(){
    setTimeout(v6EnsureLayout, 350);
    setTimeout(v6EnsureRouteMap, 700);
  });

  window.vescoRoutesV6 = {
    ensureLayout: v6EnsureLayout,
    ensureRouteMap: v6EnsureRouteMap,
    drawRouteOnMap: v6DrawRouteOnMap,
    buildStops: v6BuildStops,
    buildGoogleMapsRouteUrl: v6BuildGoogleMapsRouteUrl,
    collectSelectedRoutePedidos: v6CollectSelectedRoutePedidos,
    findRouteById: v6FindRouteById,
    getRouteOrigin: v6GetRouteOrigin,
    dispatchRouteToStreet: v6DispatchRouteToStreet,
    findOrder: v6FindOrder,
    persistRoutes: v6PersistRoutes,
    silentUpdateStatus: v6SilentUpdateStatus,
    nowBR: v6NowBR,
    escape: v6Escape
  };
  v6Log('Rotas V6 PRE ativo — mapa no canto superior direito e ponto de partida obrigatório.');
})();

// =================================================================
// CAMADA V5 — OTIMIZAÇÃO DO MAPA DE ROTAS + PENDÊNCIA ROBUSTA EM ENTREGUES
// Regra de Preservação: camada aditiva, sem remover funções anteriores.
// =================================================================
(function installVescoRoutesMapAndDeliveredPendenciaV5(){
  if (window.__vescoRoutesMapAndDeliveredPendenciaV5) return;
  window.__vescoRoutesMapAndDeliveredPendenciaV5 = true;

  const ROUTES_KEY = 'vesco_saiu_rotas_v1';
  const LAST_ROUTE_URL_KEY = 'vesco_last_google_route_url_v5';
  const GEO_CACHE_KEY = 'vesco_route_geocode_cache_v5';
  const DEFAULT_CENTER = [-23.55052, -46.633308];

  function v5Log(){ try { console.log.apply(console, arguments); } catch(e) {} }
  function v5Warn(){ try { console.warn.apply(console, arguments); } catch(e) {} }
  function v5Toast(msg, ms){
    try { if (typeof showToast === 'function') return showToast(msg, ms || 3500); } catch(e) {}
    v5Log(msg);
  }
  function v5Escape(v){
    try { return typeof escapeHtml === 'function' ? escapeHtml(v) : String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
    catch(e){ return String(v ?? ''); }
  }
  function v5Norm(v){
    try { return typeof normalizeOrderNumber === 'function' ? normalizeOrderNumber(v) : String(v ?? '').trim(); }
    catch(e){ return String(v ?? '').trim(); }
  }
  function v5NormEcom(v){
    try { return typeof normalizeEcomNumber === 'function' ? normalizeEcomNumber(v) : String(v ?? '').replace(/\D/g,''); }
    catch(e){ return String(v ?? '').trim(); }
  }
  function v5NowBR(){
    const d = new Date();
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  }
  function v5PersistRoutes(){
    try { localStorage.setItem(ROUTES_KEY, JSON.stringify(window.saiuRotas || [])); } catch(e) {}
  }
  function v5LoadGeoCache(){
    try { return JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || '{}') || {}; } catch(e) { return {}; }
  }
  function v5SaveGeoCache(cache){
    try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(cache || {})); } catch(e) {}
  }
  function v5CleanAddress(addr){
    return String(addr || '')
      .replace(/\s+/g, ' ')
      .replace(/\|/g, ',')
      .replace(/\bSao\b/gi, 'São')
      .trim();
  }
  function v5AddressKey(addr){ return v5CleanAddress(addr).toLowerCase(); }

  function v5AllOrders(){
    const localOrders = (typeof orders !== 'undefined' && Array.isArray(orders)) ? orders : [];
    const localFlex = (typeof flexOrders !== 'undefined' && Array.isArray(flexOrders)) ? flexOrders : [];
    const winOrders = Array.isArray(window.orders) ? window.orders : [];
    const winFlex = Array.isArray(window.flexOrders) ? window.flexOrders : [];
    return Array.from(new Set([].concat(localOrders, localFlex, winOrders, winFlex).filter(Boolean)));
  }
  function v5OrderKeys(o){
    if(!o) return [];
    const vals = [
      o.id, o.numero, o.pedido, o.order_id, o.orderNumber, o.reference, o.referencia,
      o.numero_ecommerce, o.numero_ecom, o.ecom, o.ecom_id, o.codigo_externo, o.codigo
    ];
    const keys = [];
    vals.forEach(v => {
      if(v === undefined || v === null || String(v).trim() === '') return;
      const raw = String(v).trim();
      keys.push(raw, v5Norm(raw), v5NormEcom(raw));
    });
    return Array.from(new Set(keys.filter(Boolean)));
  }
  function v5FindOrder(key){
    const raw = String(key ?? '').trim();
    const norm = v5Norm(raw);
    const ecom = v5NormEcom(raw);
    return v5AllOrders().find(o => {
      const keys = v5OrderKeys(o);
      return keys.includes(raw) || keys.includes(norm) || keys.includes(ecom);
    }) || null;
  }
  function v5OrderAddress(o){
    if(!o) return '';
    return v5CleanAddress(o.endereco_completo || o.endereco || o.address || o.full_address || o.logradouro || '');
  }
  function v5OrderClient(o){
    try { return extractClientNameFromAny(o) || o.cliente_nome || o.cliente || o.nome || o.destinatario || ''; }
    catch(e){ return o && (o.cliente_nome || o.cliente || o.nome || o.destinatario) || ''; }
  }
  function v5DirectCoords(o){
    try {
      const c = typeof getCoords === 'function' ? getCoords(o) : null;
      if(c && Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lon))) return { lat: Number(c.lat), lon: Number(c.lon) };
    } catch(e) {}
    return null;
  }
  function v5MarkerCoords(key){
    try {
      const m = (typeof findMainMarkerByKey === 'function' && findMainMarkerByKey(key)) ||
                (typeof findFlexMarkerByKey === 'function' && findFlexMarkerByKey(key));
      if(m && typeof m.getLatLng === 'function') {
        const ll = m.getLatLng();
        if(ll && Number.isFinite(Number(ll.lat)) && Number.isFinite(Number(ll.lng))) return { lat: Number(ll.lat), lon: Number(ll.lng) };
      }
    } catch(e) {}
    return null;
  }
  function v5BuildStops(pedidos){
    return Array.from(new Set((pedidos || []).map(v => String(v || '').trim()).filter(Boolean))).map(pedido => {
      const order = v5FindOrder(pedido);
      const coords = v5DirectCoords(order) || v5MarkerCoords(pedido) || v5MarkerCoords(order && (order.numero || order.id));
      return {
        pedido,
        id: order && (order.id || order.numero) || pedido,
        numero: order && (order.numero || order.id) || pedido,
        cliente: v5OrderClient(order),
        endereco: v5OrderAddress(order),
        lat: coords ? coords.lat : null,
        lon: coords ? coords.lon : null
      };
    });
  }
  function v5EncodeStop(stop){
    if(stop && Number.isFinite(Number(stop.lat)) && Number.isFinite(Number(stop.lon))) return `${Number(stop.lat)},${Number(stop.lon)}`;
    return v5CleanAddress((stop && stop.endereco) || (stop && stop.cliente) || (stop && stop.numero) || '');
  }
  function v5BuildGoogleMapsRouteUrl(rota){
    const stops = (rota && rota.paradas && rota.paradas.length ? rota.paradas : v5BuildStops(rota && rota.pedidos || [])).filter(s => v5EncodeStop(s));
    if(!stops.length) return '';
    const limited = stops.slice(0, 25);
    if(limited.length === 1) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v5EncodeStop(limited[0]))}`;
    const origin = v5EncodeStop(limited[0]);
    const destination = v5EncodeStop(limited[limited.length - 1]);
    const waypoints = limited.slice(1, -1).map(v5EncodeStop).filter(Boolean);
    let url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving`;
    if(waypoints.length) url += `&waypoints=${encodeURIComponent(waypoints.join('|'))}`;
    return url;
  }
  function v5FindRouteById(id){
    return (window.saiuRotas || []).find(r => String(r.id) === String(id)) || null;
  }

  function v5RouteRoot(){
    const candidates = ['#view-rotas:not(.hidden)', '#view-saiu:not(.hidden)', '#view-rotas', '#view-saiu'];
    for(const sel of candidates){
      const el = document.querySelector(sel);
      if(el) return el;
    }
    return document.body;
  }
  function v5Visible(el){
    if(!el) return false;
    const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
    return (!style || (style.display !== 'none' && style.visibility !== 'hidden')) && el.offsetParent !== null;
  }
  function v5FindLeafletMapForContainer(el){
    if(!el) return null;
    const seen = new Set();
    const scan = (obj, depth) => {
      if(!obj || seen.has(obj) || depth > 2) return null;
      seen.add(obj);
      try {
        if(obj._container === el && typeof obj.setView === 'function' && typeof obj.invalidateSize === 'function') return obj;
        if(typeof obj === 'object') {
          for(const k in obj){
            if(!Object.prototype.hasOwnProperty.call(obj,k)) continue;
            const v = obj[k];
            if(v && typeof v === 'object') {
              if(v._container === el && typeof v.setView === 'function' && typeof v.invalidateSize === 'function') return v;
              if(depth < 1 && /map|rota|route|saiu/i.test(k)) {
                const found = scan(v, depth + 1);
                if(found) return found;
              }
            }
          }
        }
      } catch(e) {}
      return null;
    };
    return scan(window, 0);
  }
  function v5RouteMapContainer(){
    const root = v5RouteRoot();
    const preferredIds = ['vesco-route-map-v5','map-rotas','rotas-map','route-map','map-route','routeMap','map-saiu','saiu-map','mapa-rotas','mapaRotas','mapRota'];
    for(const id of preferredIds){
      const el = document.getElementById(id);
      if(el && (root.contains(el) || id === 'vesco-route-map-v5')) return el;
    }
    const inside = Array.from(root.querySelectorAll('.leaflet-container, [id*="map" i], [class*="map" i]'))
      .filter(el => el instanceof HTMLElement)
      .filter(el => !['map','map-flex'].includes(el.id))
      .filter(el => (el.clientWidth > 120 || el.offsetWidth > 120 || /map/i.test(el.id + ' ' + el.className)));
    if(inside.length) return inside[0];

    let panel = document.getElementById('vesco-route-map-panel-v5');
    if(!panel) {
      panel = document.createElement('div');
      panel.id = 'vesco-route-map-panel-v5';
      panel.className = 'mt-3 rounded-xl border border-slate-200 bg-white p-2';
      panel.innerHTML = `<div class="text-[11px] font-black text-slate-500 mb-2 uppercase">Mapa da rota</div><div id="vesco-route-map-v5" style="height:360px;min-height:360px;width:100%;border-radius:12px;overflow:hidden;background:#eef2f7"></div>`;
      const anchor = root.querySelector('#vesco-route-info-panel-v5') || Array.from(root.querySelectorAll('button')).find(b => /tra[cç]ar rota|obter informa/i.test(b.textContent || ''));
      if(anchor && anchor.parentElement) anchor.parentElement.insertAdjacentElement('afterend', panel);
      else root.appendChild(panel);
    }
    return document.getElementById('vesco-route-map-v5');
  }
  function v5EnsureRouteMap(){
    if(typeof L === 'undefined') return null;
    const el = v5RouteMapContainer();
    if(!el) return null;
    el.style.minHeight = el.style.minHeight || '360px';
    el.style.height = el.style.height || '360px';
    el.style.width = el.style.width || '100%';
    el.style.borderRadius = el.style.borderRadius || '12px';
    el.style.overflow = 'hidden';

    let m = v5FindLeafletMapForContainer(el);
    if(m) {
      window.routeMap = m;
      setTimeout(() => { try { m.invalidateSize(true); } catch(e) {} }, 80);
      return m;
    }

    try {
      if(el._leaflet_id) {
        el.innerHTML = '';
        try { delete el._leaflet_id; } catch(e) { el._leaflet_id = undefined; }
      }
      m = L.map(el).setView(DEFAULT_CENTER, 11);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png', { attribution: '&copy; CartoDB', maxZoom: 19 }).addTo(m);
      window.routeMap = m;
      setTimeout(() => { try { m.invalidateSize(true); } catch(e) {} }, 120);
      return m;
    } catch(err) {
      v5Warn('Falha ao iniciar mapa de rotas V5:', err);
      return null;
    }
  }
  function v5ClearRouteLayer(mapTarget){
    try { if(window.__vescoRouteLayerV5 && typeof window.__vescoRouteLayerV5.remove === 'function') window.__vescoRouteLayerV5.remove(); } catch(e) {}
    try { if(window.__vescoRouteLayerV4 && typeof window.__vescoRouteLayerV4.remove === 'function') window.__vescoRouteLayerV4.remove(); } catch(e) {}
    const layer = L.layerGroup().addTo(mapTarget);
    window.__vescoRouteLayerV5 = layer;
    return layer;
  }

  async function v5GeocodeAddressFast(address){
    address = v5CleanAddress(address);
    if(!address) return null;
    const key = v5AddressKey(address);
    const cache = v5LoadGeoCache();
    if(cache[key] && Number.isFinite(Number(cache[key].lat)) && Number.isFinite(Number(cache[key].lon))) return cache[key];

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 2600) : null;
    try {
      const q = encodeURIComponent(address.includes('Brasil') ? address : `${address}, Brasil`);
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&addressdetails=0`, {
        headers: { 'Accept-Language': 'pt-BR' },
        signal: controller ? controller.signal : undefined
      });
      if(timer) clearTimeout(timer);
      const js = await res.json();
      if(Array.isArray(js) && js[0]) {
        const out = { lat: Number(js[0].lat), lon: Number(js[0].lon) };
        if(Number.isFinite(out.lat) && Number.isFinite(out.lon)) {
          cache[key] = out;
          v5SaveGeoCache(cache);
          return out;
        }
      }
    } catch(e) { if(timer) clearTimeout(timer); }
    return null;
  }
  async function v5ResolveStopCoords(stop){
    if(stop && Number.isFinite(Number(stop.lat)) && Number.isFinite(Number(stop.lon))) return { lat: Number(stop.lat), lon: Number(stop.lon) };
    const marker = v5MarkerCoords(stop && (stop.numero || stop.pedido));
    if(marker) return marker;
    const order = v5FindOrder(stop && (stop.numero || stop.pedido));
    const direct = v5DirectCoords(order);
    if(direct) return direct;
    const geo = await v5GeocodeAddressFast(stop && stop.endereco);
    if(geo) {
      stop.lat = geo.lat;
      stop.lon = geo.lon;
      return geo;
    }
    return null;
  }
  async function v5ResolveStopsLimited(stops){
    const out = [];
    let index = 0;
    const workers = Array.from({length: Math.min(4, stops.length || 1)}, async () => {
      while(index < stops.length) {
        const i = index++;
        const s = stops[i];
        const coords = await v5ResolveStopCoords(s);
        if(coords) out[i] = { stop: s, coords };
      }
    });
    await Promise.all(workers);
    return out.filter(Boolean);
  }

  async function v5DrawRouteOnMap(rotaOrId){
    const rota = typeof rotaOrId === 'string' ? v5FindRouteById(rotaOrId) : rotaOrId;
    if(!rota) return v5Toast('Rota não encontrada.', 3000);

    const mapTarget = v5EnsureRouteMap();
    const stops = (rota.paradas && rota.paradas.length ? rota.paradas : v5BuildStops(rota.pedidos || []));
    rota.paradas = stops;
    const url = v5BuildGoogleMapsRouteUrl(rota);
    if(url) {
      try { localStorage.setItem(LAST_ROUTE_URL_KEY, url); } catch(e) {}
      v5RenderRouteInfo(rota, url, 'Carregando pontos no mapa...');
    }

    if(!mapTarget || typeof L === 'undefined') {
      if(url) window.open(url, '_blank');
      return url;
    }

    const layer = v5ClearRouteLayer(mapTarget);
    try { mapTarget.setView(DEFAULT_CENTER, 11); setTimeout(() => mapTarget.invalidateSize(true), 100); } catch(e) {}

    const resolved = await v5ResolveStopsLimited(stops);
    const latlngs = [];
    resolved.forEach((item, idx) => {
      const s = item.stop;
      const coords = item.coords;
      const ll = [coords.lat, coords.lon];
      latlngs.push(ll);
      try {
        L.marker(ll).addTo(layer).bindPopup(`<b>${idx + 1}. Pedido #${v5Escape(s.numero || s.pedido)}</b><br>${v5Escape(s.cliente || '')}<br><small>${v5Escape(s.endereco || '')}</small>`);
      } catch(e) {}
    });
    if(latlngs.length > 1) {
      try { L.polyline(latlngs, { weight: 4, opacity: 0.85 }).addTo(layer); } catch(e) {}
    }
    try {
      if(latlngs.length === 1) mapTarget.setView(latlngs[0], 15);
      else if(latlngs.length > 1) mapTarget.fitBounds(L.latLngBounds(latlngs).pad(0.18), { maxZoom: 15 });
      else mapTarget.setView(DEFAULT_CENTER, 11);
      setTimeout(() => mapTarget.invalidateSize(true), 150);
      setTimeout(() => mapTarget.invalidateSize(true), 650);
    } catch(e) {}

    v5RenderRouteInfo(rota, url, `${latlngs.length}/${stops.length} endereço(s) carregado(s) no mapa.`);
    v5PersistRoutes();
    return url;
  }
  function v5RenderRouteInfo(rota, url, subtitle){
    const root = v5RouteRoot();
    let panel = document.getElementById('vesco-route-info-panel-v5') || document.getElementById('vesco-route-info-panel');
    if(!panel) {
      panel = document.createElement('div');
      panel.id = 'vesco-route-info-panel-v5';
      panel.className = 'my-3 p-3 rounded-xl border border-blue-100 bg-blue-50 text-xs text-slate-700';
      const anchor = Array.from(root.querySelectorAll('button')).find(b => /p\/ motorista|tra[cç]ar rota|obter informa/i.test(b.textContent || ''));
      if(anchor && anchor.parentElement) anchor.parentElement.insertAdjacentElement('afterend', panel);
      else root.prepend(panel);
    } else {
      panel.id = 'vesco-route-info-panel-v5';
    }
    const stops = rota.paradas || [];
    panel.innerHTML = `
      <div class="font-black text-blue-800 mb-2"><i class="fas fa-route mr-1"></i>Rota montada: ${v5Escape(rota.nome || 'Rota')}</div>
      <div class="mb-1"><b>Motorista:</b> ${v5Escape(rota.motorista || '—')} • <b>Pedidos:</b> ${stops.length || (rota.pedidos || []).length}</div>
      ${subtitle ? `<div class="mb-2 text-blue-700 font-bold">${v5Escape(subtitle)}</div>` : ''}
      <div class="max-h-36 overflow-auto bg-white/70 border border-blue-100 rounded-lg p-2 mb-2">
        ${(stops || []).map((s, i) => `<div class="mb-1"><b>${i + 1}. #${v5Escape(s.numero || s.pedido)}</b> — ${v5Escape(s.endereco || 'Endereço não localizado')}</div>`).join('') || 'Nenhum endereço localizado.'}
      </div>
      ${url ? `<button type="button" onclick="window.open('${v5Escape(url)}','_blank')" class="inline-flex items-center gap-1 bg-blue-600 text-white px-3 py-1.5 rounded-lg font-bold"><i class="fas fa-map-marked-alt"></i>Abrir rota no Google Maps</button>` : ''}
    `;
  }

  function v5CollectSelectedRoutePedidos(){
    const selectors = [
      '#saiu-pedidos-list input[type="checkbox"]:checked',
      '#view-saiu input[type="checkbox"]:checked',
      '#view-rotas input[type="checkbox"]:checked',
      '#pedidosDisponiveis input[type="checkbox"]:checked',
      '[data-route-order]:checked',
      '[data-num][type="checkbox"]:checked',
      '[data-ecom][type="checkbox"]:checked'
    ];
    const inputs = Array.from(new Set(selectors.flatMap(sel => Array.from(document.querySelectorAll(sel)))));
    const out = [];
    inputs.forEach(cb => {
      let val = cb.getAttribute('data-num') || cb.getAttribute('data-ecom') || cb.getAttribute('data-pedido') || cb.value || '';
      if(!val || val === 'on') {
        const row = cb.closest('tr') || cb.closest('.pedido-item') || cb.closest('[data-num]') || cb.parentElement;
        val = row && (row.getAttribute('data-num') || row.getAttribute('data-ecom') || row.getAttribute('data-pedido')) || '';
        if(!val && row) {
          const txt = row.innerText || '';
          const m = txt.match(/#\s*([0-9A-Za-z._-]{4,})/) || txt.match(/\b(\d{5,})\b/);
          if(m) val = m[1];
        }
      }
      val = v5Norm(val);
      if(val) out.push(val);
    });
    return Array.from(new Set(out));
  }
  function v5GetInputValue(candidates){
    for(const sel of candidates){
      const el = document.querySelector(sel);
      if(el && String(el.value || '').trim()) return String(el.value).trim();
    }
    return '';
  }
  function v5IsCreateRouteButton(btn){
    if(!btn || !btn.matches || !btn.matches('button, a, [role="button"], input[type="button"], input[type="submit"]')) return false;
    const idName = `${btn.id || ''} ${btn.name || ''} ${btn.getAttribute('onclick') || ''}`;
    const text = `${btn.value || ''} ${btn.textContent || ''}`.trim();
    if(/btn[-_]?criar[-_]?rota|criarRota|createRoute/i.test(idName)) return true;
    return /\bcriar\s+rota\b/i.test(text) && !!(btn.closest('#view-rotas') || btn.closest('#view-saiu') || document.getElementById('rotaMotorista') || document.getElementById('rotaNome'));
  }
  function v5IsTraceRouteButton(btn){
    if(!btn || !btn.matches || !btn.matches('button, a, [role="button"], input[type="button"], input[type="submit"]')) return false;
    const idName = `${btn.id || ''} ${btn.name || ''} ${btn.getAttribute('onclick') || ''}`;
    const text = `${btn.value || ''} ${btn.textContent || ''}`.trim();
    return /tracar|tra[cç]ar|route|rotaMapa|obter.*rota/i.test(idName) || /tra[cç]ar\s+rota|obter informa[cç][oõ]es da rota/i.test(text);
  }
  function v5MarkLocalOutForDelivery(pedidoNum, rota){
    const order = v5FindOrder(pedidoNum);
    const now = new Date().toISOString();
    const todayBR = v5NowBR();
    if(order) {
      order.status_logistica = 'Despachado';
      order.situacao_nome = 'Saiu para entrega';
      order.data_despacho = todayBR;
      order.despachado_em = now;
      order.saiuParaEntregaEm = now;
      const obsAntiga = String(order.observacao_logistica || order.observacao || '').trim();
      const obsNova = `Saiu para entrega — Rota: ${rota.nome || 'Rota'} Motorista: ${rota.motorista || '—'}`;
      order.observacao_logistica = obsAntiga ? `${obsAntiga} | ${obsNova}` : obsNova;
    }
    try { if(typeof rememberStatusTransition === 'function') rememberStatusTransition(pedidoNum, 'Despachado'); } catch(e) {}
    try { if(typeof syncGlobalOrderState === 'function') syncGlobalOrderState(); } catch(e) {}
  }
  function v5SilentUpdateStatus(id, status, observacao){
    try {
      if(typeof jsonpFetch !== 'function' || typeof API === 'undefined') return;
      const url = `${API}?action=updateStatus&id=${encodeURIComponent(id)}&status=${encodeURIComponent(status)}&operador=${encodeURIComponent(currentOperator || '')}&observacao=${encodeURIComponent(observacao || '')}&dataSeparacao=${encodeURIComponent(v5NowBR())}`;
      jsonpFetch(url, function(err){ if(err) v5Warn('Erro ao salvar status da rota no backend:', id, err); });
    } catch(e) { v5Warn('Falha no update silencioso:', e); }
  }
  function v5DispatchRouteToStreet(rota, opts = {}){
    if(!rota) return;
    const now = new Date().toISOString();
    rota.status = 'despachada';
    rota.despachadaEm = rota.despachadaEm || now;
    rota.saiuEm = rota.saiuEm || now;
    rota.paradas = v5BuildStops(rota.pedidos || []);
    (rota.pedidos || []).forEach((pedidoNum, idx) => {
      v5MarkLocalOutForDelivery(pedidoNum, rota);
      if(!opts.skipBackend) setTimeout(() => v5SilentUpdateStatus(pedidoNum, 'Despachado', `Saiu para entrega — Rota: ${rota.nome || 'Rota'} Motorista: ${rota.motorista || '—'}`), idx * 220);
    });
    v5PersistRoutes();
    try { if(typeof render === 'function') render(); } catch(e) {}
    try { if(typeof window.renderPedidosDisponiveisSaiu === 'function') window.renderPedidosDisponiveisSaiu(); } catch(e) {}
    try { if(typeof window.renderSelectedTemp === 'function') window.renderSelectedTemp(); } catch(e) {}
    try { if(typeof window.renderRotas === 'function') window.renderRotas(); } catch(e) {}
    v5DrawRouteOnMap(rota);
  }
  function v5HandleCreateRoute(e){
    e.preventDefault();
    e.stopPropagation();
    if(typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    const motorista = v5GetInputValue(['#rotaMotorista', '#motoristaRota', '#routeDriver', 'input[name="motorista"]', 'input[placeholder*="motorista" i]']);
    const nome = v5GetInputValue(['#rotaNome', '#nomeRota', '#routeName', 'input[name="rota"]', 'input[placeholder*="rota" i]']) || `Rota ${new Date().toLocaleString('pt-BR')}`;
    const pedidos = v5CollectSelectedRoutePedidos();
    if(!motorista) return alert('Informe o nome do motorista.');
    if(!pedidos.length) return alert('Selecione ao menos 1 pedido para criar a rota.');
    window.saiuRotas = Array.isArray(window.saiuRotas) ? window.saiuRotas : [];
    const nova = { id: 'rota-' + Date.now(), nome, motorista, pedidos, status: 'despachada', criadoEm: new Date().toISOString(), despachadaEm: new Date().toISOString(), saiuEm: new Date().toISOString(), paradas: v5BuildStops(pedidos) };
    window.saiuRotas.push(nova);
    try { window.rotaTemp = { motorista: '', nome: '', pedidos: [] }; } catch(e) {}
    ['#rotaMotorista', '#motoristaRota', '#routeDriver', '#rotaNome', '#nomeRota', '#routeName'].forEach(sel => { const el = document.querySelector(sel); if(el) el.value = ''; });
    v5DispatchRouteToStreet(nova);
    v5Toast(`Rota criada. ${pedidos.length} pedido(s) marcado(s) como saiu para entrega.`, 4500);
  }
  function v5HandleTraceRoute(e){
    const pedidos = v5CollectSelectedRoutePedidos();
    if(!pedidos.length) return;
    e.preventDefault();
    e.stopPropagation();
    if(typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    const temp = { id: 'rota-preview-' + Date.now(), nome: 'Prévia da rota', motorista: v5GetInputValue(['#rotaMotorista', '#motoristaRota', '#routeDriver', 'input[name="motorista"]', 'input[placeholder*="motorista" i]']) || '—', pedidos, status: 'preview', criadoEm: new Date().toISOString(), paradas: v5BuildStops(pedidos) };
    v5DrawRouteOnMap(temp).then(() => v5Toast('Rota traçada com os endereços selecionados.', 3000));
  }

  window.addEventListener('click', function vescoRouteClickCaptureV5(e){
    const btn = e.target && e.target.closest && e.target.closest('button, a, [role="button"], input[type="button"], input[type="submit"]');
    if(!btn) return;
    if(v5IsCreateRouteButton(btn)) return v5HandleCreateRoute(e);
    if(v5IsTraceRouteButton(btn)) return v5HandleTraceRoute(e);
  }, true);

  const prevVerRotaMapa = window.verRotaMapa;
  window.verRotaMapa = function(rotaId){
    const rota = v5FindRouteById(rotaId);
    if(rota) return v5DrawRouteOnMap(rota);
    if(typeof prevVerRotaMapa === 'function') return prevVerRotaMapa.apply(this, arguments);
  };
  window.vescoOpenRouteInGoogle = function(rotaId){
    const rota = v5FindRouteById(rotaId);
    const url = rota ? v5BuildGoogleMapsRouteUrl(rota) : localStorage.getItem(LAST_ROUTE_URL_KEY);
    if(url) window.open(url, '_blank');
    else v5Toast('Nenhuma rota disponível para abrir.', 3000);
  };
  window.vescoGetRouteInfo = function(rotaId){
    const rota = v5FindRouteById(rotaId);
    if(!rota) return v5Toast('Rota não encontrada.', 3000);
    v5RenderRouteInfo(rota, v5BuildGoogleMapsRouteUrl(rota));
    return rota;
  };

  function v5FallbackPendencia(id){
    const motivo = prompt(`Motivo da pendência do pedido #${id}:`);
    if(!motivo) return;
    try {
      if(typeof updateStatusJsonp === 'function') updateStatusJsonp(id, 'Pendente', motivo);
      else v5SilentUpdateStatus(id, 'Pendente', motivo);
    } catch(e) { v5Warn(e); }
  }
  window.vescoEntregueParaPendenciaV5 = function(id){
    if(typeof window.moverParaPendenciaPrompt === 'function') return window.moverParaPendenciaPrompt(id);
    if(typeof moverParaPendenciaPrompt === 'function') return moverParaPendenciaPrompt(id);
    return v5FallbackPendencia(id);
  };
  function v5InjectDeliveredPendenciaButtons(){
    const tbody = document.getElementById('table-entregues');
    if(!tbody) return;
    Array.from(tbody.querySelectorAll('tr')).forEach(row => {
      if(row.querySelector('.vesco-entregue-pendencia-btn-v5')) return;
      if(/nenhum despacho|nenhum registro/i.test(row.innerText || '')) return;
      const txt = row.innerText || '';
      const m = txt.match(/#\s*([0-9A-Za-z._-]+)/) || txt.match(/\b(\d{5,})\b/);
      if(!m) return;
      const numero = m[1];
      const order = v5FindOrder(numero);
      const id = order && (order.id || order.numero) || numero;
      let target = row.querySelector('td:last-child');
      if(!target) return;
      const wrap = document.createElement('div');
      wrap.className = 'mt-2 flex justify-center gap-2';
      wrap.innerHTML = `<button type="button" class="vesco-entregue-pendencia-btn-v5 bg-amber-500 hover:bg-amber-600 text-white px-3 py-1 rounded-lg font-bold text-[11px] shadow-sm transition-all" onclick="window.vescoEntregueParaPendenciaV5 && window.vescoEntregueParaPendenciaV5('${v5Escape(id)}')"><i class="fas fa-triangle-exclamation mr-1"></i>Pendência</button>`;
      target.appendChild(wrap);
    });
  }

  const prevRender = typeof render === 'function' ? render : null;
  if(prevRender) {
    render = function(){
      const res = prevRender.apply(this, arguments);
      setTimeout(v5InjectDeliveredPendenciaButtons, 0);
      setTimeout(() => { try { const m = v5FindLeafletMapForContainer(v5RouteMapContainer()); if(m) m.invalidateSize(true); } catch(e) {} }, 120);
      return res;
    };
    window.render = render;
  }
  const prevSwitchTab = window.switchTab;
  if(typeof prevSwitchTab === 'function') {
    window.switchTab = function(which){
      const res = prevSwitchTab.apply(this, arguments);
      if(which === 'rotas' || which === 'saiu') setTimeout(() => { const m = v5EnsureRouteMap(); try { if(m) m.invalidateSize(true); } catch(e) {} }, 250);
      if(which === 'entregues') setTimeout(v5InjectDeliveredPendenciaButtons, 150);
      return res;
    };
  }
  const obs = new MutationObserver(() => {
    if(document.getElementById('table-entregues')) v5InjectDeliveredPendenciaButtons();
  });
  document.addEventListener('DOMContentLoaded', function(){
    try { obs.observe(document.body, { childList: true, subtree: true }); } catch(e) {}
    setTimeout(v5InjectDeliveredPendenciaButtons, 500);
    setTimeout(() => { const root = v5RouteRoot(); if(root && (root.id === 'view-rotas' || root.id === 'view-saiu')) v5EnsureRouteMap(); }, 600);
  });

  window.vescoRoutesV5 = {
    buildStops: v5BuildStops,
    drawRouteOnMap: v5DrawRouteOnMap,
    ensureRouteMap: v5EnsureRouteMap,
    injectDeliveredPendenciaButtons: v5InjectDeliveredPendenciaButtons,
    collectSelectedRoutePedidos: v5CollectSelectedRoutePedidos,
    buildGoogleMapsRouteUrl: v5BuildGoogleMapsRouteUrl
  };
  v5Log('Rotas V5 ativo — mapa dedicado de rotas, criação otimizada e Pendência robusta em Entregues.');
})();


// =================================================================
// CAMADA V6 POST — ENTREGAS DO MOTORISTA + PENDÊNCIA EM ENTREGUES + OTIMIZAÇÃO DE GEOCODE
// Regra de Preservação: wrappers aditivos sobre funções legadas/V5.
// =================================================================
(function installVescoDeliveredAndRoutePostV6(){
  if (window.__vescoDeliveredAndRoutePostV6) return;
  window.__vescoDeliveredAndRoutePostV6 = true;

  const SHADOW_DELIVERED_KEY = 'vesco_delivered_shadow_v6';

  function v6Log(){ try { console.log.apply(console, arguments); } catch(e) {} }
  function v6Warn(){ try { console.warn.apply(console, arguments); } catch(e) {} }
  function v6Toast(msg, typeOrMs, ms){
    try {
      if (typeof showToast === 'function') {
        if (typeof typeOrMs === 'string') return showToast(msg, typeOrMs, ms || 3500);
        return showToast(msg, typeOrMs || 3500);
      }
    } catch(e) {}
    v6Log(msg);
  }
  function v6Escape(v){
    try { return typeof escapeHtml === 'function' ? escapeHtml(v) : String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
    catch(e){ return String(v ?? ''); }
  }
  function v6Norm(v){
    try { return typeof normalizeOrderNumber === 'function' ? normalizeOrderNumber(v) : String(v ?? '').trim(); }
    catch(e){ return String(v ?? '').trim(); }
  }
  function v6NowBR(){
    const d = new Date();
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  }
  function v6FindOrder(id){
    try { if(window.vescoRoutesV6 && typeof window.vescoRoutesV6.findOrder === 'function') return window.vescoRoutesV6.findOrder(id); } catch(e) {}
    const raw = String(id || '').replace(/[^0-9A-Za-z._-]/g,'');
    const pools = [].concat((typeof orders !== 'undefined' && Array.isArray(orders)) ? orders : [], (typeof flexOrders !== 'undefined' && Array.isArray(flexOrders)) ? flexOrders : [], Array.isArray(window.orders) ? window.orders : [], Array.isArray(window.flexOrders) ? window.flexOrders : []);
    return pools.find(o => String(o.id || o.numero || '').replace(/[^0-9A-Za-z._-]/g,'') === raw || String(o.numero_ecommerce || '').replace(/[^0-9A-Za-z._-]/g,'') === raw) || null;
  }
  function v6ReadShadow(){ try { return JSON.parse(localStorage.getItem(SHADOW_DELIVERED_KEY) || '[]') || []; } catch(e) { return []; } }
  function v6WriteShadow(list){ try { localStorage.setItem(SHADOW_DELIVERED_KEY, JSON.stringify(list || [])); } catch(e) {} }
  function v6RememberDelivered(order, recebedor, documento, observacao){
    if(!order) return;
    const id = order.id || order.numero;
    const numero = order.numero || order.id || id;
    const payload = Object.assign({}, order, {
      id,
      numero,
      status_logistica: 'Entregue',
      situacao_nome: 'Entregue',
      nome_recebedor: recebedor || order.nome_recebedor || '',
      doc_recebedor: documento || order.doc_recebedor || '',
      observacao_logistica: observacao || order.observacao_logistica || order.observacao || '',
      entregue_em: new Date().toISOString(),
      data_entregue: v6NowBR(),
      data_entrega_realizada: v6NowBR()
    });
    const list = v6ReadShadow().filter(x => String(x.id || x.numero) !== String(id) && String(x.numero) !== String(numero));
    list.push(payload);
    v6WriteShadow(list.slice(-300));
  }
  function v6RemoveShadow(id){
    const raw = String(id || '');
    const norm = v6Norm(raw);
    v6WriteShadow(v6ReadShadow().filter(x => String(x.id || x.numero) !== raw && v6Norm(x.id || x.numero) !== norm && v6Norm(x.numero) !== norm));
  }
  function v6MergeDeliveredShadow(){
    try {
      if(typeof orders === 'undefined' || !Array.isArray(orders)) return;
      const list = v6ReadShadow();
      list.forEach(sh => {
        const found = orders.find(o => String(o.id || o.numero) === String(sh.id || sh.numero) || v6Norm(o.numero || o.id) === v6Norm(sh.numero || sh.id));
        if(found) Object.assign(found, sh, { status_logistica: 'Entregue', situacao_nome: 'Entregue' });
        else orders.push(Object.assign({}, sh, { status_logistica: 'Entregue', situacao_nome: 'Entregue' }));
      });
      try { window.orders = orders; } catch(e) {}
    } catch(e) { v6Warn('Falha ao mesclar entregues shadow:', e); }
  }
  function v6MarkDeliveredLocal(id, recebedor, documento, observacao){
    let order = v6FindOrder(id);
    if(!order) order = { id, numero: id, cliente_nome: '', endereco_completo: '' };
    order.status_logistica = 'Entregue';
    order.situacao_nome = 'Entregue';
    order.nome_recebedor = recebedor || order.nome_recebedor || '';
    order.doc_recebedor = documento || order.doc_recebedor || '';
    order.entregue_em = new Date().toISOString();
    order.data_entregue = v6NowBR();
    order.data_entrega_realizada = v6NowBR();
    if(observacao) order.observacao_logistica = observacao;
    try { if(typeof rememberStatusTransition === 'function') rememberStatusTransition(id, 'Entregue'); } catch(e) {}
    if(typeof orders !== 'undefined' && Array.isArray(orders) && !orders.some(o => String(o.id || o.numero) === String(order.id || order.numero))) orders.push(order);
    if(typeof flexOrders !== 'undefined' && Array.isArray(flexOrders)) flexOrders = flexOrders.filter(f => String(f.id || f.numero) !== String(id));
    v6RememberDelivered(order, recebedor, documento, observacao);
    try { if(typeof syncGlobalOrderState === 'function') syncGlobalOrderState(); } catch(e) {}
  }
  function v6MarkPendingLocal(id, observacao){
    const order = v6FindOrder(id);
    if(order) {
      order.status_logistica = 'Pendente';
      order.situacao_nome = 'Pendente';
      order.observacao_logistica = observacao || order.observacao_logistica || order.observacao || '';
    }
    v6RemoveShadow(id);
    try { if(typeof rememberStatusTransition === 'function') rememberStatusTransition(id, 'Pendente'); } catch(e) {}
    try { if(typeof syncGlobalOrderState === 'function') syncGlobalOrderState(); } catch(e) {}
  }

  // Reduz geocodificação em massa fora das abas de mapa logístico.
  try {
    const preservedPlotMapMarkersV6 = typeof plotMapMarkers === 'function' ? plotMapMarkers : null;
    if(preservedPlotMapMarkersV6 && !window.__vescoPlotMapMarkersWrappedV6) {
      window.__vescoPlotMapMarkersWrappedV6 = true;
      plotMapMarkers = function(orderList, flexList){
        const logVisible = !!document.querySelector('#view-logistica:not(.hidden)');
        const flexVisible = !!document.querySelector('#view-envios_flex:not(.hidden)');
        if(!logVisible && !flexVisible) return;
        return preservedPlotMapMarkersV6.apply(this, arguments);
      };
      window.plotMapMarkers = plotMapMarkers;
    }
  } catch(e) { v6Warn('Não foi possível otimizar plotMapMarkers:', e); }

  // Reforça mapa V6 nas ações legadas de rota.
  const prevVerRotaMapaV6Post = window.verRotaMapa;
  window.verRotaMapa = function(rotaId){
    try {
      if(window.vescoRoutesV6 && typeof window.vescoRoutesV6.drawRouteOnMap === 'function') return window.vescoRoutesV6.drawRouteOnMap(rotaId);
    } catch(e) { v6Warn(e); }
    if(typeof prevVerRotaMapaV6Post === 'function') return prevVerRotaMapaV6Post.apply(this, arguments);
  };
  window.vescoOpenRouteInGoogle = function(rotaId){
    try {
      const api = window.vescoRoutesV6;
      const rota = api && api.findRouteById && api.findRouteById(rotaId);
      const url = rota && api.buildGoogleMapsRouteUrl ? api.buildGoogleMapsRouteUrl(rota) : localStorage.getItem('vesco_last_google_route_url_v6');
      if(url) return window.open(url, '_blank');
    } catch(e) { v6Warn(e); }
    v6Toast('Nenhuma rota disponível para abrir.', 'warning', 3000);
  };

  // Motorista: ao confirmar entrega, joga para Entregues imediatamente e mantém opção de pendência.
  const prevEnviarComprovanteV6 = window.enviarComprovante;
  if(typeof prevEnviarComprovanteV6 === 'function') {
    window.enviarComprovante = function(){
      const pedidoId = (document.getElementById('motPedidoInput')?.value || '').trim();
      const recebedor = (document.getElementById('motRecebedor')?.value || '').trim();
      const documento = (document.getElementById('motDocumento')?.value || '').trim();
      const transportador = (document.getElementById('motTransportador')?.value || '').trim();
      const docLimpo = (documento || '').replace(/\D/g, '');
      if(!pedidoId || !recebedor || docLimpo.length < 8 || docLimpo.length > 14) return prevEnviarComprovanteV6.apply(this, arguments);
      const msgAudit = `Entregue via: ${transportador || '—'} | Recebido por: ${recebedor} (Doc: ${documento || 'Não informado'})`;
      const ret = prevEnviarComprovanteV6.apply(this, arguments);
      [250, 1200, 2600].forEach(delay => setTimeout(() => {
        v6MarkDeliveredLocal(pedidoId, recebedor, documento || 'Não informado', msgAudit);
        v6MergeDeliveredShadow();
        try { if(typeof renderMotorista === 'function') renderMotorista(); } catch(e) {}
        try { if(typeof render === 'function') render(); } catch(e) {}
        try { if(typeof switchTab === 'function') switchTab('entregues'); } catch(e) {}
        setTimeout(v6InjectDeliveredPendenciaButtons, 80);
      }, delay));
      return ret;
    };
  }

  const prevConcluirRotaV6 = window.concluirRota;
  if(typeof prevConcluirRotaV6 === 'function') {
    window.concluirRota = function(rotaId){
      const rota = (window.saiuRotas || []).find(r => String(r.id) === String(rotaId));
      const ret = prevConcluirRotaV6.apply(this, arguments);
      setTimeout(() => {
        if(!rota || rota.status !== 'concluida') return;
        (rota.pedidos || []).forEach(p => v6MarkDeliveredLocal(p, '', '', `Rota concluída: ${rota.nome || 'Rota'} Motorista: ${rota.motorista || '—'}`));
        v6MergeDeliveredShadow();
        try { if(typeof render === 'function') render(); } catch(e) {}
        try { if(typeof switchTab === 'function') switchTab('entregues'); } catch(e) {}
        setTimeout(v6InjectDeliveredPendenciaButtons, 100);
      }, 700);
      return ret;
    };
  }

  window.vescoPendenciaEntregaV6 = function(id){
    if(!id) return;
    const modal = document.getElementById('pendenciaModal');
    if(modal && typeof window.moverParaPendenciaPrompt === 'function') {
      try { window.moverParaPendenciaPrompt(id); } catch(e) { v6Warn(e); }
      return;
    }
    const motivo = prompt(`Informe a pendência do pedido #${id}:`);
    if(!motivo) return;
    const obs = `[Pós-entrega] ${motivo}`;
    v6MarkPendingLocal(id, obs);
    try {
      if(typeof updateStatusJsonp === 'function') updateStatusJsonp(id, 'Pendente', obs);
      else if(window.vescoRoutesV6 && typeof window.vescoRoutesV6.silentUpdateStatus === 'function') window.vescoRoutesV6.silentUpdateStatus(id, 'Pendente', obs);
    } catch(e) { v6Warn(e); }
    try { if(typeof render === 'function') render(); } catch(e) {}
    v6Toast('Pendência registrada para o pedido entregue.', 'warning', 3500);
  };

  const prevSalvarPendenciaModalV6 = window.salvarPendenciaModal;
  if(typeof prevSalvarPendenciaModalV6 === 'function') {
    window.salvarPendenciaModal = function(){
      const id = document.getElementById('pendenciaId')?.value || '';
      const motivo = document.getElementById('pendenciaMotivo')?.value || '';
      const detalhes = document.getElementById('pendenciaDetalhes')?.value || '';
      const ret = prevSalvarPendenciaModalV6.apply(this, arguments);
      if(id && String(detalhes).trim()) {
        setTimeout(() => {
          v6MarkPendingLocal(id, `[${motivo}] ${detalhes}`);
          try { if(typeof render === 'function') render(); } catch(e) {}
        }, 120);
      }
      return ret;
    };
  }

  function v6InjectDeliveredPendenciaButtons(){
    const tbody = document.getElementById('table-entregues');
    if(!tbody) return;
    Array.from(tbody.querySelectorAll('tr')).forEach(row => {
      if(row.querySelector('.vesco-entregue-pendencia-btn-v6-final')) return;
      if(/nenhum despacho|nenhum registro/i.test(row.innerText || '')) return;
      const txt = row.innerText || '';
      const m = txt.match(/#\s*([0-9A-Za-z._-]+)/) || txt.match(/\b(\d{5,})\b/);
      if(!m) return;
      const numero = m[1];
      const order = v6FindOrder(numero);
      const id = order && (order.id || order.numero) || numero;
      const target = row.querySelector('td:last-child');
      if(!target) return;
      const wrap = document.createElement('div');
      wrap.className = 'mt-2 flex justify-center gap-2';
      wrap.innerHTML = `<button type="button" class="vesco-entregue-pendencia-btn-v6-final bg-amber-500 hover:bg-amber-600 text-white px-3 py-1 rounded-lg font-bold text-[11px] shadow-sm transition-all" onclick="window.vescoPendenciaEntregaV6 && window.vescoPendenciaEntregaV6('${v6Escape(id)}')"><i class="fas fa-triangle-exclamation mr-1"></i>Pendência</button>`;
      target.appendChild(wrap);
    });
  }

  const prevRenderV6Post = typeof render === 'function' ? render : null;
  if(prevRenderV6Post) {
    render = function(){
      v6MergeDeliveredShadow();
      const res = prevRenderV6Post.apply(this, arguments);
      setTimeout(v6InjectDeliveredPendenciaButtons, 0);
      setTimeout(() => { try { if(window.vescoRoutesV6) { window.vescoRoutesV6.ensureLayout(); const m = window.vescoRoutesV6.ensureRouteMap(); if(m) m.invalidateSize(true); } } catch(e) {} }, 160);
      return res;
    };
    window.render = render;
  }

  const prevSwitchTabV6Post = window.switchTab;
  if(typeof prevSwitchTabV6Post === 'function') {
    window.switchTab = function(which){
      const res = prevSwitchTabV6Post.apply(this, arguments);
      if(which === 'saiu' || which === 'rotas') {
        setTimeout(() => { try { if(window.vescoRoutesV6) { window.vescoRoutesV6.ensureLayout(); const m = window.vescoRoutesV6.ensureRouteMap(); if(m) m.invalidateSize(true); } } catch(e) {} }, 180);
      }
      if(which === 'logistica' || which === 'envios_flex') setTimeout(() => { try { if(typeof render === 'function') render(); } catch(e) {} }, 80);
      if(which === 'entregues') setTimeout(v6InjectDeliveredPendenciaButtons, 180);
      return res;
    };
  }

  document.addEventListener('DOMContentLoaded', function(){
    v6MergeDeliveredShadow();
    setTimeout(() => { try { if(window.vescoRoutesV6) { window.vescoRoutesV6.ensureLayout(); window.vescoRoutesV6.ensureRouteMap(); } } catch(e) {} }, 700);
    setTimeout(v6InjectDeliveredPendenciaButtons, 900);
    try {
      const obs = new MutationObserver(() => {
        if(document.getElementById('table-entregues')) v6InjectDeliveredPendenciaButtons();
      });
      obs.observe(document.body, { childList: true, subtree: true });
    } catch(e) {}
  });

  window.vescoDeliveredV6 = {
    mergeShadow: v6MergeDeliveredShadow,
    markDeliveredLocal: v6MarkDeliveredLocal,
    injectPendencia: v6InjectDeliveredPendenciaButtons,
    markPendingLocal: v6MarkPendingLocal
  };
  v6Log('Rotas/Entregues V6 POST ativo — entrega do motorista aparece em Entregues e pendência pós-entrega disponível.');
})();

// =================================================================
// V7 — Correção definitiva da aba Entregues
// Objetivo: puxar entregas reais vindas do backend/planilha mesmo quando
// o Apps Script não devolve campo data_entregue/data_entrega_realizada.
// Preserva todas as camadas anteriores e apenas reforça a leitura/renderização.
// =================================================================
(function installVescoEntreguesBackendV7(){
  if (window.__vescoEntreguesBackendV7) return;
  window.__vescoEntreguesBackendV7 = true;

  const V7_SHADOW_KEYS = ['vesco_delivered_shadow_v6'];

  function v7Log(){ try { console.log.apply(console, arguments); } catch(e) {} }
  function v7Warn(){ try { console.warn.apply(console, arguments); } catch(e) {} }
  function v7Escape(v){
    try { return typeof escapeHtml === 'function' ? escapeHtml(v) : String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
    catch(e){ return String(v ?? ''); }
  }
  function v7Norm(v){
    try { return typeof normalizeOrderNumber === 'function' ? normalizeOrderNumber(v) : String(v ?? '').replace(/[^0-9A-Za-z._-]/g,'').trim(); }
    catch(e){ return String(v ?? '').replace(/[^0-9A-Za-z._-]/g,'').trim(); }
  }
  function v7TodayISO(){
    try { if(typeof getBrazilTodayISO === 'function') return getBrazilTodayISO(); } catch(e) {}
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function v7TodayBR(){
    const iso = v7TodayISO();
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
  }
  function v7SelectedISO(){
    try { if(typeof getSelectedOperationalDateISO === 'function') return getSelectedOperationalDateISO(); } catch(e) {}
    return v7TodayISO();
  }
  function v7SameISO(a,b){ return !!a && !!b && String(a).slice(0,10) === String(b).slice(0,10); }
  function v7SelectedIsToday(){ return v7SameISO(v7SelectedISO(), v7TodayISO()); }
  function v7DateToISO(v){
    try { if(typeof dateValueToISO === 'function') return dateValueToISO(v); } catch(e) {}
    if(v === null || v === undefined) return '';
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if(m) {
      let y = m[3]; if(y.length === 2) y = '20' + y;
      return `${y.padStart(4,'0')}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    }
    const d = new Date(s);
    if(!isNaN(d.getTime())) return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    return '';
  }
  function v7ReadLocalArray(key){
    try {
      const raw = localStorage.getItem(key);
      if(!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch(e) { return []; }
  }
  function v7Pools(){
    const out = [];
    try { if(typeof orders !== 'undefined' && Array.isArray(orders)) out.push(...orders); } catch(e) {}
    try { if(Array.isArray(window.orders)) out.push(...window.orders); } catch(e) {}
    try { if(typeof flexOrders !== 'undefined' && Array.isArray(flexOrders)) out.push(...flexOrders); } catch(e) {}
    try { if(Array.isArray(window.flexOrders)) out.push(...window.flexOrders); } catch(e) {}
    V7_SHADOW_KEYS.forEach(k => out.push(...v7ReadLocalArray(k)));
    const map = new Map();
    out.forEach(o => {
      if(!o || typeof o !== 'object') return;
      const key = v7Norm(o.id || o.numero || o.pedido || o.numero_ecommerce || JSON.stringify(o).slice(0,40));
      if(!key) return;
      if(!map.has(key)) map.set(key, Object.assign({}, o));
      else map.set(key, Object.assign({}, map.get(key), o));
    });
    return Array.from(map.values());
  }
  function v7StatusOnly(o){
    return String((o && (o.status_logistica || o.situacao_nome || o.situacao || o.status || o.status_entrega || o.status_rota)) || '').toLowerCase().trim();
  }
  function v7AllText(o){
    if(!o) return '';
    return [
      o.status_logistica, o.situacao_nome, o.situacao, o.status, o.status_entrega, o.status_rota,
      o.observacao_logistica, o.observacao, o.audit, o.historico, o.historico_status
    ].map(x => String(x || '')).join(' ').toLowerCase();
  }
  function v7IsDeliveredRecord(o){
    if(!o) return false;
    const status = v7StatusOnly(o);
    const all = v7AllText(o);

    // Se o status atual voltou para pendência ou separação, não deve aparecer como entregue,
    // mesmo que exista uma observação antiga de entrega.
    if(/\bpendente\b|a separar|em separa[cç][aã]o|pronto p\/? entrega|separado pendente/.test(status) && !/\bentregue\b|finaliz|conclu/.test(status)) {
      return false;
    }

    return /\bentregue\b|entregue via|recebido por|finalizad|conclu[ií]d/.test(all);
  }
  function v7DeliveryISO(o){
    try { if(typeof getOrderDeliveryISO === 'function') { const iso = getOrderDeliveryISO(o); if(iso) return iso; } } catch(e) {}
    const fields = ['data_entrega_realizada','entregue_em','entregueEm','data_entregue','dataEntregue','dataEntrega','delivered_at','deliveredAt','concluidaEm','concluido_em','finalizado_em'];
    for(const k of fields){
      const iso = v7DateToISO(o && o[k]);
      if(iso) return iso;
    }
    const txt = String((o && (o.observacao_logistica || o.observacao || o.audit || o.historico)) || '');
    try {
      if(typeof extractFirstDateLikeString === 'function') {
        const found = extractFirstDateLikeString(txt);
        const iso = v7DateToISO(found);
        if(iso) return iso;
      }
    } catch(e) {}
    return '';
  }
  function v7ShouldShowDeliveredForSelectedDate(o){
    if(!v7IsDeliveredRecord(o)) return false;
    const iso = v7DeliveryISO(o);
    if(iso) return v7SameISO(iso, v7SelectedISO());

    // Correção principal: o backend/planilha já informa status Entregue, mas não fornece data_entregue.
    // Nesse caso, exibe no dia atual e registra no histórico local para próximas renderizações.
    if(v7SelectedIsToday()) return true;

    // Também permite visualizar se o registro local já foi salvo na sombra sem data explícita.
    return false;
  }
  function v7ForceHistoryForBackendDelivered(){
    const all = v7Pools();
    all.forEach(o => {
      if(!v7IsDeliveredRecord(o)) return;
      try {
        if(!v7DeliveryISO(o) && v7SelectedIsToday() && typeof rememberStatusTransition === 'function') {
          rememberStatusTransition(o.id || o.numero || o.pedido || o.numero_ecommerce, 'Entregue');
        }
      } catch(e) {}
      try {
        if(!o.status_logistica || !/entregue/i.test(String(o.status_logistica))) o.status_logistica = 'Entregue';
        if(!o.situacao_nome || !/entregue/i.test(String(o.situacao_nome))) o.situacao_nome = 'Entregue';
        if(!v7DeliveryISO(o) && v7SelectedIsToday()) {
          o.entregue_em = new Date().toISOString();
          o.data_entregue = v7TodayBR();
          o.data_entrega_realizada = v7TodayBR();
        }
      } catch(e) {}
    });
  }
  function v7ReceiverInfo(o){
    let recNome = o && (o.nome_recebedor || o.recebedor || o.recebido_por || '');
    let recDoc = o && (o.doc_recebedor || o.documento_recebedor || o.doc || '');
    const txt = String((o && (o.observacao_logistica || o.observacao || '')) || '');
    if(!recNome) {
      const m = txt.match(/Recebido por:\s*(.*?)\s*\(\s*Doc:\s*(.*?)\s*\)/i);
      if(m) { recNome = m[1].trim(); recDoc = (m[2] || '').trim(); }
    }
    return { nome: recNome || '—', doc: recDoc || '—' };
  }
  function v7GetSearch(){
    const el = document.getElementById('search') || document.querySelector('input[placeholder*="Filtrar" i]');
    return String((el && el.value) || '').toLowerCase().trim();
  }
  function v7IdFor(o){ return o && (o.id || o.numero || o.pedido || o.numero_ecommerce || ''); }
  function v7MatchesSearch(o, q){
    if(!q) return true;
    return [o.numero, o.id, o.pedido, o.numero_ecommerce, o.cliente_nome, o.cliente, o.destinatario, o.nome, o.endereco_completo, o.endereco]
      .some(v => String(v || '').toLowerCase().includes(q));
  }
  function v7RenderDeliveredTable(){
    // V11: quando a camada V10/V11 estiver ativa, a V7 não reescreve mais a tabela.
    // Isso preserva a função antiga, mas evita disputa de renderização e loop visual.
    if(window.__vescoEntreguesV10SafeDate) return;
    const tbody = document.getElementById('table-entregues');
    if(!tbody) return;

    v7ForceHistoryForBackendDelivered();

    const q = v7GetSearch();
    const delivered = v7Pools()
      .filter(o => v7ShouldShowDeliveredForSelectedDate(o))
      .filter(o => v7MatchesSearch(o, q));

    const unique = [];
    const seen = new Set();
    delivered.forEach(o => {
      const key = v7Norm(o.id || o.numero || o.pedido || o.numero_ecommerce);
      if(!key || seen.has(key)) return;
      seen.add(key);
      unique.push(o);
    });

    if(unique.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-400 font-semibold">Nenhum despacho realizado.</td></tr>`;
      return;
    }

    tbody.innerHTML = unique.map((o, idx) => {
      const id = v7IdFor(o);
      const numero = o.numero || o.id || o.pedido || 'S/N';
      const cliente = o.cliente_nome || o.cliente || o.destinatario || o.nome || '—';
      const rec = v7ReceiverInfo(o);
      const tempo = o.tempo_separacao || o.tempo_entrega || o.tempo || '—';
      return `
        <tr class="${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} hover:bg-slate-100/70 text-xs md:text-sm">
          <td class="p-3 pl-4 font-black text-slate-900">#${v7Escape(numero)}</td>
          <td class="p-3 font-semibold text-slate-800">${v7Escape(cliente)}</td>
          <td class="p-3 hidden md:table-cell">
            <div class="font-bold text-slate-800 flex items-center gap-1.5"><i class="fas fa-user-check text-blue-500"></i>${v7Escape(rec.nome)}</div>
            <div class="text-[11px] text-slate-500 mt-0.5 font-mono"><i class="fas fa-id-card text-slate-400 mr-1"></i>Doc: ${v7Escape(rec.doc)}</div>
          </td>
          <td class="p-3 text-center text-emerald-700 font-mono font-bold">${v7Escape(tempo)}</td>
          <td class="p-3 pr-4 text-center">
            <div class="flex flex-col items-center gap-2">
              <span class="bg-emerald-50 text-emerald-700 font-bold border border-emerald-200 px-3 py-1 rounded-xl text-[10px] uppercase tracking-wider inline-flex items-center gap-1"><i class="fas fa-check-circle text-emerald-500"></i> Entregue</span>
              <button type="button" class="bg-amber-500 hover:bg-amber-600 text-white px-3 py-1 rounded-lg font-bold text-[11px] shadow-sm transition-all" onclick="window.vescoPendenciaEntregaV7 ? window.vescoPendenciaEntregaV7('${v7Escape(id)}') : (window.vescoPendenciaEntregaV6 && window.vescoPendenciaEntregaV6('${v7Escape(id)}'))"><i class="fas fa-triangle-exclamation mr-1"></i>Pendência</button>
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  // Torna o filtro global mais tolerante para o render legado.
  try {
    window.shouldShowDeliveredForOperationalDate = shouldShowDeliveredForOperationalDate = function(o){
      return v7ShouldShowDeliveredForSelectedDate(o);
    };
  } catch(e) {}

  window.vescoPendenciaEntregaV7 = function(id){
    if(!id) return;
    try {
      if(typeof window.vescoPendenciaEntregaV6 === 'function') return window.vescoPendenciaEntregaV6(id);
      if(typeof window.moverParaPendenciaPrompt === 'function') return window.moverParaPendenciaPrompt(id);
    } catch(e) { v7Warn(e); }
    const motivo = prompt(`Informe a pendência do pedido #${id}:`);
    if(!motivo) return;
    try { if(typeof updateStatusJsonp === 'function') updateStatusJsonp(id, 'Pendente', `[Pós-entrega] ${motivo}`); } catch(e) {}
    try { setTimeout(() => { if(typeof render === 'function') render(); }, 250); } catch(e) {}
  };

  const prevEnviarComprovanteV7 = window.enviarComprovante;
  if(typeof prevEnviarComprovanteV7 === 'function') {
    window.enviarComprovante = function(){
      const pedidoId = (document.getElementById('motPedidoInput')?.value || '').trim();
      const recebedor = (document.getElementById('motRecebedor')?.value || '').trim();
      const documento = (document.getElementById('motDocumento')?.value || '').trim();
      const transportador = (document.getElementById('motTransportador')?.value || '').trim();
      const ret = prevEnviarComprovanteV7.apply(this, arguments);
      if(pedidoId && recebedor) {
        const msgAudit = `Entregue via: ${transportador || '—'} | Recebido por: ${recebedor} (Doc: ${documento || 'Não informado'})`;
        [80, 450, 1400, 3200].forEach(delay => setTimeout(() => {
          try { if(window.vescoDeliveredV6 && typeof window.vescoDeliveredV6.markDeliveredLocal === 'function') window.vescoDeliveredV6.markDeliveredLocal(pedidoId, recebedor, documento || 'Não informado', msgAudit); } catch(e) {}
          try { if(typeof rememberStatusTransition === 'function') rememberStatusTransition(pedidoId, 'Entregue'); } catch(e) {}
          try { v7RenderDeliveredTable(); } catch(e) {}
          try { if(typeof switchTab === 'function') switchTab('entregues'); } catch(e) {}
        }, delay));
      }
      return ret;
    };
  }

  const prevScheduleRenderV7 = typeof scheduleRender === 'function' ? scheduleRender : null;
  if(prevScheduleRenderV7 && !window.__vescoScheduleRenderV7Wrapped) {
    window.__vescoScheduleRenderV7Wrapped = true;
    scheduleRender = function(){
      try { v7ForceHistoryForBackendDelivered(); } catch(e) {}
      const ret = prevScheduleRenderV7.apply(this, arguments);
      setTimeout(v7RenderDeliveredTable, 90);
      return ret;
    };
    window.scheduleRender = scheduleRender;
  }

  const prevRenderV7 = typeof render === 'function' ? render : null;
  if(prevRenderV7 && !window.__vescoRenderEntreguesV7Wrapped) {
    window.__vescoRenderEntreguesV7Wrapped = true;
    render = function(){
      try { v7ForceHistoryForBackendDelivered(); } catch(e) {}
      const ret = prevRenderV7.apply(this, arguments);
      setTimeout(v7RenderDeliveredTable, 0);
      return ret;
    };
    window.render = render;
  }

  const prevSwitchTabV7 = window.switchTab;
  if(typeof prevSwitchTabV7 === 'function' && !window.__vescoSwitchTabEntreguesV7Wrapped) {
    window.__vescoSwitchTabEntreguesV7Wrapped = true;
    window.switchTab = function(which){
      const ret = prevSwitchTabV7.apply(this, arguments);
      if(which === 'entregues' && !window.__vescoEntreguesV10SafeDate) setTimeout(v7RenderDeliveredTable, 80);
      return ret;
    };
  }

  document.addEventListener('DOMContentLoaded', function(){
    setTimeout(v7RenderDeliveredTable, 900);
    try {
      const obs = new MutationObserver(() => {
        if(document.getElementById('table-entregues')) setTimeout(v7RenderDeliveredTable, 30);
      });
      obs.observe(document.body, { childList: true, subtree: true });
    } catch(e) {}
  });

  window.vescoEntreguesV7 = {
    render: v7RenderDeliveredTable,
    isDelivered: v7IsDeliveredRecord,
    forceHistory: v7ForceHistoryForBackendDelivered,
    collect: function(){ return v7Pools().filter(v7ShouldShowDeliveredForSelectedDate); }
  };

  v7Log('Entregues V7 ativo — status Entregue do backend/planilha agora aparece mesmo sem data_entregue, com Pendência pós-entrega.');
})();

// =================================================================
// CAMADA V8 — COMPATIBILIDADE DEFINITIVA: "SAIU PARA ENTREGA" => "PRONTO PARA ENVIO"
// Regra de Preservação: não remove legado; cria aliases e normalizações.
// =================================================================
(function installProntoParaEnvioCompatibilityV8(){
  if (window.__vescoProntoParaEnvioCompatibilityV8) return;
  window.__vescoProntoParaEnvioCompatibilityV8 = true;

  function v8NormTxt(v){
    return String(v || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function v8Escape(v){
    try { return typeof escapeHtml === 'function' ? escapeHtml(v) : String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
    catch(e){ return String(v ?? ''); }
  }

  function v8StatusText(o){
    return v8NormTxt(o && (
      o.status_logistica ||
      o.situacao_nome ||
      o.situacao ||
      o.status ||
      o.status_entrega ||
      o.status_rota ||
      ''
    ));
  }

  function v8IsProntoParaEnvioStatus(o){
    const st = v8StatusText(o);
    const obs = v8NormTxt(o && (o.observacao_logistica || o.observacao || o.audit || o.historico || ''));
    return (
      st.includes('pronto para envio') ||
      st.includes('saiu para entrega') ||
      st.includes('despachado') ||
      st.includes('em rota') ||
      st === 'rota' ||
      obs.includes('pronto para envio') ||
      obs.includes('saiu para entrega')
    );
  }

  function v8AllOrders(){
    const out = [];
    try { if (typeof orders !== 'undefined' && Array.isArray(orders)) out.push(...orders); } catch(e) {}
    try { if (typeof flexOrders !== 'undefined' && Array.isArray(flexOrders)) out.push(...flexOrders); } catch(e) {}
    try { if (Array.isArray(window.orders)) out.push(...window.orders); } catch(e) {}
    try { if (Array.isArray(window.flexOrders)) out.push(...window.flexOrders); } catch(e) {}
    const seen = new Set();
    return out.filter(o => {
      if (!o) return false;
      const k = String(o.id || o.numero || o.pedido || o.numero_ecommerce || Math.random());
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function v8FindOrder(id){
    const raw = String(id || '').trim();
    const norm = raw.replace(/[^0-9A-Za-z._-]/g, '');
    return v8AllOrders().find(o => {
      const vals = [o.id, o.numero, o.pedido, o.order_id, o.orderNumber, o.numero_ecommerce, o.referencia, o.reference];
      return vals.some(v => {
        const s = String(v || '').trim();
        return s === raw || s.replace(/[^0-9A-Za-z._-]/g, '') === norm;
      });
    }) || null;
  }

  // Corrige compatibilidade da função antiga isDispatchedStatus.
  const oldIsDispatchedStatusV8 = window.isDispatchedStatus || (typeof isDispatchedStatus === 'function' ? isDispatchedStatus : null);
  window.isDispatchedStatus = isDispatchedStatus = function(o){
    if (v8IsProntoParaEnvioStatus(o)) return true;
    if (typeof oldIsDispatchedStatusV8 === 'function') {
      try { return oldIsDispatchedStatusV8(o); } catch(e) {}
    }
    return false;
  };

  // O motorista precisa enxergar pedidos "Pronto para Envio" também.
  const oldRenderMotoristaV8 = window.renderMotorista;
  window.renderMotorista = function(){
    const tbodyMot = document.getElementById('table-motorista');
    if (!tbodyMot) {
      if (typeof oldRenderMotoristaV8 === 'function') return oldRenderMotoristaV8.apply(this, arguments);
      return;
    }

    const emRota = v8AllOrders().filter(o => v8IsProntoParaEnvioStatus(o));

    if (emRota.length === 0) {
      tbodyMot.innerHTML = `
        <tr>
          <td colspan="3" class="p-8 text-center text-slate-400 font-bold">
            <i class="fas fa-box-open text-3xl mb-2 block"></i>
            Nenhum pedido pronto para envio no momento.
          </td>
        </tr>`;
      return;
    }

    tbodyMot.innerHTML = emRota.map(o => `
      <tr class="hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0">
        <td class="p-3 font-black text-slate-800 text-sm">#${v8Escape(o.numero || o.id)}</td>
        <td class="p-3 leading-tight">
          <span class="font-bold text-slate-700 text-sm">
            ${v8Escape(o.cliente_nome || o.destinatario || o.cliente || o.nome || '')}
          </span><br>
          <span class="text-[11px] text-slate-400 font-normal">
            <i class="fas fa-location-dot text-slate-300 mr-1"></i>
            ${v8Escape(o.endereco_completo || o.endereco || '')}
          </span>
        </td>
        <td class="p-3 text-right">
          <button onclick="abrirAssinaturaMotorista('${v8Escape(o.numero || o.id)}')" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-bold text-[11px] shadow-sm transition-all uppercase whitespace-nowrap">
            <i class="fas fa-signature mr-1"></i> Entregar
          </button>
        </td>
      </tr>
    `).join('');
  };

  // Compatibilidade de abas: o HTML pode chamar pronto_envio, pronto_para_envio,
  // prontoParaEnvio ou envio; internamente o legado continua usando "saiu".
  function v8ResolveSaiuAlias(which){
    if (
      which === 'pronto_envio' ||
      which === 'pronto_para_envio' ||
      which === 'prontoParaEnvio' ||
      which === 'pronto-envio' ||
      which === 'pronto-para-envio' ||
      which === 'envio'
    ) return 'saiu';
    return which;
  }

  function v8ProntoView(){
    return document.getElementById('view-pronto-envio') ||
           document.getElementById('view-pronto_envio') ||
           document.getElementById('view-pronto_para_envio') ||
           document.getElementById('view-prontoParaEnvio');
  }

  function v8RouteViewHasContent(el){
    return !!(el && el.querySelector && el.querySelector('#saiu-pedidos-list, #saiu-rotas-list, #btnCriarRota, #btn-criar-rota, #rotaMotorista, #rotaNome'));
  }

  const oldSwitchTabV8 = window.switchTab;
  window.switchTab = function(which){
    const alvo = v8ResolveSaiuAlias(which);

    const result = typeof oldSwitchTabV8 === 'function'
      ? oldSwitchTabV8.call(this, alvo)
      : undefined;

    const viewSaiu = document.getElementById('view-saiu');
    const viewPronto = v8ProntoView();

    if (alvo === 'saiu') {
      if (viewPronto && !viewSaiu) {
        viewPronto.classList.remove('hidden');
      } else if (viewPronto && viewSaiu) {
        const prontoHas = v8RouteViewHasContent(viewPronto);
        const saiuHas = v8RouteViewHasContent(viewSaiu);
        if (prontoHas && !saiuHas) {
          viewPronto.classList.remove('hidden');
          viewSaiu.classList.add('hidden');
        } else {
          viewSaiu.classList.remove('hidden');
          if (viewPronto !== viewSaiu) viewPronto.classList.add('hidden');
        }
      }
    } else {
      if (viewPronto) viewPronto.classList.add('hidden');
    }

    const btnPronto = document.getElementById('main-pronto-envio') ||
                      document.getElementById('main-pronto_envio') ||
                      document.getElementById('main-pronto_para_envio') ||
                      document.getElementById('main-prontoParaEnvio');

    if (btnPronto) btnPronto.className = alvo === 'saiu' ? 'tab-btn active' : 'tab-btn';

    if (alvo === 'saiu') {
      setTimeout(() => {
        try { if (typeof window.renderPedidosDisponiveisSaiu === 'function') window.renderPedidosDisponiveisSaiu(); } catch(e) {}
        try { if (typeof window.renderRotas === 'function') window.renderRotas(); } catch(e) {}
        try {
          if (window.vescoRoutesV6) {
            window.vescoRoutesV6.ensureLayout();
            const m = window.vescoRoutesV6.ensureRouteMap();
            if (m) m.invalidateSize(true);
          }
        } catch(e) {}
      }, 250);
    }

    return result;
  };

  // Ao mandar pedido para envio, mantém backend como "Despachado"
  // e exibe o processo como "Pronto para Envio".
  const oldPrepararDespachoMotoristaV8 = window.prepararDespachoMotorista;
  window.prepararDespachoMotorista = function(numeroPedido){
    const info = typeof getOrderAndApi === 'function'
      ? getOrderAndApi(numeroPedido)
      : { order: v8FindOrder(numeroPedido), api: (typeof API !== 'undefined' ? API : '') };

    const realId = info.order ? (info.order.id || info.order.numero) : numeroPedido;

    if (info.order) {
      info.order.status_logistica = 'Despachado';
      info.order.situacao_nome = 'Pronto para Envio';
      info.order.data_despacho = new Date().toISOString();
      info.order.saiuParaEntregaEm = new Date().toISOString();
    }

    try { if (typeof rememberStatusTransition === 'function') rememberStatusTransition(numeroPedido, 'Pronto para Envio'); } catch(e) {}
    try { if (typeof syncGlobalOrderState === 'function') syncGlobalOrderState(); } catch(e) {}

    if (typeof showToast === 'function') showToast(`Pedido #${numeroPedido} pronto para envio!`, 'success', 4000);

    if (typeof switchTab === 'function') switchTab('motorista');
    if (typeof renderMotorista === 'function') renderMotorista();
    if (typeof render === 'function') render();

    if (!info.api || typeof jsonpFetch !== 'function') {
      if (typeof oldPrepararDespachoMotoristaV8 === 'function') return oldPrepararDespachoMotoristaV8.apply(this, arguments);
      return;
    }

    const url = `${info.api}?action=updateStatus&id=${encodeURIComponent(realId)}&status=${encodeURIComponent('Despachado')}&operador=${encodeURIComponent(currentOperator || '')}&observacao=${encodeURIComponent('Pronto para Envio')}`;
    jsonpFetch(url, function() {
      console.log('Pronto para Envio gravado. ID Real: ' + realId);
    });
  };

  // Reforça labels visuais antigos na tela sem alterar estrutura.
  function v8ReplaceOldLabels(){
    const root = document.body;
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => {
      const txt = node.nodeValue || '';
      let novo = txt;
      novo = novo.replaceAll('Saiu para entrega', 'Pronto para Envio');
      novo = novo.replaceAll('Saiu p/ entrega', 'Pronto p/ Envio');
      novo = novo.replaceAll('saiu para entrega', 'pronto para envio');
      if (novo !== txt) node.nodeValue = novo;
    });
  }

  const oldRenderV8 = window.render || (typeof render === 'function' ? render : null);
  if (oldRenderV8 && !window.__vescoRenderV8Wrapped) {
    window.__vescoRenderV8Wrapped = true;
    window.render = render = function(){
      const res = oldRenderV8.apply(this, arguments);
      setTimeout(v8ReplaceOldLabels, 50);
      setTimeout(() => { try { if (typeof renderMotorista === 'function') renderMotorista(); } catch(e) {} }, 80);
      return res;
    };
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(v8ReplaceOldLabels, 500);
    setTimeout(() => { try { if (typeof renderMotorista === 'function') renderMotorista(); } catch(e) {} }, 700);
  });

  window.vescoProntoParaEnvioV8 = {
    isProntoParaEnvioStatus: v8IsProntoParaEnvioStatus,
    findOrder: v8FindOrder,
    replaceLabels: v8ReplaceOldLabels
  };

  console.log('Compatibilidade V8 ativa — "Pronto para Envio" integrado ao legado "Saiu para entrega/Despachado".');
})();


// =================================================================
// CAMADA V9 — ENTREGUES À PROVA DE BACKEND/FILTRO + CAPTURA RAW DA API
// Regra de Preservação: camada aditiva; não remove V3/V4/V5/V6/V7/V8.
// Objetivo: se a planilha/backend devolver status Entregue em qualquer campo
// ou observação com "Entregue via / Recebido por", a aba Entregues renderiza.
// =================================================================
(function installVescoEntreguesBackendRawV9(){
  if (window.__vescoEntreguesBackendRawV9) return;
  window.__vescoEntreguesBackendRawV9 = true;

  const V9_CACHE_KEY = 'vesco_delivered_backend_v9';
  const V9_MAX_CACHE = 500;

  function v9Log(){ try { console.log.apply(console, arguments); } catch(e) {} }
  function v9Warn(){ try { console.warn.apply(console, arguments); } catch(e) {} }
  function v9Escape(v){
    try { return typeof escapeHtml === 'function' ? escapeHtml(v) : String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
    catch(e){ return String(v ?? ''); }
  }
  function v9Norm(v){
    const raw = String(v ?? '').trim();
    try { return typeof normalizeOrderNumber === 'function' ? normalizeOrderNumber(raw) : raw.replace(/^#/, '').replace(/\s+/g, '').replace(/[^0-9A-Za-z._-]/g,''); }
    catch(e){ return raw.replace(/^#/, '').replace(/\s+/g, '').replace(/[^0-9A-Za-z._-]/g,''); }
  }
  function v9NormText(v){
    return String(v || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  }
  function v9TodayISO(){
    try { if(typeof getBrazilTodayISO === 'function') return getBrazilTodayISO(); } catch(e) {}
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function v9TodayBR(){
    const iso = v9TodayISO();
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
  }
  function v9SelectedISO(){
    try { if(typeof getSelectedOperationalDateISO === 'function') return getSelectedOperationalDateISO(); } catch(e) {}
    return v9TodayISO();
  }
  function v9SameISO(a,b){ return !!a && !!b && String(a).slice(0,10) === String(b).slice(0,10); }
  function v9SelectedIsToday(){ return v9SameISO(v9SelectedISO(), v9TodayISO()); }
  function v9DateToISO(v){
    try { if(typeof dateValueToISO === 'function') { const iso = dateValueToISO(v); if(iso) return iso; } } catch(e) {}
    if(v === null || v === undefined) return '';
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if(m){ let y = m[3]; if(y.length === 2) y = '20' + y; return `${y.padStart(4,'0')}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`; }
    const d = new Date(s);
    if(!isNaN(d.getTime())) return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    return '';
  }
  function v9ReadArray(key){
    try { const parsed = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(parsed) ? parsed : []; } catch(e) { return []; }
  }
  function v9WriteArray(key, arr){
    try { localStorage.setItem(key, JSON.stringify((arr || []).slice(-V9_MAX_CACHE))); } catch(e) {}
  }
  function v9FindArrayInPayload(payload){
    if(!payload) return [];
    if(Array.isArray(payload)) return payload;
    if(typeof payload !== 'object') return [];
    const preferred = ['data','dados','items','pedidos','orders','rows','result','resultados'];
    for(const k of preferred){ if(Array.isArray(payload[k])) return payload[k]; }
    try {
      const queue = [payload];
      const seen = new Set();
      while(queue.length){
        const node = queue.shift();
        if(!node || typeof node !== 'object' || seen.has(node)) continue;
        seen.add(node);
        for(const k in node){
          if(!Object.prototype.hasOwnProperty.call(node,k)) continue;
          const v = node[k];
          if(Array.isArray(v)) return v;
          if(v && typeof v === 'object') queue.push(v);
        }
      }
    } catch(e) {}
    return [];
  }
  function v9NormalizeHeader(k){
    return String(k || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
  }
  function v9RowsToObjects(rows){
    if(!Array.isArray(rows)) return [];
    if(rows.length && Array.isArray(rows[0])){
      const headers = rows[0].map(h => String(h || '').trim());
      return rows.slice(1).map(row => {
        const obj = {};
        headers.forEach((h, i) => { obj[h || `col${i}`] = row[i]; });
        return obj;
      });
    }
    return rows.filter(x => x && typeof x === 'object');
  }
  function v9Pick(o, aliases){
    if(!o) return '';
    const desired = aliases.map(v9NormalizeHeader);
    for(const k in o){
      if(!Object.prototype.hasOwnProperty.call(o,k)) continue;
      const nk = v9NormalizeHeader(k);
      if(desired.includes(nk) && o[k] !== undefined && o[k] !== null && String(o[k]).trim() !== '') return o[k];
    }
    return '';
  }
  function v9NormalizeRecord(raw){
    if(!raw || typeof raw !== 'object') return null;
    let o = Object.assign({}, raw);
    try { if(typeof normalizeOrderObject === 'function') o = Object.assign({}, o, normalizeOrderObject(raw)); } catch(e) {}

    const numero = o.numero || v9Pick(raw, ['numero','pedido','pedido #','pedido#','id','order_id','orderNumber','numero_pedido','n_pedido']);
    const statusLog = o.status_logistica || v9Pick(raw, ['status_logistica','status logistica','status logística','situacao_logistica','situação logística','situacao','situação','status','status_entrega']);
    const obsLog = o.observacao_logistica || v9Pick(raw, ['observacao_logistica','observação logística','observacao logistica','observação logistica','observacao','observação','historico','histórico']);
    const cliente = o.cliente_nome || v9Pick(raw, ['cliente_nome','cliente','destinatario','destinatário','nome','cliente / destinatario','cliente destinatario','razao_social','razão social']);
    const endereco = o.endereco_completo || v9Pick(raw, ['endereco_completo','endereço completo','endereco','endereço','logradouro','address']);
    const formaPag = o.forma_pagamento || v9Pick(raw, ['forma_pagamento','forma pagamento','instrucao_entrega','instrução entrega']);
    const tempo = o.tempo_separacao || v9Pick(raw, ['tempo_separacao','tempo separacao','tempo separação','tempo_entrega','tempo']);

    o.numero = String(numero || o.id || '').trim();
    o.id = o.id || o.numero || v9Pick(raw, ['id']);
    o.status_logistica = String(statusLog || o.status_logistica || '').trim();
    o.situacao_nome = o.situacao_nome || o.status_logistica;
    o.observacao_logistica = String(obsLog || o.observacao_logistica || '').trim();
    o.cliente_nome = String(cliente || o.cliente_nome || '').trim();
    o.endereco_completo = String(endereco || o.endereco_completo || '').trim();
    o.forma_pagamento = String(formaPag || o.forma_pagamento || '').trim();
    o.tempo_separacao = String(tempo || o.tempo_separacao || '').trim();
    return o;
  }
  function v9AllText(o){
    return v9NormText([
      o && o.status_logistica, o && o.situacao_nome, o && o.situacao, o && o.status, o && o.status_entrega, o && o.status_rota,
      o && o.observacao_logistica, o && o.observacao, o && o.audit, o && o.historico, o && o.historico_status
    ].map(x => String(x || '')).join(' '));
  }
  function v9StatusOnly(o){ return v9NormText(o && (o.status_logistica || o.situacao_nome || o.situacao || o.status || o.status_entrega || o.status_rota)); }
  function v9IsDelivered(o){
    if(!o) return false;
    const status = v9StatusOnly(o);
    const all = v9AllText(o);
    const hasDelivered = /\bentregue\b|entregue via|recebido por|finalizad|concluid/.test(all);
    const currentIsPending = /\bpendente\b|a separar|em separa|pronto p\/? entrega|separado pendente/.test(status);
    if(currentIsPending && !/\bentregue\b|finaliz|conclu/.test(status)) return false;
    return hasDelivered;
  }
  function v9DeliveryISO(o){
    try { if(typeof getOrderDeliveryISO === 'function') { const iso = getOrderDeliveryISO(o); if(iso) return iso; } } catch(e) {}
    const fields = [
      'data_entrega_realizada','entregue_em','entregueEm','data_entregue','dataEntregue','dataEntrega','delivered_at','deliveredAt','concluidaEm','concluido_em','finalizado_em',
      'data_despacho','despachado_em','data_rota','saiu_em','saiuParaEntregaEm'
    ];
    for(const k of fields){ const iso = v9DateToISO(o && o[k]); if(iso) return iso; }
    const text = String((o && (o.observacao_logistica || o.observacao || o.audit || o.historico)) || '');
    try { if(typeof extractFirstDateLikeString === 'function') { const found = extractFirstDateLikeString(text); const iso = v9DateToISO(found); if(iso) return iso; } } catch(e) {}
    return '';
  }
  function v9CanShowByDate(o){
    const iso = v9DeliveryISO(o);
    if(iso) return v9SameISO(iso, v9SelectedISO());
    // Quando a planilha só traz status/observação de entregue, sem data de entrega,
    // mostra no dia atual. Para histórico perfeito, o Apps Script precisa enviar data_entregue.
    return v9SelectedIsToday();
  }
  function v9Receiver(o){
    let nome = o && (o.nome_recebedor || o.recebedor || o.recebido_por || '');
    let doc = o && (o.doc_recebedor || o.documento_recebedor || o.doc || '');
    const txt = String((o && (o.observacao_logistica || o.observacao || '')) || '');
    if(!nome){
      const m = txt.match(/Recebido por:\s*(.*?)\s*\(\s*Doc:\s*(.*?)\s*\)/i);
      if(m){ nome = (m[1] || '').trim(); doc = (m[2] || '').trim(); }
    }
    return { nome: nome || '—', doc: doc || '—' };
  }
  function v9Search(){
    const el = document.getElementById('search') || document.querySelector('input[placeholder*="Filtrar" i]');
    return String((el && el.value) || '').toLowerCase().trim();
  }
  function v9Matches(o, q){
    if(!q) return true;
    return [o.numero, o.id, o.pedido, o.numero_ecommerce, o.cliente_nome, o.cliente, o.destinatario, o.nome, o.endereco_completo, o.endereco, o.observacao_logistica]
      .some(v => String(v || '').toLowerCase().includes(q));
  }
  function v9MergeByKey(list){
    const map = new Map();
    list.forEach(raw => {
      const o = v9NormalizeRecord(raw);
      if(!o) return;
      const key = v9Norm(o.id || o.numero || o.pedido || o.numero_ecommerce || JSON.stringify(o).slice(0,60));
      if(!key) return;
      if(!map.has(key)) map.set(key, o);
      else {
        const old = map.get(key);
        // Entregue sempre vence sobre registros antigos do mesmo pedido.
        if(v9IsDelivered(o) || !v9IsDelivered(old)) map.set(key, Object.assign({}, old, o));
      }
    });
    return Array.from(map.values());
  }
  function v9CurrentPools(){
    const out = [];
    try { if(typeof orders !== 'undefined' && Array.isArray(orders)) out.push(...orders); } catch(e) {}
    try { if(Array.isArray(window.orders)) out.push(...window.orders); } catch(e) {}
    try { if(typeof flexOrders !== 'undefined' && Array.isArray(flexOrders)) out.push(...flexOrders); } catch(e) {}
    try { if(Array.isArray(window.flexOrders)) out.push(...window.flexOrders); } catch(e) {}
    try { if(Array.isArray(window.__vescoRawErpRowsV9)) out.push(...window.__vescoRawErpRowsV9); } catch(e) {}
    out.push(...v9ReadArray(V9_CACHE_KEY));
    out.push(...v9ReadArray('vesco_delivered_shadow_v6'));
    return v9MergeByKey(out);
  }
  function v9StoreDeliveredFromPayload(payload, sourceUrl){
    try {
      const rows = v9RowsToObjects(v9FindArrayInPayload(payload));
      if(!rows.length) return;
      window.__vescoRawErpRowsV9 = v9MergeByKey([...(window.__vescoRawErpRowsV9 || []), ...rows]);
      const delivered = v9MergeByKey(rows).filter(v9IsDelivered);
      if(delivered.length){
        const cache = v9MergeByKey([...v9ReadArray(V9_CACHE_KEY), ...delivered.map(o => {
          if(!v9DeliveryISO(o) && v9SelectedIsToday()) {
            o.data_entregue = o.data_entregue || v9TodayBR();
            o.data_entrega_realizada = o.data_entrega_realizada || v9TodayBR();
            o.entregue_em = o.entregue_em || new Date().toISOString();
          }
          return o;
        })]);
        v9WriteArray(V9_CACHE_KEY, cache);
      }
    } catch(e) { v9Warn('V9 falhou ao capturar entregues do payload:', e); }
  }

  // Captura a resposta bruta do Apps Script antes de qualquer filtro/render legado.
  try {
    const oldJsonpFetch = window.jsonpFetch || (typeof jsonpFetch === 'function' ? jsonpFetch : null);
    if(oldJsonpFetch && !window.__vescoJsonpFetchCapturedV9){
      window.__vescoJsonpFetchCapturedV9 = true;
      window.jsonpFetch = jsonpFetch = function(url, cb){
        return oldJsonpFetch.call(this, url, function(err, resp){
          try {
            const apiMain = typeof API !== 'undefined' ? String(API) : '';
            const urlStr = String(url || '');
            if(resp && (!apiMain || urlStr.includes(apiMain) || urlStr.includes('script.google.com/macros'))) {
              v9StoreDeliveredFromPayload(resp, urlStr);
            }
          } catch(e) {}
          if(typeof cb === 'function') return cb(err, resp);
        });
      };
    }
  } catch(e) { v9Warn('V9 não conseguiu envolver jsonpFetch:', e); }

  // Opcional: tenta consultar endpoints comuns de entregues. Se o Apps Script ignorar, não quebra.
  function v9TryFetchDeliveredAliases(){
    try {
      if(typeof jsonpFetch !== 'function' || typeof API === 'undefined') return;
      if(window.__vescoDeliveredAliasFetchV9Running) return;
      window.__vescoDeliveredAliasFetchV9Running = true;
      const urls = [
        `${API}?action=entregues`,
        `${API}?action=listEntregues`,
        `${API}?action=getEntregues`,
        `${API}?status=Entregue`
      ];
      let i = 0;
      const next = () => {
        if(i >= urls.length){ window.__vescoDeliveredAliasFetchV9Running = false; return; }
        const u = urls[i++];
        jsonpFetch(u, function(err, resp){
          try { if(resp) v9StoreDeliveredFromPayload(resp, u); } catch(e) {}
          setTimeout(next, 250);
        });
      };
      next();
    } catch(e) { window.__vescoDeliveredAliasFetchV9Running = false; }
  }

  function v9RenderDeliveredTable(){
    // V11: V9 continua coletando/cacheando dados, mas não disputa a renderização com V10/V11.
    if(window.__vescoEntreguesV10SafeDate) return;
    const tbody = document.getElementById('table-entregues');
    if(!tbody) return;

    const q = v9Search();
    const delivered = v9CurrentPools()
      .filter(v9IsDelivered)
      .filter(v9CanShowByDate)
      .filter(o => v9Matches(o, q));

    if(!delivered.length){
      tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-400 font-semibold">Nenhum despacho realizado.</td></tr>`;
      return;
    }

    tbody.innerHTML = delivered.map((o, idx) => {
      const id = o.id || o.numero || o.pedido || o.numero_ecommerce || '';
      const numero = o.numero || o.id || o.pedido || 'S/N';
      const cliente = o.cliente_nome || o.cliente || o.destinatario || o.nome || '—';
      const rec = v9Receiver(o);
      const tempo = o.tempo_separacao || o.tempo_entrega || o.tempo || '—';
      return `
        <tr class="${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} hover:bg-slate-100/70 text-xs md:text-sm">
          <td class="p-3 pl-4 font-black text-slate-900">#${v9Escape(numero)}</td>
          <td class="p-3 font-semibold text-slate-800">${v9Escape(cliente)}</td>
          <td class="p-3 hidden md:table-cell">
            <div class="font-bold text-slate-800 flex items-center gap-1.5"><i class="fas fa-user-check text-blue-500"></i>${v9Escape(rec.nome)}</div>
            <div class="text-[11px] text-slate-500 mt-0.5 font-mono"><i class="fas fa-id-card text-slate-400 mr-1"></i>Doc: ${v9Escape(rec.doc)}</div>
          </td>
          <td class="p-3 text-center text-emerald-700 font-mono font-bold">${v9Escape(tempo)}</td>
          <td class="p-3 pr-4 text-center">
            <div class="flex flex-col items-center gap-2">
              <span class="bg-emerald-50 text-emerald-700 font-bold border border-emerald-200 px-3 py-1 rounded-xl text-[10px] uppercase tracking-wider inline-flex items-center gap-1"><i class="fas fa-check-circle text-emerald-500"></i> Entregue</span>
              <button type="button" class="bg-amber-500 hover:bg-amber-600 text-white px-3 py-1 rounded-lg font-bold text-[11px] shadow-sm transition-all" onclick="window.vescoPendenciaEntregaV9 && window.vescoPendenciaEntregaV9('${v9Escape(id)}')"><i class="fas fa-triangle-exclamation mr-1"></i>Pendência</button>
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  window.vescoPendenciaEntregaV9 = function(id){
    if(!id) return;
    try { if(typeof window.vescoPendenciaEntregaV7 === 'function') return window.vescoPendenciaEntregaV7(id); } catch(e) {}
    try { if(typeof window.vescoPendenciaEntregaV6 === 'function') return window.vescoPendenciaEntregaV6(id); } catch(e) {}
    try { if(typeof window.moverParaPendenciaPrompt === 'function') return window.moverParaPendenciaPrompt(id); } catch(e) {}
    const motivo = prompt(`Informe a pendência do pedido #${id}:`);
    if(!motivo) return;
    try { if(typeof updateStatusJsonp === 'function') updateStatusJsonp(id, 'Pendente', `[Pós-entrega] ${motivo}`); } catch(e) {}
    setTimeout(v9RenderDeliveredTable, 250);
  };

  try {
    window.shouldShowDeliveredForOperationalDate = shouldShowDeliveredForOperationalDate = function(o){
      return v9IsDelivered(o) && v9CanShowByDate(o);
    };
  } catch(e) {}

  const prevRenderV9 = typeof render === 'function' ? render : null;
  if(prevRenderV9 && !window.__vescoRenderEntreguesV9Wrapped){
    window.__vescoRenderEntreguesV9Wrapped = true;
    render = function(){
      const ret = prevRenderV9.apply(this, arguments);
      setTimeout(v9RenderDeliveredTable, 20);
      return ret;
    };
    window.render = render;
  }

  const prevSwitchTabV9 = window.switchTab;
  if(typeof prevSwitchTabV9 === 'function' && !window.__vescoSwitchTabEntreguesV9Wrapped){
    window.__vescoSwitchTabEntreguesV9Wrapped = true;
    window.switchTab = function(which){
      const ret = prevSwitchTabV9.apply(this, arguments);
      if(which === 'entregues' && !window.__vescoEntreguesV10SafeDate) {
        v9TryFetchDeliveredAliases();
        setTimeout(v9RenderDeliveredTable, 80);
        setTimeout(v9RenderDeliveredTable, 900);
      }
      return ret;
    };
  }

  const prevScheduleRenderV9 = typeof scheduleRender === 'function' ? scheduleRender : null;
  if(prevScheduleRenderV9 && !window.__vescoScheduleRenderV9Wrapped){
    window.__vescoScheduleRenderV9Wrapped = true;
    scheduleRender = function(){
      const ret = prevScheduleRenderV9.apply(this, arguments);
      setTimeout(v9RenderDeliveredTable, 120);
      return ret;
    };
    window.scheduleRender = scheduleRender;
  }

  document.addEventListener('DOMContentLoaded', function(){
    setTimeout(v9RenderDeliveredTable, 1000);
    try {
      const obs = new MutationObserver(() => {
        if(document.getElementById('table-entregues')) setTimeout(v9RenderDeliveredTable, 40);
      });
      obs.observe(document.body, { childList: true, subtree: true });
    } catch(e) {}
  });

  window.vescoEntreguesV9 = {
    render: v9RenderDeliveredTable,
    collect: function(){ return v9CurrentPools().filter(v9IsDelivered).filter(v9CanShowByDate); },
    allDelivered: function(){ return v9CurrentPools().filter(v9IsDelivered); },
    cache: function(){ return v9ReadArray(V9_CACHE_KEY); },
    tryFetchDeliveredAliases: v9TryFetchDeliveredAliases,
    debug: function(){
      const all = v9CurrentPools();
      const delivered = all.filter(v9IsDelivered);
      return { totalPools: all.length, delivered: delivered.length, shown: delivered.filter(v9CanShowByDate).length, selectedISO: v9SelectedISO(), todayISO: v9TodayISO(), sampleDelivered: delivered.slice(0,5) };
    }
  };

  v9Log('Entregues V9 ativo — captura payload bruto da API e renderiza Entregue vindo da planilha/backend.');
})();

// =================================================================
// CAMADA V10 — CORREÇÃO FINAL ENTREGUES: DOCUMENTO NÃO É DATA
// Problema encontrado: o V9 capturou 1 pedido entregue, mas mostrou 0 porque
// a observação "Doc: 594516..." podia ser interpretada como data/timestamp.
// Regra de Preservação: esta camada não remove V9; apenas renderiza Entregues
// com filtro de data seguro e explícito.
// =================================================================
(function installVescoEntreguesV10SafeDate(){
  if (window.__vescoEntreguesV10SafeDate) return;
  window.__vescoEntreguesV10SafeDate = true;

  const V10_CACHE_KEY = 'vesco_delivered_cache_v10_safe_date';

  function log(){ try { console.log.apply(console, arguments); } catch(e) {} }
  function warn(){ try { console.warn.apply(console, arguments); } catch(e) {} }
  function esc(v){
    try { return typeof escapeHtml === 'function' ? escapeHtml(v) : String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
    catch(e){ return String(v ?? ''); }
  }
  function normText(v){
    return String(v || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }
  function todayISO(){
    try { if(typeof getBrazilTodayISO === 'function') return getBrazilTodayISO(); } catch(e) {}
    const d = new Date();
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0,10);
  }
  function selectedISO(){
    try { if(typeof getSelectedOperationalDateISO === 'function') return getSelectedOperationalDateISO(); } catch(e) {}
    return todayISO();
  }
  function sameISO(a,b){ return !!a && !!b && String(a).slice(0,10) === String(b).slice(0,10); }
  function isTodaySelected(){ return sameISO(selectedISO(), todayISO()); }
  function brToday(){
    try { if(typeof isoToBRDate === 'function') return isoToBRDate(todayISO()); } catch(e) {}
    const [y,m,d] = todayISO().split('-');
    return `${d}/${m}/${y}`;
  }
  function dateToISO(v){
    if(v === null || v === undefined || String(v).trim() === '') return '';
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if(m){
      let y = m[3];
      if(y.length === 2) y = '20' + y;
      return `${String(y).padStart(4,'0')}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
    }
    return '';
  }
  function readArray(key){ try { return JSON.parse(localStorage.getItem(key) || '[]') || []; } catch(e) { return []; } }
  function writeArray(key, arr){ try { localStorage.setItem(key, JSON.stringify(arr || [])); } catch(e) {} }
  function normKey(v){
    try { if(typeof normalizeOrderNumber === 'function') return normalizeOrderNumber(v); } catch(e) {}
    return String(v || '').replace(/^#/,'').replace(/\s+/g,'').trim();
  }
  function mergeByKey(list){
    const map = new Map();
    (list || []).forEach(o => {
      if(!o || typeof o !== 'object') return;
      const key = normKey(o.id || o.numero || o.pedido || o.numero_ecommerce || JSON.stringify(o).slice(0,60));
      if(!key) return;
      if(!map.has(key)) map.set(key, o);
      else map.set(key, Object.assign({}, map.get(key), o));
    });
    return Array.from(map.values());
  }
  function allPools(){
    const out = [];
    try { if(typeof orders !== 'undefined' && Array.isArray(orders)) out.push(...orders); } catch(e) {}
    try { if(Array.isArray(window.orders)) out.push(...window.orders); } catch(e) {}
    try { if(typeof flexOrders !== 'undefined' && Array.isArray(flexOrders)) out.push(...flexOrders); } catch(e) {}
    try { if(Array.isArray(window.flexOrders)) out.push(...window.flexOrders); } catch(e) {}
    try { if(Array.isArray(window.__vescoRawErpRowsV9)) out.push(...window.__vescoRawErpRowsV9); } catch(e) {}
    try { if(window.vescoEntreguesV9 && typeof window.vescoEntreguesV9.allDelivered === 'function') out.push(...window.vescoEntreguesV9.allDelivered()); } catch(e) {}
    out.push(...readArray('vesco_delivered_cache_v9'));
    out.push(...readArray('vesco_delivered_shadow_v6'));
    out.push(...readArray(V10_CACHE_KEY));
    return mergeByKey(out);
  }
  function isDelivered(o){
    if(!o) return false;
    const status = normText(o.status_logistica || o.situacao_nome || o.situacao || o.status || o.status_entrega || o.status_rota);
    const obs = normText(o.observacao_logistica || o.observacao || o.audit || o.historico || '');
    const all = `${status} ${obs}`;
    const delivered = /\bentregue\b|entregue via|recebido por|finalizad|concluid/.test(all);
    const pendingStatus = /\bpendente\b|a separar|em separa/.test(status);
    if(pendingStatus && !/\bentregue\b|finaliz|conclu/.test(status)) return false;
    return delivered;
  }
  function explicitDeliveryISO(o){
    if(!o) return '';
    const fields = [
      'data_entrega_realizada','entregue_em','entregueEm','data_entregue','dataEntregue',
      'dataEntrega','delivered_at','deliveredAt','concluidaEm','concluido_em','finalizado_em'
    ];
    for(const k of fields){
      const iso = dateToISO(o[k]);
      if(iso) return iso;
    }

    // Só aceita data textual explícita com barra/hífen. Não aceita número solto,
    // porque documentos/CPF/RG podem virar timestamp/serial por engano.
    const text = String(o.observacao_logistica || o.observacao || o.audit || o.historico || '');
    const br = text.match(/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/);
    if(br) return dateToISO(br[1]);
    const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if(iso) return dateToISO(iso[1]);
    return '';
  }
  function canShowByDate(o){
    const iso = explicitDeliveryISO(o);
    if(iso) return sameISO(iso, selectedISO());
    // Sem data explícita no backend: se o pedido está entregue e a data selecionada
    // é hoje, mostra. É exatamente o caso da sua planilha atual.
    return isTodaySelected();
  }
  function receiver(o){
    let nome = o && (o.nome_recebedor || o.recebedor || o.recebido_por || '');
    let doc = o && (o.doc_recebedor || o.documento_recebedor || o.doc || '');
    const txt = String((o && (o.observacao_logistica || o.observacao || '')) || '');
    if(!nome){
      const m = txt.match(/Recebido por:\s*(.*?)\s*\(\s*Doc:\s*(.*?)\s*\)/i);
      if(m){ nome = (m[1] || '').trim(); doc = (m[2] || '').trim(); }
    }
    return { nome: nome || '—', doc: doc || '—' };
  }
  function searchValue(){
    const el = document.getElementById('search') || document.querySelector('input[placeholder*="Filtrar" i]');
    return String((el && el.value) || '').toLowerCase().trim();
  }
  function matchesSearch(o, q){
    if(!q) return true;
    return [o.numero, o.id, o.pedido, o.numero_ecommerce, o.cliente_nome, o.cliente, o.destinatario, o.nome, o.endereco_completo, o.endereco, o.observacao_logistica]
      .some(v => String(v || '').toLowerCase().includes(q));
  }
  function normalizeDeliveredForCache(o){
    if(!o || typeof o !== 'object') return null;
    const out = Object.assign({}, o);
    out.status_logistica = 'Entregue';
    out.situacao_nome = 'Entregue';
    if(!explicitDeliveryISO(out) && isTodaySelected()) {
      out.data_entregue = out.data_entregue || brToday();
      out.data_entrega_realizada = out.data_entrega_realizada || brToday();
      out.entregue_em = out.entregue_em || new Date().toISOString();
    }
    return out;
  }
  function saveCurrentDeliveredToV10Cache(){
    const delivered = allPools().filter(isDelivered);
    if(!delivered.length) return;
    const cache = mergeByKey([...readArray(V10_CACHE_KEY), ...delivered.map(normalizeDeliveredForCache).filter(Boolean)]);
    writeArray(V10_CACHE_KEY, cache.slice(-500));
  }
  function deliveredShown(){
    saveCurrentDeliveredToV10Cache();
    const q = searchValue();
    return allPools().filter(isDelivered).filter(canShowByDate).filter(o => matchesSearch(o, q));
  }
  let v10RenderPending = false;
  let v10LastHtml = '';
  function renderDeliveredTable(){
    const tbody = document.getElementById('table-entregues');
    if(!tbody) return;
    if(v10RenderPending) return;
    v10RenderPending = true;
    setTimeout(() => { v10RenderPending = false; }, 120);
    const delivered = deliveredShown();
    if(!delivered.length){
      const emptyHtml = `<tr><td colspan="5" class="p-4 text-center text-slate-400 font-semibold">Nenhum despacho realizado.</td></tr>`;
      if(v10LastHtml !== emptyHtml){
        v10LastHtml = emptyHtml;
        tbody.innerHTML = emptyHtml;
      }
      return;
    }
    const html = delivered.map((o, idx) => {
      const id = o.id || o.numero || o.pedido || o.numero_ecommerce || '';
      const numero = o.numero || o.id || o.pedido || 'S/N';
      const cliente = o.cliente_nome || o.cliente || o.destinatario || o.nome || '—';
      const rec = receiver(o);
      const tempo = o.tempo_separacao || o.tempo_entrega || o.tempo || '—';
      return `
        <tr class="${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} hover:bg-slate-100/70 text-xs md:text-sm">
          <td class="p-3 pl-4 font-black text-slate-900">#${esc(numero)}</td>
          <td class="p-3 font-semibold text-slate-800">${esc(cliente)}</td>
          <td class="p-3 hidden md:table-cell">
            <div class="font-bold text-slate-800 flex items-center gap-1.5"><i class="fas fa-user-check text-blue-500"></i>${esc(rec.nome)}</div>
            <div class="text-[11px] text-slate-500 mt-0.5 font-mono"><i class="fas fa-id-card text-slate-400 mr-1"></i>Doc: ${esc(rec.doc)}</div>
          </td>
          <td class="p-3 text-center text-emerald-700 font-mono font-bold">${esc(tempo)}</td>
          <td class="p-3 pr-4 text-center">
            <div class="flex flex-col items-center gap-2">
              <span class="bg-emerald-50 text-emerald-700 font-bold border border-emerald-200 px-3 py-1 rounded-xl text-[10px] uppercase tracking-wider inline-flex items-center gap-1"><i class="fas fa-check-circle text-emerald-500"></i> Entregue</span>
              <button type="button" class="vesco-entregue-pendencia-btn-v10-main bg-amber-500 hover:bg-amber-600 text-white px-3 py-1 rounded-lg font-bold text-[11px] shadow-sm transition-all" onclick="window.vescoPendenciaEntregaV10 && window.vescoPendenciaEntregaV10('${esc(id)}')"><i class="fas fa-triangle-exclamation mr-1"></i>Pendência</button>
            </div>
          </td>
        </tr>`;
    }).join('');
    if(v10LastHtml !== html){
      v10LastHtml = html;
      tbody.innerHTML = html;
    }
    try { window.__vescoEntreguesV10LastCount = delivered.length; } catch(e) {}
  }

  window.vescoPendenciaEntregaV10 = function(id){
    if(!id) return;
    try { if(typeof window.vescoPendenciaEntregaV9 === 'function') return window.vescoPendenciaEntregaV9(id); } catch(e) {}
    try { if(typeof window.moverParaPendenciaPrompt === 'function') return window.moverParaPendenciaPrompt(id); } catch(e) {}
    const motivo = prompt(`Informe a pendência do pedido #${id}:`);
    if(!motivo) return;
    try { if(typeof updateStatusJsonp === 'function') updateStatusJsonp(id, 'Pendente', `[Pós-entrega] ${motivo}`); } catch(e) {}
    setTimeout(renderDeliveredTable, 250);
  };

  try {
    window.shouldShowDeliveredForOperationalDate = shouldShowDeliveredForOperationalDate = function(o){
      return isDelivered(o) && canShowByDate(o);
    };
  } catch(e) {}

  const prevRender = typeof render === 'function' ? render : null;
  if(prevRender && !window.__vescoRenderEntreguesV10Wrapped){
    window.__vescoRenderEntreguesV10Wrapped = true;
    render = function(){
      const ret = prevRender.apply(this, arguments);
      setTimeout(renderDeliveredTable, 40);
      return ret;
    };
    window.render = render;
  }

  const prevSwitchTab = window.switchTab;
  if(typeof prevSwitchTab === 'function' && !window.__vescoSwitchTabEntreguesV10Wrapped){
    window.__vescoSwitchTabEntreguesV10Wrapped = true;
    window.switchTab = function(which){
      const ret = prevSwitchTab.apply(this, arguments);
      if(which === 'entregues') {
        // V11: alias fetch desativado por performance. O payload principal e o cache já alimentam Entregues.
        setTimeout(renderDeliveredTable, 80);
        setTimeout(renderDeliveredTable, 900);
      }
      return ret;
    };
  }

  const prevScheduleRender = typeof scheduleRender === 'function' ? scheduleRender : null;
  if(prevScheduleRender && !window.__vescoScheduleRenderV10Wrapped){
    window.__vescoScheduleRenderV10Wrapped = true;
    scheduleRender = function(){
      const ret = prevScheduleRender.apply(this, arguments);
      setTimeout(renderDeliveredTable, 160);
      return ret;
    };
    window.scheduleRender = scheduleRender;
  }

  document.addEventListener('DOMContentLoaded', function(){
    setTimeout(renderDeliveredTable, 1000);
    // V11: removido o MutationObserver em body inteiro porque ele reacionava à própria tabela,
    // criando loop de renderização. Atualizações continuam via render(), scheduleRender() e troca de aba.
  });

  window.vescoEntreguesV10 = {
    render: renderDeliveredTable,
    allDelivered: function(){ return allPools().filter(isDelivered); },
    shown: deliveredShown,
    cache: function(){ return readArray(V10_CACHE_KEY); },
    clearCache: function(){ writeArray(V10_CACHE_KEY, []); },
    debug: function(){
      const delivered = allPools().filter(isDelivered);
      return {
        totalPools: allPools().length,
        delivered: delivered.length,
        shown: delivered.filter(canShowByDate).length,
        selectedISO: selectedISO(),
        todayISO: todayISO(),
        sampleDelivered: delivered.slice(0,5).map(o => ({
          numero: o.numero || o.id,
          status: o.status_logistica || o.situacao_nome || o.status,
          explicitDeliveryISO: explicitDeliveryISO(o),
          canShow: canShowByDate(o),
          obs: o.observacao_logistica || o.observacao || ''
        }))
      };
    }
  };

  log('Entregues V10 ativo — corrige filtro de data e ignora documento como data.');
})();


// =================================================================
// CAMADA V11 — PERFORMANCE / ANTI-LOOP / ENTREGUES ESTÁVEL
// Preserva as camadas anteriores, mas impede disputa de renderização,
// duplicidade de botões e geocodificação em massa fora das abas de mapa.
// =================================================================
(function installVescoPerformanceAntiLoopV11(){
  if(window.__vescoPerformanceAntiLoopV11) return;
  window.__vescoPerformanceAntiLoopV11 = true;

  function log(){ try { console.log.apply(console, arguments); } catch(e) {} }

  function ensureStyle(){
    if(document.getElementById('vesco-v11-performance-style')) return;
    const st = document.createElement('style');
    st.id = 'vesco-v11-performance-style';
    st.textContent = `
      #table-entregues .vesco-entregue-pendencia-btn,
      #table-entregues .vesco-entregue-pendencia-btn-v5,
      #table-entregues .vesco-entregue-pendencia-btn-v6-final{
        display:none!important;
      }
      #table-entregues .vesco-entregue-pendencia-btn-v10-main{
        display:inline-flex!important;
      }
    `;
    document.head.appendChild(st);
  }

  function isVisible(el){
    if(!el) return false;
    const cs = window.getComputedStyle ? window.getComputedStyle(el) : null;
    if(cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  function currentMainTab(){
    const active = document.querySelector('.tab-btn.active, [id^="main-"].active');
    return active ? String(active.id || active.textContent || '').toLowerCase() : '';
  }

  function isMapTabActive(){
    const tab = currentMainTab();
    const logistica = document.getElementById('view-logistica');
    const flex = document.getElementById('view-envios_flex');
    return (tab.includes('log') && isVisible(logistica)) || (tab.includes('flex') && isVisible(flex));
  }

  try {
    const oldPlot = window.plotMapMarkers || (typeof plotMapMarkers === 'function' ? plotMapMarkers : null);
    if(oldPlot && !window.__vescoPlotMapMarkersV11Wrapped){
      window.__vescoPlotMapMarkersV11Wrapped = true;
      window.plotMapMarkers = plotMapMarkers = function(orderList, flexList){
        if(!isMapTabActive()) return;
        return oldPlot.apply(this, arguments);
      };
    }
  } catch(e) {}

  // Failsafe: se algum callback externo travar a tela de loading, destrava sem afetar os dados já carregados.
  function hideStuckLoading(){
    try {
      const el = document.getElementById('loadingOverlay') || document.getElementById('loading-overlay');
      if(el && isVisible(el)) {
        if(typeof showLoading === 'function') showLoading(false);
        else el.style.display = 'none';
      }
    } catch(e) {}
  }

  // Reduz buscas extras de entregues por aliases, que estavam gerando JSONP/script error e lentidão.
  try {
    if(window.vescoEntreguesV9) window.vescoEntreguesV9.tryFetchDeliveredAliases = function(){ return null; };
  } catch(e) {}

  // Remove duplicados já existentes na tabela após renderizações antigas.
  function cleanDeliveredDuplicates(){
    const tbody = document.getElementById('table-entregues');
    if(!tbody) return;
    tbody.querySelectorAll('.vesco-entregue-pendencia-btn, .vesco-entregue-pendencia-btn-v5, .vesco-entregue-pendencia-btn-v6-final').forEach(btn => {
      const wrap = btn.closest('.mt-2') || btn.parentElement;
      if(wrap && wrap.querySelectorAll('button').length === 1) wrap.remove();
      else btn.remove();
    });
  }

  const oldRender = window.render || (typeof render === 'function' ? render : null);
  if(oldRender && !window.__vescoRenderV11Wrapped){
    window.__vescoRenderV11Wrapped = true;
    window.render = render = function(){
      const ret = oldRender.apply(this, arguments);
      setTimeout(cleanDeliveredDuplicates, 120);
      setTimeout(hideStuckLoading, 1800);
      return ret;
    };
  }

  const oldSwitch = window.switchTab;
  if(typeof oldSwitch === 'function' && !window.__vescoSwitchV11Wrapped){
    window.__vescoSwitchV11Wrapped = true;
    window.switchTab = function(which){
      const ret = oldSwitch.apply(this, arguments);
      setTimeout(cleanDeliveredDuplicates, 160);
      setTimeout(hideStuckLoading, 1800);
      return ret;
    };
  }

  if(document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){
      ensureStyle();
      setTimeout(cleanDeliveredDuplicates, 700);
      setTimeout(hideStuckLoading, 2500);
    });
  } else {
    ensureStyle();
    setTimeout(cleanDeliveredDuplicates, 700);
    setTimeout(hideStuckLoading, 2500);
  }

  window.vescoPerformanceV11 = {
    cleanDeliveredDuplicates,
    hideStuckLoading,
    isMapTabActive
  };

  log('Performance V11 ativa — anti-loop em Entregues, sem botões duplicados e geocoding fora do mapa bloqueado.');
})();

// =================================================================
// CAMADA V12 — ROTAS ESTÁVEIS + ORIGEM REAL + PENDÊNCIA EM ENTREGUES
// Regra de Preservação: camada aditiva; não remove legado. Ela assume
// a liderança apenas nos pontos quebrados: mapa de rota, geocoding em
// massa e botão Pendência na aba Entregues.
// =================================================================
(function installVescoRoutesPendenciaV12(){
  if(window.__vescoRoutesPendenciaV12) return;
  window.__vescoRoutesPendenciaV12 = true;

  const GEO_CACHE_KEY = 'vesco_route_geocode_cache_v12';
  const ROUTES_KEY = 'vesco_saiu_rotas_v1';
  const ORIGIN_KEY = 'vesco_route_origin_v6';
  const DEFAULT_CENTER = [-23.55052, -46.633308];
  let routeMap = null;
  let routeLayer = null;
  let lastRouteSignature = '';
  let lastDeliveredButtonSignature = '';

  function log(){ try { console.log.apply(console, arguments); } catch(e) {} }
  function warn(){ try { console.warn.apply(console, arguments); } catch(e) {} }
  function esc(v){
    try { return typeof escapeHtml === 'function' ? escapeHtml(v) : String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
    catch(e){ return String(v ?? ''); }
  }
  function toast(msg, type = 'info', ms = 3500){
    try { if(typeof showToast === 'function') return showToast(msg, type, ms); } catch(e) {}
    try { console.log(msg); } catch(e) {}
  }
  function norm(v){
    try { return typeof normalizeOrderNumber === 'function' ? normalizeOrderNumber(v) : String(v ?? '').replace(/^#/, '').trim(); }
    catch(e){ return String(v ?? '').replace(/^#/, '').trim(); }
  }
  function cleanAddress(v){
    return String(v || '')
      .replace(/\s+/g, ' ')
      .replace(/\|/g, ',')
      .replace(/\bSao\b/gi, 'São')
      .trim();
  }
  function readJSON(key, fallback){
    try { return JSON.parse(localStorage.getItem(key) || '') || fallback; } catch(e) { return fallback; }
  }
  function writeJSON(key, value){
    try { localStorage.setItem(key, JSON.stringify(value)); } catch(e) {}
  }
  function isVisible(el){
    if(!el) return false;
    const cs = window.getComputedStyle ? window.getComputedStyle(el) : null;
    if(cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }
  function activeTabText(){
    const candidates = Array.from(document.querySelectorAll('.tab-btn.active, [id^="main-"].active, nav .active, button.active'));
    return candidates.map(el => `${el.id || ''} ${el.textContent || ''}`).join(' ').toLowerCase();
  }
  function isLogisticaOrFlexActive(){
    const txt = activeTabText();
    return /log[ií]stica/.test(txt) || /envios\s*flex/.test(txt) || /main-log|main-flex/.test(txt);
  }
  function isRouteViewActive(){
    const txt = activeTabText();
    const routeRoot = document.querySelector('#view-saiu:not(.hidden), #view-rotas:not(.hidden), #view-pronto-envio:not(.hidden), #view-pronto_envio:not(.hidden), #view-pronto_para_envio:not(.hidden)');
    return !!routeRoot || /pronto\s+para\s+envio|montar\s+rotas|main-rotas|main-saiu|main-pronto/.test(txt);
  }

  // Bloqueio forte da geocodificação em massa fora das abas corretas.
  try {
    const oldPlot = window.plotMapMarkers || (typeof plotMapMarkers === 'function' ? plotMapMarkers : null);
    if(oldPlot && !window.__vescoPlotMapMarkersV12Wrapped){
      window.__vescoPlotMapMarkersV12Wrapped = true;
      window.plotMapMarkers = plotMapMarkers = function(orderList, flexList){
        if(!isLogisticaOrFlexActive()) return;
        return oldPlot.apply(this, arguments);
      };
    }
    if(Array.isArray(window.geocodeQueue)) window.geocodeQueue.length = 0;
    try { if(typeof geocodeQueue !== 'undefined' && Array.isArray(geocodeQueue)) geocodeQueue.length = 0; } catch(e) {}
  } catch(e) { warn('V12 não conseguiu bloquear geocoding em massa:', e); }

  function allOrders(){
    const pools = [];
    try { if(Array.isArray(orders)) pools.push(...orders); } catch(e) {}
    try { if(Array.isArray(flexOrders)) pools.push(...flexOrders); } catch(e) {}
    if(Array.isArray(window.orders)) pools.push(...window.orders);
    if(Array.isArray(window.flexOrders)) pools.push(...window.flexOrders);
    const seen = new Set();
    return pools.filter(o => {
      if(!o) return false;
      const k = String(o.id || o.numero || o.pedido || Math.random());
      if(seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  function orderKeys(o){
    if(!o) return [];
    const vals = [o.id, o.numero, o.pedido, o.order_id, o.orderNumber, o.reference, o.referencia, o.numero_ecommerce, o.numero_ecom, o.codigo_externo, o.codigo];
    const keys = [];
    vals.forEach(v => {
      if(v === undefined || v === null || String(v).trim() === '') return;
      const raw = String(v).trim();
      keys.push(raw, norm(raw), raw.replace(/\D/g,''));
    });
    return Array.from(new Set(keys.filter(Boolean)));
  }
  function findOrder(id){
    const raw = String(id || '').trim();
    const n = norm(raw);
    const digits = raw.replace(/\D/g,'');
    return allOrders().find(o => {
      const keys = orderKeys(o);
      return keys.includes(raw) || keys.includes(n) || (digits && keys.includes(digits));
    }) || null;
  }
  function orderAddress(o){ return cleanAddress(o && (o.endereco_completo || o.endereco || o.address || o.full_address || o.logradouro || '')); }
  function orderClient(o){
    try { return extractClientNameFromAny(o) || o.cliente_nome || o.cliente || o.destinatario || o.nome || ''; }
    catch(e) { return o && (o.cliente_nome || o.cliente || o.destinatario || o.nome) || ''; }
  }
  function directCoords(o){
    try {
      const c = typeof getCoords === 'function' ? getCoords(o) : null;
      if(c && Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lon))) return { lat:Number(c.lat), lon:Number(c.lon) };
    } catch(e) {}
    return null;
  }
  function markerCoords(key){
    try {
      const m = (typeof findMainMarkerByKey === 'function' && findMainMarkerByKey(key)) ||
                (typeof findFlexMarkerByKey === 'function' && findFlexMarkerByKey(key));
      if(m && typeof m.getLatLng === 'function') {
        const ll = m.getLatLng();
        if(ll && Number.isFinite(Number(ll.lat)) && Number.isFinite(Number(ll.lng))) return { lat:Number(ll.lat), lon:Number(ll.lng) };
      }
    } catch(e) {}
    return null;
  }
  function routeRoot(){
    const selectors = ['#view-saiu:not(.hidden)', '#view-rotas:not(.hidden)', '#view-pronto-envio:not(.hidden)', '#view-pronto_envio:not(.hidden)', '#view-pronto_para_envio:not(.hidden)', '#view-saiu', '#view-rotas'];
    for(const sel of selectors){ const el = document.querySelector(sel); if(el) return el; }
    return document.body;
  }
  function installStyle(){
    if(document.getElementById('vesco-v12-style')) return;
    const st = document.createElement('style');
    st.id = 'vesco-v12-style';
    st.textContent = `
      #table-entregues .vesco-entregue-pendencia-btn-v12{display:inline-flex!important;align-items:center;justify-content:center;gap:4px;}
      #vesco-route-map-v12{height:calc(100vh - 250px);min-height:390px;width:100%;border-radius:12px;overflow:hidden;background:#eef2f7;}
      #vesco-route-panel-v12{border:1px solid #dbe5f1;background:#fff;border-radius:14px;padding:10px;box-shadow:0 8px 22px rgba(15,23,42,.06);margin-top:10px;}
      #vesco-route-info-v12{margin-bottom:12px;padding:12px;border:1px solid #bfdbfe;background:#eff6ff;border-radius:14px;font-size:12px;color:#334155;}
      .vesco-route-origin-warning-v12{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:10px;padding:8px;font-size:11px;font-weight:700;margin-top:6px;}
      @media(max-width:1024px){#vesco-route-map-v12{height:360px;min-height:360px;}}
    `;
    document.head.appendChild(st);
  }
  function ensureOriginField(){
    const root = routeRoot();
    let input = document.getElementById('vesco-rota-origem-v6') || document.getElementById('vesco-rota-origem-v12') || document.getElementById('rotaOrigem') || document.getElementById('pontoPartidaRota');
    if(input) return input;
    const saved = localStorage.getItem(ORIGIN_KEY) || '';
    const wrap = document.createElement('div');
    wrap.className = 'vesco-rota-origem-v12 mb-3';
    wrap.innerHTML = `
      <label class="block text-xs font-black text-slate-700 mb-1">Ponto de partida da rota</label>
      <input id="vesco-rota-origem-v12" type="text" value="${esc(saved)}" placeholder="Ex: Rua Conselheiro Dantas, 141 - Brás, São Paulo - SP" class="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm outline-none focus:border-blue-500 w-full" />
      <div class="text-[10px] text-slate-400 mt-1">Informe um endereço real da saída. Nome de rota não serve como ponto de partida.</div>`;
    const anchor = root.querySelector('#rotaMotorista, #motoristaRota, #routeDriver, #rotaNome, #nomeRota, #saiu-pedidos-list') || root.firstElementChild;
    if(anchor && anchor.parentElement) anchor.parentElement.insertBefore(wrap, anchor.nextSibling);
    else root.prepend(wrap);
    input = wrap.querySelector('input');
    input.addEventListener('input', () => localStorage.setItem(ORIGIN_KEY, cleanAddress(input.value)));
    return input;
  }
  function getOrigin(){
    const input = ensureOriginField();
    const value = cleanAddress((input && input.value) || localStorage.getItem(ORIGIN_KEY) || '');
    if(value) localStorage.setItem(ORIGIN_KEY, value);
    return value;
  }
  function looksLikeAddress(v){
    const s = cleanAddress(v).toLowerCase();
    if(!s) return false;
    if(/^-?\d{1,2}\.\d+\s*,\s*-?\d{1,3}\.\d+$/.test(s)) return true;
    const hasStreet = /(rua|r\.|avenida|av\.|alameda|travessa|estrada|rodovia|pra[cç]a|largo|via)\b/.test(s);
    const hasNumber = /\b\d{1,6}[a-z]?\b/.test(s);
    const hasCity = /(s[aã]o paulo|sp|barueri|osasco|guarulhos|santo andr[eé]|cotia|diadema|tabo[aã]o|carapicu[ií]ba|maua|mau[aá])/.test(s);
    return (hasStreet && hasNumber) || (hasStreet && hasCity) || (hasNumber && hasCity);
  }
  function ensureMapPanel(){
    installStyle();
    const root = routeRoot();
    let panel = document.getElementById('vesco-route-panel-v12');
    if(!panel){
      panel = document.createElement('div');
      panel.id = 'vesco-route-panel-v12';
      panel.innerHTML = `
        <div id="vesco-route-info-v12">
          <div class="font-black text-blue-800 mb-1"><i class="fas fa-route mr-1"></i>Planejamento da rota</div>
          <div class="text-slate-600">Informe um endereço real de partida, selecione os pedidos e trace a rota.</div>
        </div>
        <div class="flex items-center justify-between mb-2">
          <div class="text-[11px] font-black text-slate-500 uppercase">Mapa da rota</div>
          <div class="text-[10px] font-bold text-blue-600 uppercase">Partida + entregas</div>
        </div>
        <div id="vesco-route-map-v12"></div>`;
      const oldRight = document.getElementById('vesco-saiu-right-v6');
      if(oldRight) oldRight.appendChild(panel);
      else root.appendChild(panel);
    }
    return panel;
  }
  function ensureRouteMap(){
    ensureMapPanel();
    if(typeof L === 'undefined') return null;
    const el = document.getElementById('vesco-route-map-v12');
    if(!el) return null;
    if(routeMap && routeMap._container === el){
      setTimeout(() => { try { routeMap.invalidateSize(true); } catch(e) {} }, 80);
      return routeMap;
    }
    try {
      if(el._leaflet_id){ el.innerHTML = ''; try { delete el._leaflet_id; } catch(e){ el._leaflet_id = undefined; } }
      routeMap = L.map(el).setView(DEFAULT_CENTER, 11);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png', { attribution: '&copy; CartoDB', maxZoom: 19 }).addTo(routeMap);
      setTimeout(() => routeMap.invalidateSize(true), 150);
      return routeMap;
    } catch(e){ warn('Erro ao iniciar mapa V12:', e); return null; }
  }
  function parseCoordText(addr){
    const m = String(addr || '').trim().match(/^(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/);
    return m ? { lat:Number(m[1]), lon:Number(m[2]) } : null;
  }
  async function geocode(addr){
    addr = cleanAddress(addr);
    if(!addr) return null;
    const direct = parseCoordText(addr);
    if(direct) return direct;
    const key = addr.toLowerCase();
    const cache = readJSON(GEO_CACHE_KEY, {});
    if(cache[key] && Number.isFinite(Number(cache[key].lat)) && Number.isFinite(Number(cache[key].lon))) return cache[key];
    try {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 4200) : null;
      const q = encodeURIComponent(addr.includes('Brasil') ? addr : `${addr}, Brasil`);
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&addressdetails=0`, {
        headers: { 'Accept-Language': 'pt-BR' },
        signal: controller ? controller.signal : undefined
      });
      if(timer) clearTimeout(timer);
      const js = await res.json();
      if(Array.isArray(js) && js[0]){
        const out = { lat:Number(js[0].lat), lon:Number(js[0].lon) };
        if(Number.isFinite(out.lat) && Number.isFinite(out.lon)){
          cache[key] = out;
          writeJSON(GEO_CACHE_KEY, cache);
          return out;
        }
      }
    } catch(e) {}
    return null;
  }
  function routePedidosFromSelection(){
    const selectors = [
      '#saiu-pedidos-list input[type="checkbox"]:checked',
      '#view-saiu input[type="checkbox"]:checked',
      '#view-rotas input[type="checkbox"]:checked',
      '#view-pronto-envio input[type="checkbox"]:checked',
      '[data-route-order]:checked', '[data-num][type="checkbox"]:checked', '[data-ecom][type="checkbox"]:checked'
    ];
    const inputs = Array.from(new Set(selectors.flatMap(sel => Array.from(document.querySelectorAll(sel)))));
    const out = [];
    inputs.forEach(cb => {
      let val = cb.getAttribute('data-num') || cb.getAttribute('data-ecom') || cb.getAttribute('data-pedido') || cb.value || '';
      if(!val || val === 'on'){
        const row = cb.closest('tr') || cb.closest('.pedido-item') || cb.closest('[data-num]') || cb.parentElement;
        val = row && (row.getAttribute('data-num') || row.getAttribute('data-ecom') || row.getAttribute('data-pedido')) || '';
        if(!val && row){ const m = (row.innerText || '').match(/#\s*([0-9A-Za-z._-]{4,})/) || (row.innerText || '').match(/\b(\d{5,})\b/); if(m) val = m[1]; }
      }
      val = norm(val);
      if(val && !out.includes(val)) out.push(val);
    });
    return out;
  }
  function buildStops(pedidos, origin){
    const stops = [];
    origin = cleanAddress(origin || getOrigin());
    if(origin) stops.push({ isOrigin:true, numero:'Partida', pedido:'__ORIGEM__', cliente:'Ponto de partida', endereco:origin, lat:null, lon:null });
    Array.from(new Set((pedidos || []).map(norm).filter(Boolean))).forEach(p => {
      const o = findOrder(p);
      const c = directCoords(o) || markerCoords(p) || markerCoords(o && (o.numero || o.id));
      stops.push({ isOrigin:false, pedido:p, numero:(o && (o.numero || o.id)) || p, cliente:orderClient(o), endereco:orderAddress(o), lat:c ? c.lat : null, lon:c ? c.lon : null });
    });
    return stops;
  }
  async function resolveStop(stop){
    if(stop && Number.isFinite(Number(stop.lat)) && Number.isFinite(Number(stop.lon))) return { lat:Number(stop.lat), lon:Number(stop.lon) };
    if(!stop.isOrigin){
      const c = markerCoords(stop.numero || stop.pedido) || directCoords(findOrder(stop.numero || stop.pedido));
      if(c) return c;
    }
    const g = await geocode(stop.endereco);
    if(g){ stop.lat = g.lat; stop.lon = g.lon; }
    return g;
  }
  function mapsUrl(stops){
    const valid = (stops || []).filter(s => cleanAddress(s.endereco) || (Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lon))));
    if(!valid.length) return '';
    const enc = s => Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lon)) ? `${Number(s.lat)},${Number(s.lon)}` : cleanAddress(s.endereco);
    if(valid.length === 1) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(enc(valid[0]))}`;
    const limited = valid.slice(0,25);
    let url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(enc(limited[0]))}&destination=${encodeURIComponent(enc(limited[limited.length - 1]))}&travelmode=driving`;
    const way = limited.slice(1,-1).map(enc).filter(Boolean);
    if(way.length) url += `&waypoints=${encodeURIComponent(way.join('|'))}`;
    return url;
  }
  function renderRouteInfo(route, stops, resolvedCount, warning){
    ensureMapPanel();
    const info = document.getElementById('vesco-route-info-v12');
    if(!info) return;
    const url = mapsUrl(stops);
    const deliveries = stops.filter(s => !s.isOrigin);
    info.innerHTML = `
      <div class="font-black text-blue-800 mb-2"><i class="fas fa-route mr-1"></i>Rota montada: ${esc(route.nome || 'Prévia da rota')}</div>
      <div class="mb-1"><b>Partida:</b> ${esc((stops.find(s => s.isOrigin) || {}).endereco || '—')}</div>
      <div class="mb-1"><b>Motorista:</b> ${esc(route.motorista || '—')} • <b>Pedidos:</b> ${deliveries.length}</div>
      <div class="mb-2 text-blue-700 font-bold">${resolvedCount}/${stops.length} ponto(s) carregado(s) no mapa.</div>
      ${warning ? `<div class="vesco-route-origin-warning-v12">${esc(warning)}</div>` : ''}
      <div class="max-h-40 overflow-auto bg-white/70 border border-blue-100 rounded-lg p-2 mb-2 mt-2">
        ${stops.map((s,i) => `<div class="mb-1"><b>${s.isOrigin ? 'Partida' : (i + '. #' + esc(s.numero || s.pedido))}</b> — ${esc(s.endereco || 'Endereço não localizado')}</div>`).join('')}
      </div>
      ${url ? `<button type="button" onclick="window.open('${esc(url)}','_blank')" class="inline-flex items-center gap-1 bg-blue-600 text-white px-3 py-1.5 rounded-lg font-bold"><i class="fas fa-map-marked-alt"></i>Abrir rota no Google Maps</button>` : ''}`;
  }
  async function drawRoute(routeOrId, opts = {}){
    let route = typeof routeOrId === 'string' ? (window.saiuRotas || []).find(r => String(r.id) === String(routeOrId)) : routeOrId;
    if(!route){
      const pedidos = routePedidosFromSelection();
      route = { id:'preview-v12', nome:'Prévia da rota', motorista:'—', pedidos, origem:getOrigin(), criadoEm:new Date().toISOString() };
    }
    if(!route.pedidos) route.pedidos = [];
    const origin = cleanAddress(route.origem || getOrigin());
    route.origem = origin;
    let warning = '';
    if(!origin) warning = 'Informe o ponto de partida para montar a rota completa.';
    else if(!looksLikeAddress(origin)) warning = 'O ponto de partida parece ser nome de rota, não endereço. Use rua/avenida + número + cidade.';
    const stops = buildStops(route.pedidos, origin);
    route.paradas = stops;
    const sig = JSON.stringify({ id:route.id, pedidos:route.pedidos, origin, t: opts.force ? Date.now() : '' });
    if(!opts.force && sig === lastRouteSignature) return mapsUrl(stops);
    lastRouteSignature = sig;
    const m = ensureRouteMap();
    renderRouteInfo(route, stops, 0, warning);
    if(!m || typeof L === 'undefined') return mapsUrl(stops);
    try { if(routeLayer) routeLayer.remove(); } catch(e) {}
    routeLayer = L.layerGroup().addTo(m);
    const latlngs = [];
    for(let i=0;i<stops.length;i++){
      const s = stops[i];
      const coords = await resolveStop(s);
      if(!coords) continue;
      const ll = [coords.lat, coords.lon];
      latlngs.push(ll);
      try {
        const label = s.isOrigin ? 'P' : String(i);
        const color = s.isOrigin ? '#111827' : '#2563eb';
        const icon = L.divIcon({ html:`<div style="width:30px;height:30px;border-radius:999px;background:${color};color:white;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,.25)">${label}</div>`, className:'', iconSize:[30,30], iconAnchor:[15,15] });
        L.marker(ll,{icon}).addTo(routeLayer).bindPopup(`<b>${s.isOrigin ? 'Partida' : ('Pedido #' + esc(s.numero || s.pedido))}</b><br>${esc(s.cliente || '')}<br><small>${esc(s.endereco || '')}</small>`);
      } catch(e) {}
    }
    if(latlngs.length > 1){ try { L.polyline(latlngs, { weight:5, opacity:.9 }).addTo(routeLayer); } catch(e) {} }
    try {
      if(latlngs.length === 1) m.setView(latlngs[0], 15);
      else if(latlngs.length > 1) m.fitBounds(L.latLngBounds(latlngs).pad(0.18), { maxZoom: 15 });
      else m.setView(DEFAULT_CENTER, 11);
      setTimeout(() => m.invalidateSize(true), 120);
      setTimeout(() => m.invalidateSize(true), 650);
    } catch(e) {}
    renderRouteInfo(route, stops, latlngs.length, warning);
    try { localStorage.setItem(ROUTES_KEY, JSON.stringify(window.saiuRotas || [])); } catch(e) {}
    return mapsUrl(stops);
  }
  function latestActiveRoute(){
    const routes = Array.isArray(window.saiuRotas) ? window.saiuRotas : readJSON(ROUTES_KEY, []);
    if(!routes.length) return null;
    return routes.slice().sort((a,b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')))[0];
  }
  function renderLatestRouteSoon(force){
    if(!isRouteViewActive()) return;
    setTimeout(() => {
      ensureOriginField();
      const route = latestActiveRoute();
      if(route) drawRoute(route, { force: !!force });
      else ensureRouteMap();
    }, 250);
  }

  // Substitui as funções expostas de rota para usar a implementação estável V12.
  window.verRotaMapa = function(rotaId){ return drawRoute(rotaId, { force:true }); };
  window.vescoOpenRouteInGoogle = function(rotaId){
    const route = (window.saiuRotas || []).find(r => String(r.id) === String(rotaId)) || latestActiveRoute();
    const stops = route ? buildStops(route.pedidos || [], route.origem || getOrigin()) : buildStops(routePedidosFromSelection(), getOrigin());
    const url = mapsUrl(stops);
    if(url) window.open(url, '_blank');
    else toast('Nenhuma rota disponível para abrir.', 'warning');
  };
  if(window.vescoRoutesV6){
    window.vescoRoutesV6.drawRouteOnMap = drawRoute;
    window.vescoRoutesV6.ensureRouteMap = ensureRouteMap;
    window.vescoRoutesV6.getRouteOrigin = getOrigin;
    window.vescoRoutesV6.buildStops = buildStops;
    window.vescoRoutesV6.buildGoogleMapsRouteUrl = function(route){ return mapsUrl(buildStops(route && route.pedidos || [], route && route.origem || getOrigin())); };
  }

  function injectPendenciaButtons(){
    const tbody = document.getElementById('table-entregues');
    if(!tbody) return;
    const rows = Array.from(tbody.querySelectorAll('tr'));
    const signature = rows.map(r => r.innerText).join('|').slice(0, 4000);
    if(signature === lastDeliveredButtonSignature && tbody.querySelector('.vesco-entregue-pendencia-btn-v12')) return;
    lastDeliveredButtonSignature = signature;
    rows.forEach(row => {
      if(/nenhum despacho|nenhum registro/i.test(row.innerText || '')) return;
      if(row.querySelector('.vesco-entregue-pendencia-btn-v12')) return;
      const txt = row.innerText || '';
      const m = txt.match(/#\s*([0-9A-Za-z._-]+)/) || txt.match(/\b(\d{5,})\b/);
      if(!m) return;
      const numero = m[1];
      const order = findOrder(numero);
      const id = (order && (order.id || order.numero)) || numero;
      const target = row.querySelector('td:last-child') || row.lastElementChild;
      if(!target) return;
      const box = document.createElement('div');
      box.className = 'mt-2 flex justify-center';
      box.innerHTML = `<button type="button" class="vesco-entregue-pendencia-btn-v12 bg-amber-500 hover:bg-amber-600 text-white px-3 py-1 rounded-lg font-bold text-[11px] shadow-sm transition-all" onclick="window.vescoPendenciaEntregaV12 && window.vescoPendenciaEntregaV12('${esc(id)}')"><i class="fas fa-triangle-exclamation mr-1"></i>Pendência</button>`;
      target.appendChild(box);
    });
  }
  window.vescoPendenciaEntregaV12 = function(id){
    if(!id) return;
    try { if(typeof window.moverParaPendenciaPrompt === 'function') return window.moverParaPendenciaPrompt(id); } catch(e) {}
    const motivo = prompt(`Informe a pendência do pedido #${id}:`);
    if(!motivo) return;
    try { if(typeof updateStatusJsonp === 'function') updateStatusJsonp(id, 'Pendente', `[Pós-entrega] ${motivo}`); } catch(e) {}
    toast('Pendência registrada para o pedido entregue.', 'warning');
  };

  const oldRender = window.render || (typeof render === 'function' ? render : null);
  if(oldRender && !window.__vescoRenderV12Wrapped){
    window.__vescoRenderV12Wrapped = true;
    window.render = render = function(){
      const ret = oldRender.apply(this, arguments);
      setTimeout(injectPendenciaButtons, 180);
      setTimeout(() => renderLatestRouteSoon(false), 280);
      return ret;
    };
  }
  const oldSwitch = window.switchTab;
  if(typeof oldSwitch === 'function' && !window.__vescoSwitchV12Wrapped){
    window.__vescoSwitchV12Wrapped = true;
    window.switchTab = function(which){
      const ret = oldSwitch.apply(this, arguments);
      setTimeout(injectPendenciaButtons, 220);
      if(['saiu','rotas','pronto_envio','pronto_para_envio','prontoParaEnvio','envio'].includes(which)) renderLatestRouteSoon(true);
      return ret;
    };
  }

  // Botões de traçar rota: não interfere na criação antiga, mas garante que o botão visual trace usando V12.
  document.addEventListener('click', function(e){
    const btn = e.target && e.target.closest && e.target.closest('button, a, [role="button"], input[type="button"], input[type="submit"]');
    if(!btn) return;
    const text = `${btn.textContent || ''} ${btn.value || ''} ${btn.id || ''}`.toLowerCase();
    if(/tra[cç]ar\s+(rota|no mapa)|google\s*maps|ver\s+no\s+mapa/.test(text)){
      setTimeout(() => renderLatestRouteSoon(true), 150);
    }
    if(/criar\s+rota/.test(text)){
      const origin = getOrigin();
      if(origin && !looksLikeAddress(origin)){
        setTimeout(() => toast('Atenção: o ponto de partida parece não ser endereço. Use rua/avenida + número + cidade para a rota carregar no mapa.', 'warning', 6000), 200);
      }
      setTimeout(() => renderLatestRouteSoon(true), 900);
    }
  }, false);

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){
      installStyle();
      ensureOriginField();
      setTimeout(injectPendenciaButtons, 900);
      setTimeout(() => renderLatestRouteSoon(true), 1200);
    });
  } else {
    installStyle();
    ensureOriginField();
    setTimeout(injectPendenciaButtons, 700);
    setTimeout(() => renderLatestRouteSoon(true), 1000);
  }

  // Pequeno reforço sem MutationObserver: apenas alguns ciclos no início/troca de tela.
  let cycles = 0;
  const t = setInterval(() => {
    cycles++;
    injectPendenciaButtons();
    if(isRouteViewActive()) renderLatestRouteSoon(false);
    if(cycles >= 10) clearInterval(t);
  }, 1000);

  window.vescoRoutesV12 = {
    drawRoute,
    ensureRouteMap,
    ensureOriginField,
    getOrigin,
    looksLikeAddress,
    injectPendenciaButtons,
    geocode,
    findOrder,
    routePedidosFromSelection,
    buildStops
  };

  log('Rotas/Pendências V12 ativo — rota com origem real, geocoding controlado e botão Pendência em Entregues.');
})();

// =================================================================
// CAMADA V13 — MAPA ÚNICO DE ROTAS + ORIGEM VÁLIDA + PENDÊNCIA GARANTIDA
// Regra de Preservação: camada aditiva. Não remove funções antigas;
// apenas oculta mapas legados duplicados e assume a renderização final.
// =================================================================
(function installVescoRouteSingleMapV13(){
  if(window.__vescoRouteSingleMapV13) return;
  window.__vescoRouteSingleMapV13 = true;

  const ROUTES_KEY = 'vesco_saiu_rotas_v1';
  const ORIGIN_KEY = 'vesco_route_origin_v6';
  const GEO_CACHE_KEY = 'vesco_route_geocode_cache_v13';
  const DEFAULT_CENTER = [-23.55052, -46.633308];
  let routeLayerV13 = null;
  let lastDrawSigV13 = '';

  function log(){ try { console.log.apply(console, arguments); } catch(e) {} }
  function warn(){ try { console.warn.apply(console, arguments); } catch(e) {} }
  function esc(v){
    try { return typeof escapeHtml === 'function' ? escapeHtml(v) : String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
    catch(e){ return String(v ?? ''); }
  }
  function toast(msg, type='info', ms=3500){
    try { if(typeof showToast === 'function') return showToast(msg, type, ms); } catch(e) {}
    console.log(msg);
  }
  function clean(v){ return String(v || '').replace(/\s+/g,' ').replace(/\|/g, ',').replace(/\bSao\b/gi, 'São').trim(); }
  function norm(v){
    try { return typeof normalizeOrderNumber === 'function' ? normalizeOrderNumber(v) : String(v ?? '').replace(/^#/,'').trim(); }
    catch(e){ return String(v ?? '').replace(/^#/,'').trim(); }
  }
  function readJSON(key, fallback){ try { return JSON.parse(localStorage.getItem(key) || '') || fallback; } catch(e) { return fallback; } }
  function writeJSON(key, value){ try { localStorage.setItem(key, JSON.stringify(value || {})); } catch(e) {} }
  function getComputedVisible(el){
    if(!el) return false;
    const cs = window.getComputedStyle ? window.getComputedStyle(el) : null;
    if(cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }
  function viewVisible(id){
    const el = document.getElementById(id);
    return !!el && !el.classList.contains('hidden') && getComputedVisible(el);
  }
  function routeViewActive(){
    return viewVisible('view-saiu') || viewVisible('view-rotas') || viewVisible('view-pronto-envio') || viewVisible('view-pronto_envio') || viewVisible('view-pronto_para_envio') || /pronto\s+para\s+envio|montar\s+rotas/i.test((document.querySelector('.tab-btn.active,[id^="main-"].active') || {}).textContent || '');
  }
  function logisticalMapActive(){ return viewVisible('view-logistica') || viewVisible('view-envios_flex'); }

  function installStyle(){
    if(document.getElementById('vesco-v13-style')) return;
    const st = document.createElement('style');
    st.id = 'vesco-v13-style';
    st.textContent = `
      /* Mantém apenas o mapa V12/V13. Os mapas legados ficam preservados no DOM, mas ocultos. */
      #vesco-route-map-panel-v6,
      #vesco-route-info-panel-v6,
      #vesco-route-map-panel-v5,
      #vesco-route-info-panel-v5,
      #vesco-route-map-v5{
        display:none!important;
        height:0!important;
        min-height:0!important;
        max-height:0!important;
        overflow:hidden!important;
        opacity:0!important;
        pointer-events:none!important;
        margin:0!important;
        padding:0!important;
        border:0!important;
      }
      #vesco-route-panel-v12{display:block!important;margin-top:0!important;}
      #vesco-route-map-v12{display:block!important;min-height:390px!important;height:calc(100vh - 250px)!important;width:100%!important;}
      #table-entregues .vesco-entregue-pendencia-btn-v13{display:inline-flex!important;align-items:center;justify-content:center;gap:4px;}
      .vesco-v13-warning{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:10px;padding:8px;font-size:11px;font-weight:800;margin:8px 0;}
      @media(max-width:1024px){#vesco-route-map-v12{height:360px!important;min-height:360px!important;}}
    `;
    document.head.appendChild(st);
  }
  function hideDuplicateMaps(){
    installStyle();
    ['vesco-route-map-panel-v6','vesco-route-info-panel-v6','vesco-route-map-panel-v5','vesco-route-info-panel-v5'].forEach(id => {
      const el = document.getElementById(id);
      if(el) {
        el.setAttribute('aria-hidden','true');
        el.dataset.vescoHiddenDuplicateMap = '1';
      }
    });
  }

  function allOrders(){
    const pool = [];
    try { if(Array.isArray(orders)) pool.push(...orders); } catch(e) {}
    try { if(Array.isArray(flexOrders)) pool.push(...flexOrders); } catch(e) {}
    if(Array.isArray(window.orders)) pool.push(...window.orders);
    if(Array.isArray(window.flexOrders)) pool.push(...window.flexOrders);
    const seen = new Set();
    return pool.filter(o => {
      if(!o) return false;
      const k = String(o.id || o.numero || o.pedido || Math.random());
      if(seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  function orderKeys(o){
    if(!o) return [];
    const vals = [o.id,o.numero,o.pedido,o.order_id,o.orderNumber,o.reference,o.referencia,o.numero_ecommerce,o.numero_ecom,o.codigo_externo,o.codigo];
    const keys = [];
    vals.forEach(v => {
      if(v === undefined || v === null || String(v).trim() === '') return;
      const raw = String(v).trim();
      keys.push(raw, norm(raw), raw.replace(/\D/g,''));
    });
    return Array.from(new Set(keys.filter(Boolean)));
  }
  function findOrder(id){
    const raw = String(id || '').trim();
    const n = norm(raw);
    const dig = raw.replace(/\D/g,'');
    return allOrders().find(o => {
      const keys = orderKeys(o);
      return keys.includes(raw) || keys.includes(n) || (dig && keys.includes(dig));
    }) || null;
  }
  function orderAddress(o){ return clean(o && (o.endereco_completo || o.endereco || o.address || o.full_address || o.logradouro || '')); }
  function orderClient(o){
    try { return extractClientNameFromAny(o) || o.cliente_nome || o.cliente || o.destinatario || o.nome || ''; }
    catch(e){ return o && (o.cliente_nome || o.cliente || o.destinatario || o.nome) || ''; }
  }
  function directCoords(o){
    try {
      const c = typeof getCoords === 'function' ? getCoords(o) : null;
      if(c && Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lon))) return {lat:Number(c.lat), lon:Number(c.lon)};
    } catch(e) {}
    return null;
  }
  function markerCoords(key){
    try {
      const m = (typeof findMainMarkerByKey === 'function' && findMainMarkerByKey(key)) || (typeof findFlexMarkerByKey === 'function' && findFlexMarkerByKey(key));
      if(m && typeof m.getLatLng === 'function') {
        const ll = m.getLatLng();
        if(ll && Number.isFinite(Number(ll.lat)) && Number.isFinite(Number(ll.lng))) return {lat:Number(ll.lat), lon:Number(ll.lng)};
      }
    } catch(e) {}
    return null;
  }

  function looksLikeAddress(v){
    const s = clean(v).toLowerCase();
    if(!s) return false;
    if(/^-?\d{1,2}\.\d+\s*,\s*-?\d{1,3}\.\d+$/.test(s)) return true;
    const hasStreet = /(rua|r\.|avenida|av\.|alameda|travessa|estrada|rodovia|pra[cç]a|largo|via)\b/.test(s);
    const hasNumber = /\b\d{1,6}[a-z]?\b/.test(s);
    const hasCity = /(s[aã]o paulo|sp|barueri|osasco|guarulhos|santo andr[eé]|cotia|diadema|tabo[aã]o|carapicu[ií]ba|mau[aá]|s[aã]o bernardo|emb[uú])/.test(s);
    return (hasStreet && hasNumber) || (hasStreet && hasCity) || (hasNumber && hasCity);
  }
  function parseCoordText(addr){
    const m = clean(addr).match(/^(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/);
    return m ? {lat:Number(m[1]), lon:Number(m[2])} : null;
  }
  function routeRoot(){
    const selectors = ['#view-saiu:not(.hidden)', '#view-rotas:not(.hidden)', '#view-pronto-envio:not(.hidden)', '#view-pronto_envio:not(.hidden)', '#view-pronto_para_envio:not(.hidden)', '#view-saiu', '#view-rotas'];
    for(const sel of selectors){ const el = document.querySelector(sel); if(el) return el; }
    return document.body;
  }
  function ensureOriginField(){
    let input = document.getElementById('vesco-rota-origem-v6') || document.getElementById('vesco-rota-origem-v12') || document.getElementById('rotaOrigem') || document.getElementById('pontoPartidaRota');
    if(input) return input;
    const root = routeRoot();
    const saved = localStorage.getItem(ORIGIN_KEY) || '';
    const wrap = document.createElement('div');
    wrap.className = 'vesco-rota-origem-v13 mb-3';
    wrap.innerHTML = `<label class="block text-xs font-black text-slate-700 mb-1">Ponto de partida da rota</label><input id="vesco-rota-origem-v13" type="text" value="${esc(saved)}" placeholder="Ex: Rua Conselheiro Dantas, 141 - Brás, São Paulo - SP" class="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm outline-none focus:border-blue-500 w-full"/><div class="text-[10px] text-slate-400 mt-1">Use endereço real. Nome da rota não é ponto de partida.</div>`;
    const anchor = root.querySelector('#rotaMotorista,#motoristaRota,#routeDriver,#rotaNome,#nomeRota,#saiu-pedidos-list') || root.firstElementChild;
    if(anchor && anchor.parentElement) anchor.parentElement.insertBefore(wrap, anchor.nextSibling);
    else root.prepend(wrap);
    input = wrap.querySelector('input');
    input.addEventListener('input', () => localStorage.setItem(ORIGIN_KEY, clean(input.value)));
    return input;
  }
  function getOrigin(){
    const input = ensureOriginField();
    const val = clean((input && input.value) || localStorage.getItem(ORIGIN_KEY) || '');
    if(val) localStorage.setItem(ORIGIN_KEY, val);
    return val;
  }
  function ensureMapPanel(){
    hideDuplicateMaps();
    let panel = document.getElementById('vesco-route-panel-v12');
    if(!panel){
      panel = document.createElement('div');
      panel.id = 'vesco-route-panel-v12';
      panel.innerHTML = `<div id="vesco-route-info-v12"><div class="font-black text-blue-800 mb-1"><i class="fas fa-route mr-1"></i>Planejamento da rota</div><div class="text-slate-600">Informe um endereço real de partida, selecione os pedidos e trace a rota.</div></div><div class="flex items-center justify-between mb-2"><div class="text-[11px] font-black text-slate-500 uppercase">Mapa da rota</div><div class="text-[10px] font-bold text-blue-600 uppercase">Partida + entregas</div></div><div id="vesco-route-map-v12"></div>`;
      const right = document.getElementById('vesco-saiu-right-v6');
      if(right) right.appendChild(panel);
      else routeRoot().appendChild(panel);
    }
    return panel;
  }
  function ensureMap(){
    ensureMapPanel();
    if(typeof L === 'undefined') return null;
    const el = document.getElementById('vesco-route-map-v12');
    if(!el) return null;
    let existing = null;
    try {
      if(window.vescoRoutesV12 && typeof window.vescoRoutesV12.ensureRouteMap === 'function' && !window.__vescoV13CallingEnsure) {
        window.__vescoV13CallingEnsure = true;
        existing = window.vescoRoutesV12.ensureRouteMap();
        window.__vescoV13CallingEnsure = false;
      }
    } catch(e){ window.__vescoV13CallingEnsure = false; }
    if(existing && existing._container === el){ setTimeout(() => existing.invalidateSize && existing.invalidateSize(true), 80); return existing; }
    try {
      if(el._leaflet_id){ el.innerHTML = ''; try { delete el._leaflet_id; } catch(e){ el._leaflet_id = undefined; } }
      const m = L.map(el).setView(DEFAULT_CENTER, 11);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png', { attribution: '&copy; CartoDB', maxZoom: 19 }).addTo(m);
      setTimeout(() => m.invalidateSize(true), 150);
      return m;
    } catch(e){ warn('V13: erro ao iniciar mapa único:', e); return null; }
  }
  function clearMapLayers(m){
    if(!m || typeof L === 'undefined') return;
    try { if(routeLayerV13 && typeof routeLayerV13.remove === 'function') routeLayerV13.remove(); } catch(e) {}
    try {
      m.eachLayer(layer => {
        if(layer instanceof L.TileLayer) return;
        m.removeLayer(layer);
      });
    } catch(e) {}
    routeLayerV13 = L.layerGroup().addTo(m);
  }

  async function geocode(addr){
    addr = clean(addr);
    if(!addr) return null;
    const direct = parseCoordText(addr);
    if(direct) return direct;
    if(!looksLikeAddress(addr)) return null;
    const cache = readJSON(GEO_CACHE_KEY, {});
    const key = addr.toLowerCase();
    if(cache[key] && Number.isFinite(Number(cache[key].lat)) && Number.isFinite(Number(cache[key].lon))) return cache[key];
    try {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 3500) : null;
      const q = encodeURIComponent(addr.includes('Brasil') ? addr : `${addr}, Brasil`);
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&addressdetails=0`, { headers:{'Accept-Language':'pt-BR'}, signal: controller ? controller.signal : undefined });
      if(timer) clearTimeout(timer);
      const js = await res.json();
      if(Array.isArray(js) && js[0]){
        const out = {lat:Number(js[0].lat), lon:Number(js[0].lon)};
        if(Number.isFinite(out.lat) && Number.isFinite(out.lon)){ cache[key]=out; writeJSON(GEO_CACHE_KEY, cache); return out; }
      }
    } catch(e) {}
    return null;
  }
  function selectedPedidos(){
    const selectors = ['#saiu-pedidos-list input[type="checkbox"]:checked','#view-saiu input[type="checkbox"]:checked','#view-rotas input[type="checkbox"]:checked','#view-pronto-envio input[type="checkbox"]:checked','[data-route-order]:checked','[data-num][type="checkbox"]:checked','[data-ecom][type="checkbox"]:checked'];
    const inputs = Array.from(new Set(selectors.flatMap(sel => Array.from(document.querySelectorAll(sel)))));
    const out = [];
    inputs.forEach(cb => {
      let val = cb.getAttribute('data-num') || cb.getAttribute('data-ecom') || cb.getAttribute('data-pedido') || cb.value || '';
      if(!val || val === 'on'){
        const row = cb.closest('tr') || cb.closest('.pedido-item') || cb.closest('[data-num]') || cb.parentElement;
        val = row && (row.getAttribute('data-num') || row.getAttribute('data-ecom') || row.getAttribute('data-pedido')) || '';
        if(!val && row){ const m = (row.innerText || '').match(/#\s*([0-9A-Za-z._-]{4,})/) || (row.innerText || '').match(/\b(\d{5,})\b/); if(m) val = m[1]; }
      }
      val = norm(val);
      if(val && !out.includes(val)) out.push(val);
    });
    return out;
  }
  function buildStops(pedidos, origin){
    const stops = [];
    origin = clean(origin || getOrigin());
    const originValid = looksLikeAddress(origin) || !!parseCoordText(origin);
    if(origin && originValid) stops.push({isOrigin:true, numero:'Partida', pedido:'__ORIGEM__', cliente:'Ponto de partida', endereco:origin});
    Array.from(new Set((pedidos || []).map(norm).filter(Boolean))).forEach(p => {
      const o = findOrder(p);
      const c = directCoords(o) || markerCoords(p) || markerCoords(o && (o.numero || o.id));
      stops.push({isOrigin:false, pedido:p, numero:(o && (o.numero || o.id)) || p, cliente:orderClient(o), endereco:orderAddress(o), lat:c ? c.lat : null, lon:c ? c.lon : null});
    });
    return stops;
  }
  async function resolveStop(s){
    if(s && Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lon))) return {lat:Number(s.lat), lon:Number(s.lon)};
    if(!s.isOrigin){
      const c = markerCoords(s.numero || s.pedido) || directCoords(findOrder(s.numero || s.pedido));
      if(c) return c;
    }
    const g = await geocode(s.endereco);
    if(g){ s.lat = g.lat; s.lon = g.lon; }
    return g;
  }
  function mapsUrl(stops){
    const valid = (stops || []).filter(s => clean(s.endereco) || (Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lon))));
    if(!valid.length) return '';
    const enc = s => Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lon)) ? `${Number(s.lat)},${Number(s.lon)}` : clean(s.endereco);
    if(valid.length === 1) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(enc(valid[0]))}`;
    const limited = valid.slice(0,25);
    let url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(enc(limited[0]))}&destination=${encodeURIComponent(enc(limited[limited.length-1]))}&travelmode=driving`;
    const way = limited.slice(1,-1).map(enc).filter(Boolean);
    if(way.length) url += `&waypoints=${encodeURIComponent(way.join('|'))}`;
    return url;
  }
  function routeById(id){ return (window.saiuRotas || readJSON(ROUTES_KEY, []) || []).find(r => String(r.id) === String(id)); }
  function latestRoute(){
    const routes = Array.isArray(window.saiuRotas) ? window.saiuRotas : readJSON(ROUTES_KEY, []);
    if(!routes || !routes.length) return null;
    return routes.slice().sort((a,b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')))[0];
  }
  function renderInfo(route, stops, resolved, warning){
    ensureMapPanel();
    const info = document.getElementById('vesco-route-info-v12');
    if(!info) return;
    const deliveries = stops.filter(s => !s.isOrigin);
    const url = mapsUrl(stops);
    info.innerHTML = `<div class="font-black text-blue-800 mb-2"><i class="fas fa-route mr-1"></i>Rota montada: ${esc(route.nome || 'Prévia da rota')}</div><div class="mb-1"><b>Partida:</b> ${esc((stops.find(s => s.isOrigin) || {}).endereco || '—')}</div><div class="mb-1"><b>Motorista:</b> ${esc(route.motorista || '—')} • <b>Pedidos:</b> ${deliveries.length}</div><div class="mb-2 text-blue-700 font-bold">${resolved}/${stops.length} ponto(s) carregado(s) no mapa.</div>${warning ? `<div class="vesco-v13-warning">${esc(warning)}</div>` : ''}<div class="max-h-40 overflow-auto bg-white/70 border border-blue-100 rounded-lg p-2 mb-2 mt-2">${stops.map((s,i) => `<div class="mb-1"><b>${s.isOrigin ? 'Partida' : (i + '. #' + esc(s.numero || s.pedido))}</b> — ${esc(s.endereco || 'Endereço não localizado')}</div>`).join('')}</div>${url ? `<button type="button" onclick="window.open('${esc(url)}','_blank')" class="inline-flex items-center gap-1 bg-blue-600 text-white px-3 py-1.5 rounded-lg font-bold"><i class="fas fa-map-marked-alt"></i>Abrir rota no Google Maps</button>` : ''}`;
  }
  async function drawRoute(routeOrId, opts={}){
    hideDuplicateMaps();
    let route = typeof routeOrId === 'string' ? routeById(routeOrId) : routeOrId;
    if(!route){
      route = {id:'preview-v13', nome:'Prévia da rota', motorista:'—', pedidos:selectedPedidos(), origem:getOrigin(), criadoEm:new Date().toISOString()};
    }
    route.pedidos = route.pedidos || [];
    const rawOrigin = clean(route.origem || getOrigin());
    let warning = '';
    if(rawOrigin && !looksLikeAddress(rawOrigin) && !parseCoordText(rawOrigin)) warning = 'O ponto de partida parece ser nome de rota, não endereço. Ele foi ignorado no mapa. Use rua/avenida + número + cidade.';
    if(!rawOrigin) warning = 'Informe o ponto de partida para montar a rota completa.';
    const originForStops = warning && rawOrigin && !looksLikeAddress(rawOrigin) ? '' : rawOrigin;
    const stops = buildStops(route.pedidos, originForStops);
    route.paradas = stops;
    const sig = JSON.stringify({id:route.id, pedidos:route.pedidos, origin:originForStops, force:!!opts.force});
    if(!opts.force && sig === lastDrawSigV13) return mapsUrl(stops);
    lastDrawSigV13 = sig;
    const m = ensureMap();
    renderInfo(route, stops, 0, warning);
    if(!m || typeof L === 'undefined') return mapsUrl(stops);
    clearMapLayers(m);
    const latlngs = [];
    for(let i=0; i<stops.length; i++){
      const s = stops[i];
      const coords = await resolveStop(s);
      if(!coords) continue;
      const ll = [coords.lat, coords.lon];
      latlngs.push(ll);
      try {
        const label = s.isOrigin ? 'P' : String(i);
        const color = s.isOrigin ? '#111827' : '#2563eb';
        const icon = L.divIcon({html:`<div style="width:30px;height:30px;border-radius:999px;background:${color};color:white;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,.25)">${label}</div>`, className:'', iconSize:[30,30], iconAnchor:[15,15]});
        L.marker(ll,{icon}).addTo(routeLayerV13).bindPopup(`<b>${s.isOrigin ? 'Partida' : ('Pedido #' + esc(s.numero || s.pedido))}</b><br>${esc(s.cliente || '')}<br><small>${esc(s.endereco || '')}</small>`);
      } catch(e) {}
    }
    if(latlngs.length > 1){ try { L.polyline(latlngs, {weight:5, opacity:.9}).addTo(routeLayerV13); } catch(e) {} }
    try {
      if(latlngs.length === 1) m.setView(latlngs[0], 15);
      else if(latlngs.length > 1) m.fitBounds(L.latLngBounds(latlngs).pad(0.18), {maxZoom:15});
      else m.setView(DEFAULT_CENTER, 11);
      setTimeout(() => m.invalidateSize(true), 120);
      setTimeout(() => m.invalidateSize(true), 650);
    } catch(e) {}
    renderInfo(route, stops, latlngs.length, warning);
    return mapsUrl(stops);
  }
  function renderLatest(force=false){
    if(!routeViewActive()) return;
    setTimeout(() => {
      hideDuplicateMaps();
      ensureOriginField();
      drawRoute(latestRoute() || {id:'preview-v13', nome:'Prévia da rota', motorista:'—', pedidos:selectedPedidos(), origem:getOrigin()}, {force});
    }, 180);
  }

  // Bloqueio final contra geocodificação em massa quando a aba visível não é Logística/Flex.
  try {
    const oldPlot = window.plotMapMarkers || (typeof plotMapMarkers === 'function' ? plotMapMarkers : null);
    if(oldPlot && !window.__vescoPlotMapMarkersV13Wrapped){
      window.__vescoPlotMapMarkersV13Wrapped = true;
      window.plotMapMarkers = plotMapMarkers = function(orderList, flexList){
        if(!logisticalMapActive()) {
          try { if(Array.isArray(window.geocodeQueue)) window.geocodeQueue.length = 0; } catch(e) {}
          try { if(typeof geocodeQueue !== 'undefined' && Array.isArray(geocodeQueue)) geocodeQueue.length = 0; } catch(e) {}
          return;
        }
        return oldPlot.apply(this, arguments);
      };
    }
  } catch(e) {}

  function injectPendencia(){
    const tbody = document.getElementById('table-entregues');
    if(!tbody) return;
    Array.from(tbody.querySelectorAll('tr')).forEach(row => {
      if(/nenhum despacho|nenhum registro/i.test(row.innerText || '')) return;
      if(row.querySelector('.vesco-entregue-pendencia-btn-v13')) return;
      const m = (row.innerText || '').match(/#\s*([0-9A-Za-z._-]+)/) || (row.innerText || '').match(/\b(\d{5,})\b/);
      if(!m) return;
      const numero = m[1];
      const o = findOrder(numero);
      const id = (o && (o.id || o.numero)) || numero;
      const target = row.querySelector('td:last-child') || row.lastElementChild;
      if(!target) return;
      const existingFinalizado = target.querySelector('.vesco-entregue-pendencia-btn-v13');
      if(existingFinalizado) return;
      const wrap = document.createElement('div');
      wrap.className = 'mt-2 flex justify-center';
      wrap.innerHTML = `<button type="button" class="vesco-entregue-pendencia-btn-v13 bg-amber-500 hover:bg-amber-600 text-white px-3 py-1 rounded-lg font-bold text-[11px] shadow-sm transition-all" onclick="window.vescoPendenciaEntregaV13 && window.vescoPendenciaEntregaV13('${esc(id)}')"><i class="fas fa-triangle-exclamation mr-1"></i>Pendência</button>`;
      target.appendChild(wrap);
    });
  }
  window.vescoPendenciaEntregaV13 = function(id){
    if(!id) return;
    try { if(typeof window.moverParaPendenciaPrompt === 'function') return window.moverParaPendenciaPrompt(id); } catch(e) {}
    const motivo = prompt(`Informe a pendência do pedido #${id}:`);
    if(!motivo) return;
    try { if(typeof updateStatusJsonp === 'function') updateStatusJsonp(id, 'Pendente', `[Pós-entrega] ${motivo}`); } catch(e) {}
    toast('Pendência registrada para o pedido entregue.', 'warning');
  };

  window.verRotaMapa = function(rotaId){ return drawRoute(rotaId, {force:true}); };
  window.vescoOpenRouteInGoogle = function(rotaId){
    const route = routeById(rotaId) || latestRoute();
    const stops = route ? buildStops(route.pedidos || [], route.origem || getOrigin()) : buildStops(selectedPedidos(), getOrigin());
    const url = mapsUrl(stops);
    if(url) window.open(url, '_blank');
    else toast('Nenhuma rota disponível para abrir.', 'warning');
  };
  if(window.vescoRoutesV12){
    window.vescoRoutesV12.drawRoute = drawRoute;
    window.vescoRoutesV12.ensureRouteMap = ensureMap;
    window.vescoRoutesV12.ensureOriginField = ensureOriginField;
    window.vescoRoutesV12.getOrigin = getOrigin;
    window.vescoRoutesV12.injectPendenciaButtons = injectPendencia;
    window.vescoRoutesV12.buildStops = buildStops;
  }
  if(window.vescoRoutesV6){
    window.vescoRoutesV6.drawRouteOnMap = drawRoute;
    window.vescoRoutesV6.ensureRouteMap = ensureMap;
    window.vescoRoutesV6.getRouteOrigin = getOrigin;
    window.vescoRoutesV6.buildStops = buildStops;
  }

  const oldRender = window.render || (typeof render === 'function' ? render : null);
  if(oldRender && !window.__vescoRenderV13Wrapped){
    window.__vescoRenderV13Wrapped = true;
    window.render = render = function(){
      const ret = oldRender.apply(this, arguments);
      setTimeout(hideDuplicateMaps, 80);
      setTimeout(injectPendencia, 180);
      setTimeout(() => renderLatest(false), 260);
      return ret;
    };
  }
  const oldSwitch = window.switchTab;
  if(typeof oldSwitch === 'function' && !window.__vescoSwitchV13Wrapped){
    window.__vescoSwitchV13Wrapped = true;
    window.switchTab = function(which){
      const ret = oldSwitch.apply(this, arguments);
      setTimeout(hideDuplicateMaps, 80);
      setTimeout(injectPendencia, 180);
      if(['saiu','rotas','pronto_envio','pronto_para_envio','prontoParaEnvio','envio'].includes(which)) renderLatest(true);
      return ret;
    };
  }
  document.addEventListener('click', function(e){
    const btn = e.target && e.target.closest && e.target.closest('button, a, [role="button"], input[type="button"], input[type="submit"]');
    if(!btn) return;
    const txt = `${btn.textContent || ''} ${btn.value || ''} ${btn.id || ''}`.toLowerCase();
    if(/tra[cç]ar\s+(rota|no mapa)|google\s*maps|ver\s+no\s+mapa|criar\s+rota/.test(txt)) {
      setTimeout(hideDuplicateMaps, 80);
      setTimeout(() => renderLatest(true), /criar\s+rota/.test(txt) ? 900 : 180);
    }
  }, false);

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){
      hideDuplicateMaps();
      ensureOriginField();
      setTimeout(injectPendencia, 800);
      setTimeout(() => renderLatest(true), 1000);
    });
  } else {
    hideDuplicateMaps();
    ensureOriginField();
    setTimeout(injectPendencia, 600);
    setTimeout(() => renderLatest(true), 900);
  }
  let cycles = 0;
  const timer = setInterval(() => {
    cycles++;
    hideDuplicateMaps();
    injectPendencia();
    if(routeViewActive()) renderLatest(false);
    if(cycles >= 8) clearInterval(timer);
  }, 900);

  window.vescoRoutesV13 = { drawRoute, ensureMap, hideDuplicateMaps, injectPendencia, getOrigin, looksLikeAddress, buildStops, findOrder, selectedPedidos };
  log('Rotas/Pendências V13 ativo — mapa único, origem inválida ignorada e Pendência garantida em Entregues.');
})();

// =================================================================
// CAMADA V14 — ADIÇÃO POR Nº VENDA/E-COM, RESPONSIVO, PDF DA ROTA,
// SCROLL EM MONTAR ROTAS E PRIORIDADE OPERACIONAL
// Regra de Preservação: camada aditiva; não remove funções legadas.
// =================================================================
(function installVescoOperationalRoutingV14(){
  if (window.__vescoOperationalRoutingV14) return;
  window.__vescoOperationalRoutingV14 = true;

  const MANUAL_ROUTE_KEY = 'vesco_route_manual_numbers_v14';
  const PRINT_LAST_ROUTE_KEY = 'vesco_last_print_route_v14';

  function log(){ try { console.log.apply(console, arguments); } catch(e) {} }
  function warn(){ try { console.warn.apply(console, arguments); } catch(e) {} }
  function toast(msg, typeOrMs, ms){
    try {
      if (typeof showToast === 'function') {
        if (typeof typeOrMs === 'string') return showToast(msg, typeOrMs, ms || 3500);
        return showToast(msg, typeOrMs || 3500);
      }
    } catch(e) {}
    log(msg);
  }
  function esc(v){
    try { return typeof escapeHtml === 'function' ? escapeHtml(v) : String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
    catch(e){ return String(v ?? ''); }
  }
  function stripAccents(v){
    return String(v || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  }
  function normText(v){ return stripAccents(v).toLowerCase().trim(); }
  function normOrder(v){
    try { return typeof normalizeOrderNumber === 'function' ? normalizeOrderNumber(v) : String(v ?? '').trim().replace(/^#/, '').replace(/\s+/g,''); }
    catch(e){ return String(v ?? '').trim().replace(/^#/, '').replace(/\s+/g,''); }
  }
  function normEcom(v){
    try { return typeof normalizeEcomNumber === 'function' ? normalizeEcomNumber(v) : String(v ?? '').replace(/\D/g,''); }
    catch(e){ return String(v ?? '').trim(); }
  }
  function allOrders(){
    const pools = [];
    try { if(typeof orders !== 'undefined' && Array.isArray(orders)) pools.push(...orders); } catch(e) {}
    try { if(typeof flexOrders !== 'undefined' && Array.isArray(flexOrders)) pools.push(...flexOrders); } catch(e) {}
    try { if(Array.isArray(window.orders)) pools.push(...window.orders); } catch(e) {}
    try { if(Array.isArray(window.flexOrders)) pools.push(...window.flexOrders); } catch(e) {}
    return Array.from(new Set(pools.filter(Boolean)));
  }
  function orderKeys(o){
    if(!o) return [];
    const vals = [
      o.id, o.numero, o.pedido, o.order_id, o.orderNumber, o.reference, o.referencia,
      o.numero_ecommerce, o.numero_ecom, o.ecom, o.ecom_id, o.codigo_externo, o.codigo,
      o.marketplace_order_id, o.merchant_order_id, o.external_id, o.external_reference
    ];
    const keys = [];
    vals.forEach(v => {
      if(v === undefined || v === null || String(v).trim() === '') return;
      const raw = String(v).trim();
      keys.push(raw, normOrder(raw), normEcom(raw));
    });
    return Array.from(new Set(keys.filter(Boolean)));
  }
  function findOrderByAnyNumber(value){
    const raw = String(value || '').trim().replace(/^#/, '');
    if(!raw) return null;
    const targets = new Set([raw, normOrder(raw), normEcom(raw)].filter(Boolean));
    return allOrders().find(o => orderKeys(o).some(k => targets.has(k))) || null;
  }
  function getClient(o){
    if(!o) return '';
    try { return extractClientNameFromAny(o) || o.cliente_nome || o.destinatario || o.cliente || o.nome || o.razao_social || ''; }
    catch(e){ return o.cliente_nome || o.destinatario || o.cliente || o.nome || o.razao_social || ''; }
  }
  function getAddress(o){
    if(!o) return '';
    return String(o.endereco_completo || o.endereco || o.address || o.full_address || o.logradouro || '').replace(/\s+/g,' ').trim();
  }
  function getMainNumber(o){ return o && String(o.numero || o.id || o.pedido || o.order_id || '').trim(); }
  function getEcomNumber(o){
    if(!o) return '';
    try { if(typeof getEcomNum === 'function') return getEcomNum(o) || ''; } catch(e) {}
    return String(o.numero_ecommerce || o.numero_ecom || o.ecom || o.reference || o.referencia || '').trim();
  }
  function getTransportText(o){
    if(!o) return '';
    const fields = [
      o.nomeformafenvio, o.nome_forma_envio, o.forma_envio, o.formaEnvio, o.forma_frete,
      o.forma_frete_nome, o.nome_transportadora, o.transportadora, o.transportador,
      o.nome_transportador, o.tipo_entrega, o.modalidade_entrega, o.shipping_method,
      o.logistica, o.frete, o.frete_por_conta, o.tipo_frete, o.servico_entrega
    ];
    return fields.filter(v => v !== undefined && v !== null && String(v).trim() !== '').map(v => String(v).trim()).join(' | ');
  }
  function getDateISO(o){
    const keys = ['data_prevista','data_previsao','previsao','data_prev','data_entrega','data','scheduled','eta','deliverydate'];
    for(const k of keys){
      const v = o && o[k];
      if(v !== undefined && v !== null && String(v).trim() !== '') {
        try { if(typeof dateValueToISO === 'function') { const iso = dateValueToISO(v); if(iso) return iso; } } catch(e) {}
        try { if(typeof parseAnyDateValue === 'function') { const d = parseAnyDateValue(v); if(d && !isNaN(d)) return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; } } catch(e) {}
      }
    }
    return '';
  }
  function classifyOrder(o){
    const transport = getTransportText(o);
    const combined = normText([
      transport,
      o && (o.prioridade || o.priority || o.emergencial || o.urgente || o.observacao_logistica || o.observacao || o.obs || o.tags || o.tag || o.status_logistica || o.situacao_nome || o.situacao || o.status || ''),
      o && o.alarme ? 'alarme' : ''
    ].join(' | '));
    const emergency = /(emergenc|urgenc|urgente|prioridade alta|prioritario|critico|alarme|expresso|imediato)/i.test(combined);
    const pickup = /(retirar pessoalmente|retirada|retirar|retira|retire|balcao|balcão|cliente retira|retirar na loja|retirada na loja|retirar pessoal)/i.test(combined);
    const dateISO = getDateISO(o);
    let rank = 3;
    let label = 'Entrega';
    let cls = 'bg-blue-50 text-blue-700 border-blue-100';
    if(pickup) { rank = 2; label = 'Retirada'; cls = 'bg-purple-50 text-purple-700 border-purple-100'; }
    if(emergency) { rank = 1; label = 'Emergencial'; cls = 'bg-red-50 text-red-700 border-red-100'; }
    return { rank, label, className: cls, transport: transport || 'Transportadora não informada', dateISO };
  }
  function compareOrders(a, b){
    const ca = classifyOrder(a), cb = classifyOrder(b);
    if(ca.rank !== cb.rank) return ca.rank - cb.rank;
    const da = ca.dateISO || '9999-12-31';
    const db = cb.dateISO || '9999-12-31';
    if(da !== db) return da.localeCompare(db);
    return String(getMainNumber(a)).localeCompare(String(getMainNumber(b)), 'pt-BR', { numeric: true });
  }
  function badgeHTML(o){
    const c = classifyOrder(o || {});
    const dateInfo = c.dateISO ? ` • ${esc(c.dateISO.split('-').reverse().join('/'))}` : '';
    return `
      <div class="vesco-priority-badges-v14 mt-1 flex flex-wrap gap-1 justify-end md:justify-start">
        <span class="inline-flex items-center px-2 py-0.5 rounded-lg border text-[10px] font-black ${c.className}">${esc(c.label)}${dateInfo}</span>
        <span class="inline-flex items-center px-2 py-0.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-600 text-[10px] font-bold">${esc(c.transport)}</span>
      </div>`;
  }

  function readManualNumbers(){
    try { return JSON.parse(localStorage.getItem(MANUAL_ROUTE_KEY) || '[]') || []; } catch(e) { return []; }
  }
  function writeManualNumbers(list){
    try { localStorage.setItem(MANUAL_ROUTE_KEY, JSON.stringify(Array.from(new Set((list || []).map(normOrder).filter(Boolean))))); } catch(e) {}
  }
  function selectedNumbersFromDOM(){
    const selectors = [
      '#view-saiu input[type="checkbox"]:checked',
      '#saiu-pedidos-list input[type="checkbox"]:checked',
      '#saiu-rota-selected input[type="checkbox"]:checked',
      '#view-rotas input[type="checkbox"]:checked',
      '#table-rotas input[type="checkbox"]:checked'
    ];
    const out = [];
    Array.from(new Set(selectors.flatMap(s => Array.from(document.querySelectorAll(s))))).forEach(cb => {
      let v = cb.getAttribute('data-num') || cb.getAttribute('data-ecom') || cb.getAttribute('data-pedido') || cb.value || '';
      if(!v || v === 'on') {
        const row = cb.closest('tr') || cb.closest('.pedido-item') || cb.closest('[data-num]') || cb.parentElement;
        v = row && (row.getAttribute('data-num') || row.getAttribute('data-ecom') || row.getAttribute('data-pedido')) || '';
        if(!v && row) {
          const txt = row.innerText || '';
          const m = txt.match(/#\s*([0-9A-Za-z._-]{4,})/) || txt.match(/\b(\d{5,})\b/);
          if(m) v = m[1];
        }
      }
      v = normOrder(v);
      if(v) out.push(v);
    });
    return Array.from(new Set(out));
  }
  function allRouteSelectedNumbers(){
    return Array.from(new Set([...(window.rotaTemp && Array.isArray(window.rotaTemp.pedidos) ? window.rotaTemp.pedidos : []), ...readManualNumbers(), ...selectedNumbersFromDOM()].map(normOrder).filter(Boolean)));
  }
  function syncHiddenManualInputs(){
    const box = document.getElementById('saiu-rota-selected');
    if(!box) return;
    box.querySelectorAll('.vesco-manual-route-hidden-v14').forEach(el => el.remove());
    allRouteSelectedNumbers().forEach(n => {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = true;
      input.setAttribute('data-num', n);
      input.value = n;
      input.className = 'vesco-manual-route-hidden-v14';
      input.style.display = 'none';
      box.appendChild(input);
    });
  }
  function renderSelectedBox(){
    const box = document.getElementById('saiu-rota-selected');
    if(!box) return;
    const nums = allRouteSelectedNumbers();
    if(!nums.length) {
      box.innerHTML = `<div class="p-2 text-slate-500 text-sm">Nenhum pedido selecionado.</div>`;
      return;
    }
    box.innerHTML = nums.map(n => {
      const o = findOrderByAnyNumber(n);
      return `
        <div class="vesco-selected-route-item-v14 flex justify-between items-start p-2 bg-blue-50 mb-1 rounded border border-blue-100 text-xs" data-num="${esc(n)}">
          <div class="pr-2">
            <div class="font-black">#${esc(getMainNumber(o) || n)}${getEcomNumber(o) ? ` <span class="text-slate-400 font-bold">E-com: ${esc(getEcomNumber(o))}</span>` : ''}</div>
            <div class="text-slate-600 font-semibold">${esc(getClient(o) || 'Pedido adicionado manualmente')}</div>
            <div class="text-slate-500">${esc(getAddress(o) || 'Endereço será localizado pelo número informado')}</div>
            ${badgeHTML(o || {})}
          </div>
          <button type="button" class="text-red-500 font-black px-2" onclick="window.vescoRouteV14.removeManual('${esc(n)}')">×</button>
        </div>`;
    }).join('');
    syncHiddenManualInputs();
  }
  function ensureAddByNumberUI(){
    const view = document.getElementById('view-saiu');
    if(!view || document.getElementById('vesco-add-route-number-v14')) return;
    const target = view.querySelector('#saiu-pedidos-list') || view.querySelector('.card');
    if(!target) return;
    const wrap = document.createElement('div');
    wrap.id = 'vesco-add-route-number-v14';
    wrap.className = 'mb-3 p-3 rounded-xl border border-blue-100 bg-blue-50/70';
    wrap.innerHTML = `
      <label class="block text-xs font-black text-blue-800 mb-1">Adicionar na rota por número da venda ou E-commerce</label>
      <div class="flex flex-col sm:flex-row gap-2">
        <input id="vesco-route-number-input-v14" class="flex-1 bg-white border border-blue-200 rounded-lg px-3 py-2 text-sm font-bold outline-none focus:border-blue-500" placeholder="Digite o nº do pedido, venda ou e-commerce">
        <button type="button" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-black text-sm" onclick="window.vescoRouteV14.addByNumber()"><i class="fas fa-plus mr-1"></i>Adicionar</button>
      </div>
      <div class="text-[11px] text-blue-700 mt-1 font-semibold">Use quando o pedido não aparecer na lista, mas você já tem o número da venda ou do e-commerce.</div>`;
    target.parentElement.insertBefore(wrap, target);
    const input = document.getElementById('vesco-route-number-input-v14');
    if(input) input.addEventListener('keydown', e => { if(e.key === 'Enter') { e.preventDefault(); window.vescoRouteV14.addByNumber(); } });
  }

  function addByNumber(value){
    const input = document.getElementById('vesco-route-number-input-v14');
    const raw = String(value || (input && input.value) || '').trim();
    if(!raw) return alert('Digite o número da venda, pedido ou e-commerce.');
    const order = findOrderByAnyNumber(raw);
    const num = normOrder(order ? (getMainNumber(order) || raw) : raw);
    const manual = readManualNumbers();
    if(!manual.includes(num)) manual.push(num);
    writeManualNumbers(manual);
    window.rotaTemp = window.rotaTemp || { pedidos: [] };
    window.rotaTemp.pedidos = Array.from(new Set([...(window.rotaTemp.pedidos || []), num]));

    // Se existir checkbox do pedido na lista, marca também para preservar fluxo legado.
    const cb = Array.from(document.querySelectorAll('#saiu-pedidos-list input[type="checkbox"], #view-saiu input[type="checkbox"]')).find(input => {
      const keys = [input.getAttribute('data-num'), input.getAttribute('data-ecom'), input.value].map(normOrder);
      return keys.includes(num) || (order && keys.some(k => orderKeys(order).map(normOrder).includes(k)));
    });
    if(cb) cb.checked = true;
    if(input) input.value = '';
    renderSelectedBox();
    applyPriorityToRows();
    toast(order ? `Pedido #${getMainNumber(order)} adicionado à rota.` : `Número ${raw} adicionado à rota manualmente.`, 'success', 3000);
  }
  function removeManual(n){
    const key = normOrder(n);
    writeManualNumbers(readManualNumbers().filter(x => normOrder(x) !== key));
    if(window.rotaTemp && Array.isArray(window.rotaTemp.pedidos)) window.rotaTemp.pedidos = window.rotaTemp.pedidos.filter(x => normOrder(x) !== key);
    Array.from(document.querySelectorAll(`#view-saiu input[type="checkbox"]`)).forEach(cb => {
      const val = normOrder(cb.getAttribute('data-num') || cb.getAttribute('data-ecom') || cb.value);
      if(val === key) cb.checked = false;
    });
    renderSelectedBox();
  }

  function installResponsiveCss(){
    if(document.getElementById('vesco-responsive-priority-style-v14')) return;
    const st = document.createElement('style');
    st.id = 'vesco-responsive-priority-style-v14';
    st.textContent = `
      html, body { max-width: 100%; overflow-x: hidden; }
      .vesco-scroll-y-v14 { overflow-y: auto !important; -webkit-overflow-scrolling: touch; }
      #view-rotas .card:first-child .overflow-x-auto,
      #view-rotas .card:first-child [id="table-rotas"] { scroll-behavior: smooth; }
      #view-rotas .card:first-child .overflow-x-auto { max-height: calc(100vh - 245px); overflow-y: auto !important; }
      #view-saiu #saiu-pedidos-list, #view-saiu #saiu-rota-selected { max-height: calc(100vh - 360px) !important; overflow-y: auto !important; }
      .vesco-priority-row-1 { box-shadow: inset 4px 0 0 #ef4444; }
      .vesco-priority-row-2 { box-shadow: inset 4px 0 0 #8b5cf6; }
      .vesco-priority-row-3 { box-shadow: inset 4px 0 0 #3b82f6; }
      @media (max-width: 1024px) {
        header { position: relative; }
        .tab-nav { position: sticky; top: 0; z-index: 40; overflow: hidden; }
        .tab-nav > div:first-child { width: 100%; overflow-x: auto; padding-bottom: 6px; }
        .tab-btn { min-height: 40px; padding: 0 12px !important; font-size: 12px !important; }
        main { padding: 10px !important; max-width: 100% !important; }
        #view-saiu { padding: 10px !important; }
        #view-saiu .grid, #view-rotas .grid, #view-logistica .grid, #view-envios_flex .grid { grid-template-columns: 1fr !important; }
        #view-rotas .card, #view-logistica .card, #view-envios_flex .card, #view-saiu .card { min-height: auto !important; width: 100% !important; }
        #map, #map-flex, #map-rotas, #vesco-route-map-v6, #vesco-route-map-v12, #vesco-route-map-v13 { height: 330px !important; min-height: 330px !important; }
        table { min-width: 720px; }
        .overflow-x-auto { overflow-x: auto !important; -webkit-overflow-scrolling: touch; }
      }
      @media (max-width: 640px) {
        header { padding: 10px !important; }
        header > div { width: 100%; }
        .tab-nav { padding: 6px !important; }
        .tab-btn { font-size: 11px !important; min-width: max-content; }
        #search { width: 100%; }
        #view-saiu .card, #view-rotas .card, .card { border-radius: 14px !important; padding: 10px !important; }
        #view-saiu #saiu-pedidos-list, #view-saiu #saiu-rota-selected { max-height: 320px !important; }
        #view-rotas .card:first-child .overflow-x-auto { max-height: 460px; }
        #map, #map-flex, #map-rotas, #vesco-route-map-v6, #vesco-route-map-v12, #vesco-route-map-v13 { height: 300px !important; min-height: 300px !important; }
        .summary-box { position: static !important; width: 100% !important; margin-top: 8px; }
        .map-toolbar { transform: scale(.9); transform-origin: top right; }
      }
      @media print {
        body * { visibility: hidden !important; }
        #vesco-print-area-v14, #vesco-print-area-v14 * { visibility: visible !important; }
        #vesco-print-area-v14 { position: absolute; left: 0; top: 0; width: 100%; }
      }
    `;
    document.head.appendChild(st);
  }

  function keyFromRow(row){
    if(!row) return '';
    const attrs = [row.getAttribute('data-num'), row.getAttribute('data-ecom'), row.getAttribute('data-pedido')].filter(Boolean);
    if(attrs.length) return attrs[0];
    const txt = row.innerText || '';
    const m = txt.match(/#\s*([0-9A-Za-z._-]{4,})/) || txt.match(/\b(\d{5,})\b/);
    return m ? m[1] : '';
  }
  function applyPriorityToRows(){
    const rowSelectors = ['#table-rotas tr', '#saiu-pedidos-list .pedido-item', '#table-logistica tr', '#table-envios-flex-corpo tr'];
    rowSelectors.forEach(sel => {
      const rows = Array.from(document.querySelectorAll(sel));
      rows.forEach(row => {
        const key = keyFromRow(row);
        const o = findOrderByAnyNumber(key);
        if(!o || row.querySelector('.vesco-priority-badges-v14')) return;
        const c = classifyOrder(o);
        row.classList.remove('vesco-priority-row-1','vesco-priority-row-2','vesco-priority-row-3');
        row.classList.add(`vesco-priority-row-${c.rank}`);
        row.setAttribute('data-priority-rank-v14', String(c.rank));
        row.setAttribute('data-priority-date-v14', c.dateISO || '9999-12-31');
        const target = row.querySelector('td:last-child') || row.querySelector('.flex-1') || row;
        if(target) target.insertAdjacentHTML('beforeend', badgeHTML(o));
      });
    });
    sortRowsByPriority('#table-rotas');
    sortRowsByPriority('#saiu-pedidos-list', '.pedido-item');
  }
  function sortRowsByPriority(containerSelector, itemSelector){
    const container = document.querySelector(containerSelector);
    if(!container) return;
    const rows = Array.from(itemSelector ? container.querySelectorAll(itemSelector) : container.children).filter(el => el && el.nodeType === 1);
    if(rows.length < 2) return;
    rows.sort((ra, rb) => {
      const oa = findOrderByAnyNumber(keyFromRow(ra));
      const ob = findOrderByAnyNumber(keyFromRow(rb));
      if(!oa && !ob) return 0;
      if(!oa) return 1;
      if(!ob) return -1;
      return compareOrders(oa, ob);
    });
    rows.forEach(r => container.appendChild(r));
  }

  function getRouteById(id){
    try { if(window.vescoRoutesV13 && typeof window.vescoRoutesV13.findRouteById === 'function') { const r = window.vescoRoutesV13.findRouteById(id); if(r) return r; } } catch(e) {}
    try { if(window.vescoRoutesV6 && typeof window.vescoRoutesV6.findRouteById === 'function') { const r = window.vescoRoutesV6.findRouteById(id); if(r) return r; } } catch(e) {}
    return (window.saiuRotas || []).find(r => String(r.id) === String(id)) || null;
  }
  function buildRouteStops(route){
    const origin = route && (route.origem || route.origin || '');
    const stops = [];
    if(origin) stops.push({ tipo: 'Partida', numero: 'Partida', cliente: 'Ponto de partida', endereco: origin, priority: { label: 'Origem', transport: '' } });
    (route && route.pedidos || []).forEach((n, idx) => {
      const o = findOrderByAnyNumber(n);
      const c = classifyOrder(o || {});
      stops.push({
        tipo: 'Parada ' + (idx + 1),
        numero: getMainNumber(o) || n,
        ecom: getEcomNumber(o),
        cliente: getClient(o),
        endereco: getAddress(o),
        priority: c
      });
    });
    return stops;
  }
  function printRoute(id){
    const route = getRouteById(id) || JSON.parse(localStorage.getItem(PRINT_LAST_ROUTE_KEY) || 'null');
    if(!route) return alert('Rota não encontrada para impressão.');
    try { localStorage.setItem(PRINT_LAST_ROUTE_KEY, JSON.stringify(route)); } catch(e) {}
    const stops = buildRouteStops(route);
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Rota ${esc(route.nome || '')}</title>
      <style>
        body{font-family:Arial,sans-serif;color:#0f172a;margin:24px} h1{font-size:22px;margin:0 0 8px}.meta{font-size:12px;color:#475569;margin-bottom:16px}.tag{display:inline-block;border:1px solid #cbd5e1;border-radius:999px;padding:3px 8px;font-size:11px;font-weight:700;margin-right:4px}table{width:100%;border-collapse:collapse;font-size:12px}th{background:#0f172a;color:white;text-align:left;padding:8px}td{border-bottom:1px solid #e2e8f0;padding:8px;vertical-align:top}.small{font-size:10px;color:#64748b}.route-title{border:1px solid #e2e8f0;border-radius:12px;padding:12px;margin-bottom:14px;background:#f8fafc}@page{size:A4;margin:12mm}
      </style></head><body><div id="vesco-print-area-v14">
        <div class="route-title"><h1>${esc(route.nome || 'Rota')}</h1><div class="meta"><b>Motorista:</b> ${esc(route.motorista || '—')} &nbsp; <b>Pedidos:</b> ${(route.pedidos || []).length} &nbsp; <b>Gerado:</b> ${new Date().toLocaleString('pt-BR')}</div></div>
        <table><thead><tr><th>#</th><th>Tipo</th><th>Pedido</th><th>Cliente</th><th>Endereço</th><th>Prioridade / Transporte</th></tr></thead><tbody>
          ${stops.map((s,i)=>`<tr><td>${i+1}</td><td><b>${esc(s.tipo)}</b></td><td><b>${esc(s.numero)}</b>${s.ecom?`<div class="small">E-com: ${esc(s.ecom)}</div>`:''}</td><td>${esc(s.cliente || '—')}</td><td>${esc(s.endereco || '—')}</td><td><span class="tag">${esc(s.priority.label || '—')}</span><div class="small">${esc(s.priority.transport || '')}</div></td></tr>`).join('')}
        </tbody></table></div><script>window.onload=function(){setTimeout(function(){window.print();},300)}<\/script></body></html>`;
    const w = window.open('', '_blank');
    if(!w) return alert('O navegador bloqueou a janela de impressão. Libere pop-ups para gerar o PDF.');
    w.document.open();
    w.document.write(html);
    w.document.close();
  }
  function injectPrintButtons(){
    const list = document.getElementById('saiu-rotas-list');
    if(!list) return;
    Array.from(list.children || []).forEach(card => {
      if(card.querySelector('.vesco-print-route-btn-v14')) return;
      const html = card.innerHTML || '';
      const m = html.match(/['"](rota-[^'"]+)['"]/i) || html.match(/['"]([^'"]*\d{10,}[^'"]*)['"]/i);
      const id = m && m[1];
      if(!id) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vesco-print-route-btn-v14 bg-slate-800 text-white px-3 py-1 rounded text-xs font-bold ml-2';
      btn.innerHTML = '<i class="fas fa-print mr-1"></i>Imprimir PDF';
      btn.onclick = () => printRoute(id);
      const target = card.querySelector('.vesco-route-v4-actions, .vesco-route-v13-actions') || card.querySelector('div:last-child') || card;
      target.appendChild(btn);
    });
  }

  function enhanceRouteMapScroll(){
    const tableWrap = document.querySelector('#view-rotas .card:first-child .overflow-x-auto');
    if(tableWrap) tableWrap.classList.add('vesco-scroll-y-v14');
    const saiuList = document.getElementById('saiu-pedidos-list');
    if(saiuList) saiuList.classList.add('vesco-scroll-y-v14');
    const selected = document.getElementById('saiu-rota-selected');
    if(selected) selected.classList.add('vesco-scroll-y-v14');
  }

  function hardGeocodeGuard(){
    const previousPlot = window.plotMapMarkers || (typeof plotMapMarkers === 'function' ? plotMapMarkers : null);
    if(previousPlot && !window.__vescoPlotMapMarkersV14Final){
      window.__vescoPlotMapMarkersV14Final = true;
      window.plotMapMarkers = plotMapMarkers = function(orderList, flexList){
        const canPlot = !!document.querySelector('#view-logistica:not(.hidden), #view-envios_flex:not(.hidden)');
        if(!canPlot) return;
        return previousPlot.apply(this, arguments);
      };
    }
    const previousGeo = window.geocodeAddress || (typeof geocodeAddress === 'function' ? geocodeAddress : null);
    if(previousGeo && !window.__vescoGeocodeAddressV14Final){
      window.__vescoGeocodeAddressV14Final = true;
      window.geocodeAddress = geocodeAddress = function(address){
        const txt = String(address || '').trim();
        const activeRoute = !!document.querySelector('#view-saiu:not(.hidden), #view-rotas:not(.hidden), #view-logistica:not(.hidden), #view-envios_flex:not(.hidden)');
        const looksLikeAddress = /\b(rua|av\.?|avenida|alameda|travessa|rodovia|estrada|praça|praca|largo|via)\b/i.test(stripAccents(txt)) && /\d/.test(txt);
        if(!activeRoute || !looksLikeAddress) return Promise.resolve(null);
        return previousGeo.apply(this, arguments);
      };
    }
  }

  function applyAll(){
    installResponsiveCss();
    hardGeocodeGuard();
    ensureAddByNumberUI();
    renderSelectedBox();
    applyPriorityToRows();
    injectPrintButtons();
    enhanceRouteMapScroll();
  }

  window.vescoRouteV14 = {
    addByNumber,
    removeManual,
    findOrderByAnyNumber,
    classifyOrder,
    printRoute,
    applyPriorityToRows,
    renderSelectedBox,
    allRouteSelectedNumbers
  };

  const oldRender = window.render || (typeof render === 'function' ? render : null);
  if(oldRender && !window.__vescoRenderV14Wrapped){
    window.__vescoRenderV14Wrapped = true;
    window.render = render = function(){
      const ret = oldRender.apply(this, arguments);
      setTimeout(applyAll, 120);
      setTimeout(applyAll, 600);
      return ret;
    };
  }
  const oldSwitch = window.switchTab;
  if(typeof oldSwitch === 'function' && !window.__vescoSwitchV14Wrapped){
    window.__vescoSwitchV14Wrapped = true;
    window.switchTab = function(which){
      const ret = oldSwitch.apply(this, arguments);
      setTimeout(applyAll, 160);
      setTimeout(applyAll, 700);
      return ret;
    };
  }
  const oldRenderSelected = window.renderSelectedTemp;
  if(typeof oldRenderSelected === 'function' && !window.__vescoRenderSelectedV14Wrapped){
    window.__vescoRenderSelectedV14Wrapped = true;
    window.renderSelectedTemp = function(){
      const ret = oldRenderSelected.apply(this, arguments);
      setTimeout(renderSelectedBox, 50);
      return ret;
    };
  }

  document.addEventListener('change', function(e){
    if(e.target && e.target.matches && e.target.matches('#view-saiu input[type="checkbox"], #view-rotas input[type="checkbox"]')) {
      setTimeout(() => { renderSelectedBox(); applyPriorityToRows(); }, 60);
    }
  }, true);
  document.addEventListener('click', function(e){
    const btn = e.target && e.target.closest && e.target.closest('button, a, [role="button"], input[type="button"], input[type="submit"]');
    if(!btn) return;
    const text = `${btn.textContent || ''} ${btn.id || ''} ${btn.getAttribute('onclick') || ''}`;
    if(/criar\s+rota|marcar todos|limpar|sugerir rotas|tra[cç]ar rota|google maps|ver no mapa/i.test(text)) {
      setTimeout(applyAll, 200);
      setTimeout(applyAll, 1200);
    }
  }, true);

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(applyAll, 700));
  else setTimeout(applyAll, 300);
  let cycles = 0;
  const timer = setInterval(() => {
    cycles++;
    applyAll();
    if(cycles >= 10) clearInterval(timer);
  }, 1000);

  log('V14 ativo — adicionar por venda/e-commerce, responsivo, PDF de rota, scroll e prioridade operacional.');
})();

// =================================================================
// CAMADA V15 — INTEGRAÇÃO FORMASENVIO + PRIORIDADE OPERACIONAL
// Objetivo: puxar a aba FormasEnvio do Apps Script (?action=formasEnvio),
// enriquecer pedidos com transportadora/forma de envio e ordenar listas por:
// 1) Emergencial  2) Retirada  3) Entrega por data prevista.
// Regra de Preservação: camada aditiva; não remove funções legadas.
// =================================================================
(function installVescoFormasEnvioPriorityV15(){
  if (window.__vescoFormasEnvioPriorityV15) return;
  window.__vescoFormasEnvioPriorityV15 = true;

  const CACHE_KEY = 'vesco_formas_envio_cache_v15';
  const CACHE_TS_KEY = 'vesco_formas_envio_cache_ts_v15';
  const CACHE_TTL_MS = 10 * 60 * 1000;

  const FALLBACK_FORMAS = [
    { id_forma_envio:'747632293', forma_envio_nome:'Correios', tipo_operacional:'Entrega', prioridade_operacional:3, prioridade_label:'3 - Entrega', eh_retirada:'NÃO', canal_logistico:'Correios', ativo:'SIM' },
    { id_forma_envio:'747632297', forma_envio_nome:'Transportadora', tipo_operacional:'Entrega', prioridade_operacional:3, prioridade_label:'3 - Entrega', eh_retirada:'NÃO', canal_logistico:'Transportadora', ativo:'SIM' },
    { id_forma_envio:'747632298', forma_envio_nome:'Retirar pessoalmente', tipo_operacional:'Retirada', prioridade_operacional:2, prioridade_label:'2 - Retirada', eh_retirada:'SIM', canal_logistico:'Retirada', ativo:'SIM' },
    { id_forma_envio:'769570519', forma_envio_nome:'Mercado Envios', tipo_operacional:'Entrega', prioridade_operacional:3, prioridade_label:'3 - Entrega', eh_retirada:'NÃO', canal_logistico:'Mercado Envios', ativo:'SIM' },
    { id_forma_envio:'778029845', forma_envio_nome:'Shopee Envios', tipo_operacional:'Entrega', prioridade_operacional:3, prioridade_label:'3 - Entrega', eh_retirada:'NÃO', canal_logistico:'Shopee Envios', ativo:'SIM' },
    { id_forma_envio:'780391986', forma_envio_nome:'Mercado Envios Flex', tipo_operacional:'Entrega', prioridade_operacional:3, prioridade_label:'3 - Entrega', eh_retirada:'NÃO', canal_logistico:'Mercado Envios Flex', ativo:'SIM' },
    { id_forma_envio:'849173976', forma_envio_nome:'Amazon DBA', tipo_operacional:'Entrega', prioridade_operacional:3, prioridade_label:'3 - Entrega', eh_retirada:'NÃO', canal_logistico:'Amazon DBA', ativo:'SIM' },
    { id_forma_envio:'850044775', forma_envio_nome:'Magalu Entregas', tipo_operacional:'Entrega', prioridade_operacional:3, prioridade_label:'3 - Entrega', eh_retirada:'NÃO', canal_logistico:'Magalu Entregas', ativo:'SIM' },
    { id_forma_envio:'852535843', forma_envio_nome:'Loggi', tipo_operacional:'Entrega', prioridade_operacional:3, prioridade_label:'3 - Entrega', eh_retirada:'NÃO', canal_logistico:'Loggi', ativo:'SIM' },
    { id_forma_envio:'854284026', forma_envio_nome:'TikTok Shipping', tipo_operacional:'Entrega', prioridade_operacional:3, prioridade_label:'3 - Entrega', eh_retirada:'NÃO', canal_logistico:'TikTok Shipping', ativo:'SIM' },
    { id_forma_envio:'860463094', forma_envio_nome:'RETIRADA', tipo_operacional:'Retirada', prioridade_operacional:2, prioridade_label:'2 - Retirada', eh_retirada:'SIM', canal_logistico:'Retirada', ativo:'SIM' }
  ];

  function log(){ try { console.log.apply(console, arguments); } catch(e) {} }
  function warn(){ try { console.warn.apply(console, arguments); } catch(e) {} }
  function toast(msg, typeOrMs, ms){
    try {
      if (typeof showToast === 'function') {
        if (typeof typeOrMs === 'string') return showToast(msg, typeOrMs, ms || 3500);
        return showToast(msg, typeOrMs || 3500);
      }
    } catch(e) {}
    log(msg);
  }
  function esc(v){
    try { return typeof escapeHtml === 'function' ? escapeHtml(v) : String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
    catch(e){ return String(v ?? ''); }
  }
  function strip(v){ return String(v || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); }
  function norm(v){ return strip(v).toLowerCase().replace(/\s+/g, ' ').trim(); }
  function normCompact(v){ return norm(v).replace(/[^a-z0-9]/g, ''); }
  function normId(v){ return String(v ?? '').replace(/\D/g, '').trim(); }
  function normOrder(v){
    try { return typeof normalizeOrderNumber === 'function' ? normalizeOrderNumber(v) : String(v ?? '').trim().replace(/^#/, '').replace(/\s+/g,''); }
    catch(e){ return String(v ?? '').trim().replace(/^#/, '').replace(/\s+/g,''); }
  }
  function normEcom(v){
    try { return typeof normalizeEcomNumber === 'function' ? normalizeEcomNumber(v) : String(v ?? '').replace(/\D/g,''); }
    catch(e){ return String(v ?? '').trim(); }
  }
  function apiBase(){
    try { if (typeof API !== 'undefined' && API) return API; } catch(e) {}
    return window.API || '';
  }
  function appendParams(url, params){
    try { if (typeof appendQueryParamsSafe === 'function') return appendQueryParamsSafe(url, params); } catch(e) {}
    let out = String(url || '');
    Object.keys(params || {}).forEach(k => {
      const v = params[k];
      if(v === undefined || v === null || String(v).trim() === '') return;
      out += (out.includes('?') ? '&' : '?') + encodeURIComponent(k) + '=' + encodeURIComponent(v);
    });
    return out;
  }
  function jsonp(url, timeoutMs){
    return new Promise((resolve, reject) => {
      if(typeof jsonpFetch === 'function') {
        return jsonpFetch(url, (err, res) => err ? reject(err) : resolve(res));
      }
      const cbName = '__vesco_formas_envio_cb_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      const timer = setTimeout(() => {
        try { delete window[cbName]; } catch(e) {}
        if(script.parentNode) script.parentNode.removeChild(script);
        reject(new Error('timeout'));
      }, timeoutMs || 12000);
      window[cbName] = function(res){
        clearTimeout(timer);
        try { delete window[cbName]; } catch(e) {}
        if(script.parentNode) script.parentNode.removeChild(script);
        resolve(res);
      };
      script.onerror = function(){
        clearTimeout(timer);
        try { delete window[cbName]; } catch(e) {}
        if(script.parentNode) script.parentNode.removeChild(script);
        reject(new Error('script_error'));
      };
      script.src = appendParams(url, { callback: cbName });
      document.head.appendChild(script);
    });
  }
  function activeOnly(list){
    return (list || []).filter(f => !/^n(a|ã)o$/i.test(String(f.ativo || '').trim()));
  }
  function buildIndex(list){
    const byId = {};
    const byName = {};
    activeOnly(list).forEach(raw => {
      const f = Object.assign({}, raw);
      f.id_forma_envio = normId(f.id_forma_envio || f.id || f.codigo || f.value || f.idFormaEnvio || f.idFormaEnvioPsq);
      f.forma_envio_nome = String(f.forma_envio_nome || f.nome || f.name || f.label || '').trim();
      f.tipo_operacional = String(f.tipo_operacional || '').trim() || (/retir/i.test(f.forma_envio_nome) ? 'Retirada' : 'Entrega');
      f.prioridade_operacional = Number(f.prioridade_operacional || (/retir/i.test(f.tipo_operacional) ? 2 : 3));
      f.prioridade_label = String(f.prioridade_label || `${f.prioridade_operacional} - ${f.tipo_operacional}`).trim();
      f.eh_retirada = String(f.eh_retirada || (/retir/i.test(f.tipo_operacional + ' ' + f.forma_envio_nome) ? 'SIM' : 'NÃO')).toUpperCase();
      f.canal_logistico = String(f.canal_logistico || f.forma_envio_nome || '').trim();
      if(f.id_forma_envio) byId[f.id_forma_envio] = f;
      const nameKey = normCompact(f.forma_envio_nome);
      if(nameKey) byName[nameKey] = f;
      const canalKey = normCompact(f.canal_logistico);
      if(canalKey) byName[canalKey] = f;
    });
    return { list: activeOnly(list), byId, byName };
  }
  function setFormasEnvio(list, source){
    const safeList = Array.isArray(list) && list.length ? list : FALLBACK_FORMAS;
    const index = buildIndex(safeList);
    window.vescoFormasEnvioV15 = Object.assign(index, { source: source || 'unknown', loadedAt: new Date().toISOString() });
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(safeList)); localStorage.setItem(CACHE_TS_KEY, String(Date.now())); } catch(e) {}
    enrichAllOrders();
    setTimeout(applyPriorityUI, 80);
    return window.vescoFormasEnvioV15;
  }
  function readCache(){
    try {
      const ts = Number(localStorage.getItem(CACHE_TS_KEY) || 0);
      const list = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
      if(Array.isArray(list) && list.length && (Date.now() - ts) < CACHE_TTL_MS) return list;
    } catch(e) {}
    return null;
  }

  let fetchPromise = null;
  function carregarFormasEnvio(force){
    if(fetchPromise && !force) return fetchPromise;
    const cached = !force ? readCache() : null;
    if(cached) {
      setFormasEnvio(cached, 'cache');
      return Promise.resolve(window.vescoFormasEnvioV15);
    }
    const url = appendParams(apiBase(), { action: 'formasEnvio' });
    if(!url) {
      setFormasEnvio(FALLBACK_FORMAS, 'fallback_sem_api');
      return Promise.resolve(window.vescoFormasEnvioV15);
    }
    fetchPromise = jsonp(url, 12000).then(resp => {
      const list = resp && (resp.formasEnvio || resp.formas_envio || resp.data || resp.items || resp.list);
      if(Array.isArray(list) && list.length) return setFormasEnvio(list, 'api');
      warn('FormasEnvio V15: API respondeu sem lista válida. Usando fallback.', resp);
      return setFormasEnvio(FALLBACK_FORMAS, 'fallback_resposta_invalida');
    }).catch(err => {
      warn('FormasEnvio V15: falha ao carregar do Apps Script. Usando fallback.', err);
      return setFormasEnvio(FALLBACK_FORMAS, 'fallback_erro');
    }).finally(() => { setTimeout(() => { fetchPromise = null; }, 500); });
    return fetchPromise;
  }

  function allOrders(){
    const pools = [];
    try { if(typeof orders !== 'undefined' && Array.isArray(orders)) pools.push(...orders); } catch(e) {}
    try { if(typeof flexOrders !== 'undefined' && Array.isArray(flexOrders)) pools.push(...flexOrders); } catch(e) {}
    try { if(Array.isArray(window.orders)) pools.push(...window.orders); } catch(e) {}
    try { if(Array.isArray(window.flexOrders)) pools.push(...window.flexOrders); } catch(e) {}
    return Array.from(new Set(pools.filter(Boolean)));
  }
  function orderKeys(o){
    if(!o) return [];
    const vals = [o.id, o.numero, o.pedido, o.order_id, o.orderNumber, o.reference, o.referencia, o.numero_ecommerce, o.numero_ecom, o.ecom, o.ecom_id, o.codigo_externo, o.codigo, o.marketplace_order_id, o.merchant_order_id, o.external_id, o.external_reference];
    const keys = [];
    vals.forEach(v => {
      if(v === undefined || v === null || String(v).trim() === '') return;
      const raw = String(v).trim();
      keys.push(raw, normOrder(raw), normEcom(raw));
    });
    return Array.from(new Set(keys.filter(Boolean)));
  }
  function findOrderByAnyNumber(value){
    const raw = String(value || '').trim().replace(/^#/, '');
    if(!raw) return null;
    const targets = new Set([raw, normOrder(raw), normEcom(raw)].filter(Boolean));
    return allOrders().find(o => orderKeys(o).some(k => targets.has(k))) || null;
  }
  function firstValue(o, keys){
    if(!o) return '';
    for(const k of keys){
      if(o[k] !== undefined && o[k] !== null && String(o[k]).trim() !== '') return String(o[k]).trim();
    }
    return '';
  }
  function getFormaId(o){
    return normId(firstValue(o, ['id_forma_envio','idFormaEnvio','idFormaEnvioPsq','id_forma_envio_psq','forma_envio_id','formaEnvioId','idFormaFrete','id_forma_frete','codigo_forma_envio','codigo_envio']));
  }
  function getFormaNameRaw(o){
    return firstValue(o, ['forma_envio_nome','nome_forma_envio','nomeformafenvio','forma_envio','formaEnvio','transportadora','transportador','nome_transportadora','nome_transportador','forma_frete','forma_frete_nome','modalidade_entrega','shipping_method','servico_entrega','tipo_entrega']);
  }
  function findFormaInfo(o){
    const idx = window.vescoFormasEnvioV15 || buildIndex(FALLBACK_FORMAS);
    const id = getFormaId(o);
    if(id && idx.byId && idx.byId[id]) return idx.byId[id];

    const rawName = getFormaNameRaw(o);
    const pieces = String(rawName || '').split('|').map(s => normCompact(s)).filter(Boolean);
    if(idx.byName) {
      for(const p of pieces){ if(idx.byName[p]) return idx.byName[p]; }
      const compactAll = normCompact(rawName);
      if(compactAll && idx.byName[compactAll]) return idx.byName[compactAll];
      const candidates = Object.keys(idx.byName);
      const foundKey = candidates.find(k => compactAll && (compactAll.includes(k) || k.includes(compactAll)));
      if(foundKey) return idx.byName[foundKey];
    }

    const lower = norm(rawName + ' ' + firstValue(o, ['observacoes_tiny','observacoes_internas','observacao_logistica','observacao','observacoes']));
    if(/retirar pessoalmente|retirada|retirar|retira/.test(lower)) return buildIndex(FALLBACK_FORMAS).byId['747632298'];
    return null;
  }
  function getDateISO(o){
    const keys = ['data_prevista','data_previsao','previsao','data_prev','data_entrega','data','scheduled','eta','deliverydate'];
    for(const k of keys){
      const v = o && o[k];
      if(v !== undefined && v !== null && String(v).trim() !== '') {
        try { if(typeof dateValueToISO === 'function') { const iso = dateValueToISO(v); if(iso) return iso; } } catch(e) {}
        try { if(typeof parseAnyDateValue === 'function') { const d = parseAnyDateValue(v); if(d && !isNaN(d)) return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; } } catch(e) {}
      }
    }
    return '';
  }
  function classifyOrder(o){
    const formaInfo = findFormaInfo(o) || {};
    const text = norm([
      getFormaId(o), getFormaNameRaw(o),
      formaInfo.forma_envio_nome, formaInfo.tipo_operacional, formaInfo.prioridade_label, formaInfo.canal_logistico,
      firstValue(o, ['prioridade_label','prioridade_operacional','prioridade','priority','tipo_entrega','observacoes_tiny','observacoes_internas','observacao_logistica','observacao','observacoes','obs','tags','tag','status_logistica','situacao_nome','situacao','status']),
      o && o.alarme ? 'alarme' : ''
    ].join(' | '));

    const emergency = /(emergenc|urgenc|urgente|prioridade alta|prioritario|prioritario|critico|critico|alarme|expresso|imediato)/i.test(text);
    const isPickupByForm = String(formaInfo.eh_retirada || '').toUpperCase() === 'SIM' || Number(formaInfo.prioridade_operacional) === 2 || /retirada|retirar/i.test(String(formaInfo.tipo_operacional || formaInfo.forma_envio_nome || ''));
    const isPickupByText = /(retirar pessoalmente|retirada|retirar|retira|retire|balcao|balcao|cliente retira|retirar na loja|retirada na loja)/i.test(text);

    let rank = Number(formaInfo.prioridade_operacional || 3);
    let label = String(formaInfo.prioridade_label || `${rank} - Entrega`).trim();
    let type = String(formaInfo.tipo_operacional || 'Entrega').trim();
    if(isPickupByForm || isPickupByText) { rank = 2; label = '2 - Retirada'; type = 'Retirada'; }
    if(emergency) { rank = 1; label = '1 - Emergencial'; type = 'Emergencial'; }
    if(![1,2,3].includes(rank)) rank = 3;

    const dateISO = getDateISO(o);
    const formaNome = String(formaInfo.forma_envio_nome || getFormaNameRaw(o) || 'Forma de envio não informada').trim();
    const canal = String(formaInfo.canal_logistico || formaNome || '').trim();
    const cls = rank === 1 ? 'bg-red-50 text-red-700 border-red-200' : rank === 2 ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-blue-50 text-blue-700 border-blue-200';
    return { rank, label, type, dateISO, formaInfo, formaNome, canal, className: cls, id_forma_envio: getFormaId(o) || formaInfo.id_forma_envio || '' };
  }
  function enrichOrder(o){
    if(!o || typeof o !== 'object') return o;
    const c = classifyOrder(o);
    o._priority_rank_v15 = c.rank;
    o._priority_label_v15 = c.label;
    o._priority_date_v15 = c.dateISO || '9999-12-31';
    o._forma_envio_v15 = c.formaNome;
    o._canal_logistico_v15 = c.canal;
    if(c.id_forma_envio && !o.id_forma_envio) o.id_forma_envio = c.id_forma_envio;
    if(c.formaNome && !o.forma_envio_nome) o.forma_envio_nome = c.formaNome;
    if(c.formaNome && !o.nome_forma_envio) o.nome_forma_envio = c.formaNome;
    if(c.formaNome && !o.nomeformafenvio) o.nomeformafenvio = c.formaNome;
    if(c.formaNome && !o.transportadora) o.transportadora = c.formaNome;
    if(c.label) o.prioridade_label = c.label;
    if(c.rank) o.prioridade_operacional = c.rank;
    if(c.type) o.tipo_operacional = c.type;
    if(c.canal) o.canal_logistico = c.canal;
    return o;
  }
  function enrichAllOrders(){
    try { if(typeof orders !== 'undefined' && Array.isArray(orders)) orders.forEach(enrichOrder); } catch(e) {}
    try { if(typeof flexOrders !== 'undefined' && Array.isArray(flexOrders)) flexOrders.forEach(enrichOrder); } catch(e) {}
    try { if(Array.isArray(window.orders)) window.orders.forEach(enrichOrder); } catch(e) {}
    try { if(Array.isArray(window.flexOrders)) window.flexOrders.forEach(enrichOrder); } catch(e) {}
    try { if(typeof syncGlobalOrderState === 'function') syncGlobalOrderState(); } catch(e) {}
  }
  function compareOrders(a, b){
    const ca = classifyOrder(a || {}), cb = classifyOrder(b || {});
    if(ca.rank !== cb.rank) return ca.rank - cb.rank;
    const da = ca.dateISO || '9999-12-31';
    const db = cb.dateISO || '9999-12-31';
    if(da !== db) return da.localeCompare(db);
    return String(firstValue(a, ['numero','id','pedido'])).localeCompare(String(firstValue(b, ['numero','id','pedido'])), 'pt-BR', { numeric: true });
  }
  function rowKey(row){
    if(!row) return '';
    let key = row.getAttribute('data-num') || row.getAttribute('data-ecom') || row.getAttribute('data-pedido') || '';
    if(key) return key;
    const cb = row.querySelector && row.querySelector('input[type="checkbox"]');
    if(cb) key = cb.getAttribute('data-num') || cb.getAttribute('data-ecom') || cb.value || '';
    if(key && key !== 'on') return key;
    const txt = row.innerText || '';
    const m = txt.match(/#\s*([0-9A-Za-z._-]{4,})/) || txt.match(/\b(\d{5,})\b/);
    return m ? m[1] : '';
  }
  function badgeHTML(o){
    const c = classifyOrder(o || {});
    const dateInfo = c.dateISO ? ` • ${esc(c.dateISO.split('-').reverse().join('/'))}` : '';
    const idInfo = c.id_forma_envio ? `ID ${esc(c.id_forma_envio)} • ` : '';
    return `<div class="vesco-priority-badge-v15 mt-1 flex flex-wrap gap-1 justify-end md:justify-start">
      <span class="inline-flex items-center px-2 py-0.5 rounded-lg border text-[10px] font-black ${c.className}">${esc(c.label)}${dateInfo}</span>
      <span class="inline-flex items-center px-2 py-0.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-600 text-[10px] font-bold">${idInfo}${esc(c.formaNome)}</span>
    </div>`;
  }
  function sortContainer(selector, itemSelector){
    const container = document.querySelector(selector);
    if(!container) return;
    const items = Array.from(itemSelector ? container.querySelectorAll(itemSelector) : container.children).filter(el => el && el.nodeType === 1 && !/nenhum/i.test(el.innerText || ''));
    if(items.length < 2) return;
    items.sort((ra, rb) => {
      const oa = findOrderByAnyNumber(rowKey(ra));
      const ob = findOrderByAnyNumber(rowKey(rb));
      if(!oa && !ob) return 0;
      if(!oa) return 1;
      if(!ob) return -1;
      return compareOrders(oa, ob);
    });
    items.forEach(it => container.appendChild(it));
  }
  function decorateRows(){
    const configs = [
      ['#table-rotas tr', 'td:last-child'],
      ['#saiu-pedidos-list .pedido-item', '.flex-1'],
      ['#table-logistica tr', 'td:nth-child(3)'],
      ['#table-fila tr', 'td:nth-child(2)'],
      ['#table-envios-flex-corpo tr', 'td:nth-child(3)']
    ];
    configs.forEach(([sel, targetSel]) => {
      document.querySelectorAll(sel).forEach(row => {
        if(row.querySelector('.vesco-priority-badge-v15')) return;
        const order = findOrderByAnyNumber(rowKey(row));
        if(!order) return;
        const c = classifyOrder(order);
        row.setAttribute('data-vesco-priority-rank', String(c.rank));
        row.setAttribute('data-vesco-priority-date', c.dateISO || '9999-12-31');
        const target = row.querySelector(targetSel) || row.querySelector('td:last-child') || row;
        if(target) target.insertAdjacentHTML('beforeend', badgeHTML(order));
      });
    });
  }
  function sortAllPriorityLists(){
    sortContainer('#table-rotas', 'tr');
    sortContainer('#saiu-pedidos-list', '.pedido-item');
    sortContainer('#table-logistica', 'tr');
    sortContainer('#table-fila', 'tr');
    sortContainer('#table-envios-flex-corpo', 'tr');
  }
  function injectPriorityLegend(){
    const roots = ['#view-rotas', '#view-saiu', '#view-logistica'].map(s => document.querySelector(s)).filter(Boolean);
    roots.forEach(root => {
      if(root.querySelector('.vesco-priority-legend-v15')) return;
      const legend = document.createElement('div');
      legend.className = 'vesco-priority-legend-v15 text-[11px] font-bold text-slate-600 flex flex-wrap gap-2 mb-2';
      legend.innerHTML = `<span class="px-2 py-1 rounded border bg-red-50 text-red-700 border-red-200">1º Emergenciais</span><span class="px-2 py-1 rounded border bg-purple-50 text-purple-700 border-purple-200">2º Retiradas</span><span class="px-2 py-1 rounded border bg-blue-50 text-blue-700 border-blue-200">3º Entregas por data</span>`;
      const anchor = root.querySelector('.card') || root.firstElementChild;
      if(anchor) anchor.insertAdjacentElement('afterbegin', legend);
    });
  }
  function injectCss(){
    if(document.getElementById('vesco-priority-v15-style')) return;
    const st = document.createElement('style');
    st.id = 'vesco-priority-v15-style';
    st.textContent = `
      .vesco-priority-badge-v15 span{white-space:normal;line-height:1.15}.vesco-priority-legend-v15{align-items:center}.vesco-priority-badge-v15{max-width:100%}
      @media(max-width:760px){.vesco-priority-badge-v15{justify-content:flex-start!important}.vesco-priority-badge-v15 span{font-size:9px}.vesco-priority-legend-v15{font-size:10px;gap:4px}}
    `;
    document.head.appendChild(st);
  }
  function applyPriorityUI(){
    injectCss();
    enrichAllOrders();
    decorateRows();
    sortAllPriorityLists();
    injectPriorityLegend();
  }

  function routeById(id){
    try { if(window.vescoRoutesV13 && typeof window.vescoRoutesV13.findRouteById === 'function') { const r = window.vescoRoutesV13.findRouteById(id); if(r) return r; } } catch(e) {}
    try { if(window.vescoRoutesV6 && typeof window.vescoRoutesV6.findRouteById === 'function') { const r = window.vescoRoutesV6.findRouteById(id); if(r) return r; } } catch(e) {}
    return (window.saiuRotas || []).find(r => String(r.id) === String(id)) || null;
  }
  function printRouteV15(id){
    const route = routeById(id);
    if(!route) return alert('Rota não encontrada para impressão.');
    const origin = route.origem || route.origin || '';
    const stops = [];
    if(origin) stops.push({ tipo:'Partida', numero:'Partida', cliente:'Ponto de partida', endereco:origin, priority:{ label:'Origem', formaNome:'' } });
    (route.pedidos || []).forEach((n, idx) => {
      const o = findOrderByAnyNumber(n);
      const c = classifyOrder(o || {});
      stops.push({ tipo:'Parada ' + (idx + 1), numero:firstValue(o, ['numero','id','pedido']) || n, ecom:firstValue(o, ['numero_ecommerce','ecom','referencia','reference']), cliente:firstValue(o, ['cliente_nome','destinatario','cliente','nome']) || '', endereco:firstValue(o, ['endereco_completo','endereco','address']) || '', priority:c });
    });
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Rota ${esc(route.nome || '')}</title><style>body{font-family:Arial,sans-serif;color:#0f172a;margin:24px}h1{font-size:22px;margin:0 0 8px}.meta{font-size:12px;color:#475569;margin-bottom:16px}.tag{display:inline-block;border:1px solid #cbd5e1;border-radius:999px;padding:3px 8px;font-size:11px;font-weight:700;margin-right:4px}table{width:100%;border-collapse:collapse;font-size:12px}th{background:#0f172a;color:white;text-align:left;padding:8px}td{border-bottom:1px solid #e2e8f0;padding:8px;vertical-align:top}.small{font-size:10px;color:#64748b}.route-title{border:1px solid #e2e8f0;border-radius:12px;padding:12px;margin-bottom:14px;background:#f8fafc}@page{size:A4;margin:12mm}</style></head><body><div class="route-title"><h1>${esc(route.nome || 'Rota')}</h1><div class="meta"><b>Motorista:</b> ${esc(route.motorista || '—')} &nbsp; <b>Pedidos:</b> ${(route.pedidos || []).length} &nbsp; <b>Gerado:</b> ${new Date().toLocaleString('pt-BR')}</div></div><table><thead><tr><th>#</th><th>Tipo</th><th>Pedido</th><th>Cliente</th><th>Endereço</th><th>Prioridade / Forma de envio</th></tr></thead><tbody>${stops.map((s,i)=>`<tr><td>${i+1}</td><td><b>${esc(s.tipo)}</b></td><td><b>${esc(s.numero)}</b>${s.ecom?`<div class="small">E-com: ${esc(s.ecom)}</div>`:''}</td><td>${esc(s.cliente || '—')}</td><td>${esc(s.endereco || '—')}</td><td><span class="tag">${esc(s.priority.label || '—')}</span><div class="small">${esc(s.priority.formaNome || '')}</div></td></tr>`).join('')}</tbody></table><script>window.onload=function(){setTimeout(function(){window.print();},300)}<\/script></body></html>`;
    const w = window.open('', '_blank');
    if(!w) return alert('O navegador bloqueou a janela de impressão. Libere pop-ups para gerar o PDF.');
    w.document.open(); w.document.write(html); w.document.close();
  }
  function upgradePrintButtons(){
    document.querySelectorAll('.vesco-print-route-btn-v14, .vesco-print-route-btn-v15').forEach(btn => {
      if(btn.dataset.vescoV15PrintBound) return;
      const card = btn.closest('#saiu-rotas-list > *') || btn.closest('[data-rota-id]') || btn.parentElement;
      const html = card ? card.innerHTML || '' : '';
      const m = html.match(/['"](rota-[^'"]+)['"]/i) || html.match(/['"]([^'"]*\d{10,}[^'"]*)['"]/i);
      const id = m && m[1];
      if(!id) return;
      btn.dataset.vescoV15PrintBound = '1';
      btn.classList.add('vesco-print-route-btn-v15');
      btn.onclick = function(e){ e.preventDefault(); e.stopPropagation(); printRouteV15(id); };
    });
  }

  const oldRender = window.render || (typeof render === 'function' ? render : null);
  if(oldRender && !window.__vescoRenderV15Wrapped){
    window.__vescoRenderV15Wrapped = true;
    window.render = render = function(){
      const ret = oldRender.apply(this, arguments);
      setTimeout(applyPriorityUI, 120);
      setTimeout(applyPriorityUI, 700);
      return ret;
    };
  }
  const oldSwitch = window.switchTab;
  if(typeof oldSwitch === 'function' && !window.__vescoSwitchV15Wrapped){
    window.__vescoSwitchV15Wrapped = true;
    window.switchTab = function(which){
      const ret = oldSwitch.apply(this, arguments);
      setTimeout(() => { applyPriorityUI(); upgradePrintButtons(); }, 180);
      setTimeout(() => { applyPriorityUI(); upgradePrintButtons(); }, 900);
      return ret;
    };
  }
  const oldLoad = window.load || (typeof load === 'function' ? load : null);
  if(oldLoad && !window.__vescoLoadV15Wrapped){
    window.__vescoLoadV15Wrapped = true;
    window.load = load = function(){
      carregarFormasEnvio(false);
      const ret = oldLoad.apply(this, arguments);
      setTimeout(applyPriorityUI, 1200);
      setTimeout(applyPriorityUI, 2500);
      return ret;
    };
  }

  document.addEventListener('change', function(e){
    if(e.target && e.target.matches && e.target.matches('#view-saiu input[type="checkbox"], #view-rotas input[type="checkbox"], #search, #topCalendar')) {
      setTimeout(applyPriorityUI, 80);
    }
  }, true);
  document.addEventListener('click', function(e){
    const btn = e.target && e.target.closest && e.target.closest('button, a, [role="button"], input[type="button"], input[type="submit"]');
    if(!btn) return;
    const text = `${btn.textContent || ''} ${btn.id || ''} ${btn.getAttribute('onclick') || ''}`;
    if(/atualizar|criar\s+rota|marcar todos|limpar|sugerir rotas|tra[cç]ar rota|google maps|ver no mapa|pronto para envio|montar rotas|logistica/i.test(text)) {
      setTimeout(() => { applyPriorityUI(); upgradePrintButtons(); }, 220);
      setTimeout(() => { applyPriorityUI(); upgradePrintButtons(); }, 1200);
    }
  }, true);

  window.vescoFormasEnvioPriorityV15 = {
    carregarFormasEnvio,
    applyPriorityUI,
    classifyOrder,
    enrichAllOrders,
    findOrderByAnyNumber,
    compareOrders,
    printRoute: printRouteV15,
    debug(){
      const idx = window.vescoFormasEnvioV15 || {};
      return {
        source: idx.source,
        totalFormas: idx.list ? idx.list.length : 0,
        ids: idx.byId ? Object.keys(idx.byId) : [],
        totalOrders: allOrders().length,
        amostra: allOrders().slice(0, 10).map(o => ({ numero: firstValue(o, ['numero','id']), id_forma_envio: getFormaId(o), forma: classifyOrder(o).formaNome, prioridade: classifyOrder(o).label, data: classifyOrder(o).dateISO }))
      };
    }
  };

  if(document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      carregarFormasEnvio(false).then(() => { applyPriorityUI(); upgradePrintButtons(); });
    });
  } else {
    carregarFormasEnvio(false).then(() => { applyPriorityUI(); upgradePrintButtons(); });
  }
  let cycles = 0;
  const timer = setInterval(() => {
    cycles++;
    applyPriorityUI();
    upgradePrintButtons();
    if(cycles >= 8) clearInterval(timer);
  }, 1000);

  log('V15 ativo — FormasEnvio puxada do Apps Script e listas ordenadas por Emergencial, Retirada e Entrega por data.');
})();

// =================================================================
// CAMADA V16 — FORMAS DE ENVIO POR CONTA + RETIRADAS + OBS/LINK
// Objetivos:
// 1) corrigir LALAMOVE/Distribuidora não virar Mercado Envios Flex;
// 2) criar visão específica de pedidos de Retirada;
// 3) permitir observação e link em todos os pedidos A Separar;
// 4) reforçar responsividade geral.
// Regra de Preservação: camada aditiva; não remove legado.
// =================================================================
(function installVescoV16RetiradasObsLink(){
  if (window.__vescoV16RetiradasObsLink) return;
  window.__vescoV16RetiradasObsLink = true;

  const API_EXTRAS_ACTION = 'updatePedidoExtras';

  const FORMAS_POR_CONTA_V16 = {
    COMERCIO: [
      ['747632293','Correios'], ['747632297','Transportadora'], ['747632298','Retirar pessoalmente'],
      ['769570519','Mercado Envios'], ['778029845','Shopee Envios'], ['780391986','Mercado Envios Flex'],
      ['849173976','Amazon DBA'], ['850044775','Magalu Entregas'], ['852535843','Loggi'],
      ['854284026','TikTok Shipping'], ['860463094','RETIRADA']
    ],
    DISTRIBUIDORA: [
      ['758290128','Correios'], ['758290130','Transportadora'], ['758290131','Retirar pessoalmente'],
      ['778095610','Shopee Envios'], ['780192106','Amazon DBA'], ['846935602','LALAMOVE'],
      ['847199235','Mercado Envios'], ['850341481','Loggi'], ['854536867','shopee - spx entrega rápida'],
      ['857757016','Enviali']
    ]
  };

  function log(){ try { console.log.apply(console, arguments); } catch(e) {} }
  function warn(){ try { console.warn.apply(console, arguments); } catch(e) {} }
  function esc(v){
    try { return typeof escapeHtml === 'function' ? escapeHtml(v) : String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
    catch(e){ return String(v ?? ''); }
  }
  function toast(msg, type='info', ms=3500){
    try { if(typeof showToast === 'function') return showToast(msg, type, ms); } catch(e) {}
    log(msg);
  }
  function strip(v){ return String(v || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); }
  function norm(v){ return strip(v).toLowerCase().replace(/\s+/g,' ').trim(); }
  function compact(v){ return norm(v).replace(/[^a-z0-9]/g,''); }
  function idOnly(v){ return String(v ?? '').replace(/\D/g,'').trim(); }
  function orderKey(v){
    try { return typeof normalizeOrderNumber === 'function' ? normalizeOrderNumber(v) : String(v ?? '').replace(/^#/,'').trim(); }
    catch(e){ return String(v ?? '').replace(/^#/,'').trim(); }
  }
  function first(o, keys){
    if(!o) return '';
    for(const k of keys){
      if(o[k] !== undefined && o[k] !== null && String(o[k]).trim() !== '') return String(o[k]).trim();
    }
    return '';
  }
  function allOrdersV16(){
    const pools = [];
    try { if(typeof orders !== 'undefined' && Array.isArray(orders)) pools.push(...orders); } catch(e) {}
    try { if(Array.isArray(window.orders)) pools.push(...window.orders); } catch(e) {}
    try { if(typeof flexOrders !== 'undefined' && Array.isArray(flexOrders)) pools.push(...flexOrders); } catch(e) {}
    try { if(Array.isArray(window.flexOrders)) pools.push(...window.flexOrders); } catch(e) {}
    return Array.from(new Set(pools.filter(Boolean)));
  }
  function getConta(o){
    const raw = first(o, ['conta_tiny','contaTiny','conta','loja','store_name','store','account']);
    const c = norm(raw);
    if(c.includes('distrib')) return 'DISTRIBUIDORA';
    if(c.includes('comerc')) return 'COMERCIO';
    const id = idOnly(first(o, ['id_forma_envio','idFormaEnvio','idFormaEnvioPsq','id_forma_envio_psq']));
    if(['758290128','758290130','758290131','778095610','780192106','846935602','847199235','850341481','854536867','857757016'].includes(id)) return 'DISTRIBUIDORA';
    return 'COMERCIO';
  }
  function detectByName(name, conta){
    const t = compact(name);
    if(!t) return null;
    const c = conta || 'COMERCIO';
    const isDistrib = c === 'DISTRIBUIDORA';

    const rules = [
      [/lalamove/, isDistrib ? ['846935602','LALAMOVE'] : ['','LALAMOVE']],
      [/mercadoenviosflex|flex/, isDistrib ? ['847199235','Mercado Envios'] : ['780391986','Mercado Envios Flex']],
      [/mercadoenvios|mercado/, isDistrib ? ['847199235','Mercado Envios'] : ['769570519','Mercado Envios']],
      [/retirarpessoalmente|retirada|retirar/, isDistrib ? ['758290131','Retirar pessoalmente'] : ['747632298','Retirar pessoalmente']],
      [/shopeespx|spx|shopee/, isDistrib ? ['778095610','Shopee Envios'] : ['778029845','Shopee Envios']],
      [/amazondba|amazon/, isDistrib ? ['780192106','Amazon DBA'] : ['849173976','Amazon DBA']],
      [/loggi/, isDistrib ? ['850341481','Loggi'] : ['852535843','Loggi']],
      [/enviali/, ['857757016','Enviali']],
      [/tiktok/, ['854284026','TikTok Shipping']],
      [/correios/, isDistrib ? ['758290128','Correios'] : ['747632293','Correios']],
      [/transportadora/, isDistrib ? ['758290130','Transportadora'] : ['747632297','Transportadora']]
    ];
    for(const [rx, out] of rules){ if(rx.test(t)) return { id: out[0], nome: out[1] }; }
    return null;
  }
  function mapIdToName(id, conta){
    id = idOnly(id);
    const list = FORMAS_POR_CONTA_V16[conta] || [];
    const found = list.find(x => x[0] === id);
    if(found) return found[1];
    for(const c of Object.keys(FORMAS_POR_CONTA_V16)){
      const f = FORMAS_POR_CONTA_V16[c].find(x => x[0] === id);
      if(f) return f[1];
    }
    return '';
  }
  function normalizeFormaEnvioV16(o){
    if(!o || typeof o !== 'object') return o;
    const conta = getConta(o);
    const idAtual = idOnly(first(o, ['id_forma_envio','idFormaEnvio','idFormaEnvioPsq','id_forma_envio_psq','forma_envio_id']));
    const nomeRaw = [
      first(o, ['forma_envio_nome','nome_forma_envio','nomeformafenvio']),
      first(o, ['transportadora','transportador','nome_transportadora','nome_transportador']),
      first(o, ['forma_envio','forma_frete','forma_envio_tiny','transporte_completo'])
    ].filter(Boolean).join(' | ');

    const byName = detectByName(nomeRaw, conta);
    // Nome explícito tem prioridade sobre ID antigo/incompatível. Ex.: LALAMOVE não pode aparecer como Mercado Envios Flex.
    if(byName && byName.nome) {
      if(byName.id) {
        o.id_forma_envio = byName.id;
        o.idFormaEnvio = byName.id;
        o.idFormaEnvioPsq = byName.id;
        o.id_forma_envio_psq = byName.id;
        o.forma_envio_id = byName.id;
      }
      o.forma_envio_nome = byName.nome;
      o.nome_forma_envio = byName.nome;
      o.nomeformafenvio = byName.nome;
      o.transportadora = byName.nome;
      o.transportador = byName.nome;
      o.nome_transportadora = byName.nome;
      o.nome_transportador = byName.nome;
      o._forma_envio_v16 = byName.nome;
      o._id_forma_envio_v16 = byName.id || idAtual;
    } else if(idAtual) {
      const nome = mapIdToName(idAtual, conta);
      if(nome) {
        o.forma_envio_nome = nome;
        o.nome_forma_envio = nome;
        o.nomeformafenvio = nome;
        if(!o.transportadora) o.transportadora = nome;
        o._forma_envio_v16 = nome;
        o._id_forma_envio_v16 = idAtual;
      }
    }

    const joined = norm([o.id_forma_envio, o.forma_envio_nome, o.transportadora, o.forma_envio, o.observacoes_tiny, o.observacao_logistica, o.observacao_pedido].join(' | '));
    const isRetirada = /retirada|retirar|retira pessoalmente|retirar pessoalmente|cliente retira|balcao|balcão/.test(joined) || ['747632298','860463094','758290131'].includes(idOnly(o.id_forma_envio));
    const isEmerg = /emergenc|urgenc|urgente|prioridade alta|critico|crítico|imediato/.test(joined);
    if(isEmerg) {
      o.tipo_operacional = 'Emergencial'; o.tipo_entrega = 'Emergencial'; o.prioridade_operacional = 1; o.prioridade_label = '1 - Emergencial';
    } else if(isRetirada) {
      o.tipo_operacional = 'Retirada'; o.tipo_entrega = 'Retirada'; o.prioridade_operacional = 2; o.prioridade_label = '2 - Retirada';
    } else {
      o.tipo_operacional = o.tipo_operacional || 'Entrega';
      o.tipo_entrega = o.tipo_entrega || 'Normal';
      o.prioridade_operacional = Number(o.prioridade_operacional || 3);
      o.prioridade_label = o.prioridade_label || '3 - Entrega';
    }
    return o;
  }
  function normalizeAllV16(){
    allOrdersV16().forEach(normalizeFormaEnvioV16);
    try { if(typeof syncGlobalOrderState === 'function') syncGlobalOrderState(); } catch(e) {}
  }
  function findOrderByKeyV16(value){
    const raw = String(value || '').replace(/^#/,'').trim();
    const targets = new Set([raw, orderKey(raw), idOnly(raw)].filter(Boolean));
    return allOrdersV16().find(o => {
      const vals = [o.id,o.numero,o.pedido,o.id_tiny,o.pedido_key,o.numero_ecommerce,o.ecom,o.reference,o.referencia].map(v => String(v ?? '').replace(/^#/,'').trim());
      return vals.some(v => targets.has(v) || targets.has(orderKey(v)) || targets.has(idOnly(v)));
    }) || null;
  }
  function isDelivered(o){ return /entregue|finalizado|conclu/i.test(String(first(o, ['status_logistica','situacao_nome','situacao','status']))); }
  function isPickup(o){ normalizeFormaEnvioV16(o); return Number(o.prioridade_operacional) === 2 || /retirada|retirar/i.test(String(o.tipo_operacional || o.tipo_entrega || o.prioridade_label || '')); }
  function isQueue(o){ return /a separar|em separa/i.test(String(first(o, ['status_logistica','situacao_nome','situacao','status'])) || 'A Separar'); }

  function selectedDateBR(){
    try { return isoToBRDate(getSelectedOperationalDateISO()); } catch(e) { return ''; }
  }
  function dateBR(v){
    try {
      if(typeof dateValueToISO === 'function') {
        const iso = dateValueToISO(v);
        if(iso) return iso.split('-').reverse().join('/');
      }
    } catch(e) {}
    return String(v || '—');
  }

  function injectCssV16(){
    if(document.getElementById('vesco-v16-style')) return;
    const st = document.createElement('style');
    st.id = 'vesco-v16-style';
    st.textContent = `
      .vesco-extra-box-v16{margin-top:8px;display:grid;grid-template-columns:1fr 1fr auto;gap:6px;align-items:end;max-width:760px;}
      .vesco-extra-box-v16 input{border:1px solid #dbe4f0;background:#fff;border-radius:8px;padding:6px 8px;font-size:11px;font-weight:600;color:#334155;min-width:0;}
      .vesco-extra-box-v16 button{border-radius:8px;padding:7px 9px;font-size:10px;font-weight:900;background:#0f172a;color:#fff;white-space:nowrap;}
      .vesco-retirada-card-v16{border:1px solid #e2e8f0;border-radius:14px;background:#fff;padding:12px;margin-bottom:10px;box-shadow:0 6px 16px rgba(15,23,42,.04);}
      .vesco-retirada-badge-v16{display:inline-flex;align-items:center;gap:4px;border:1px solid #f5d0fe;background:#faf5ff;color:#7e22ce;border-radius:999px;padding:2px 8px;font-size:10px;font-weight:900;}
      .vesco-mobile-scroll-v16{overflow:auto;-webkit-overflow-scrolling:touch;}
      @media(max-width:768px){
        body{overflow-x:hidden;}
        header{position:sticky;top:0;z-index:60;}
        .tab-nav{position:sticky;top:58px;z-index:55;overflow-x:auto;}
        .tab-nav > div:first-child{width:100%;overflow-x:auto;padding-bottom:4px;}
        .tab-btn{min-width:max-content;padding:9px 11px!important;font-size:12px!important;}
        main{padding:8px!important;}
        .card{border-radius:14px!important;padding:10px!important;}
        table{min-width:760px;}
        #view-logistica .grid,#view-envios_flex .grid,#view-rotas .grid{display:block!important;}
        #view-logistica .card,#view-envios_flex .card,#view-rotas .card{margin-bottom:12px;}
        .map-wrapper,#map,#map-flex,#map-rotas,#vesco-route-map-v13,#vesco-route-map-v6{height:320px!important;min-height:320px!important;}
        .vesco-extra-box-v16{grid-template-columns:1fr;}
        .vesco-extra-box-v16 button{width:100%;}
        #search{min-width:170px;}
      }
    `;
    document.head.appendChild(st);
  }

  function apiBase(){ try { if(typeof API !== 'undefined') return API; } catch(e) {} return window.API || ''; }
  function appendParams(url, params){
    let out = String(url || '');
    Object.keys(params || {}).forEach(k => {
      const v = params[k];
      if(v === undefined || v === null || String(v).trim() === '') return;
      out += (out.includes('?') ? '&' : '?') + encodeURIComponent(k) + '=' + encodeURIComponent(v);
    });
    return out;
  }
  function callJsonpV16(params, cb){
    const url = appendParams(apiBase(), params);
    if(typeof jsonpFetch === 'function') return jsonpFetch(url, cb || function(){});
    // fallback leve
    const callback = '__vesco_v16_cb_' + Math.random().toString(36).slice(2);
    const script = document.createElement('script');
    window[callback] = function(res){ try { delete window[callback]; } catch(e){} if(script.parentNode) script.remove(); if(cb) cb(null,res); };
    script.onerror = function(){ try { delete window[callback]; } catch(e){} if(script.parentNode) script.remove(); if(cb) cb(new Error('script_error')); };
    script.src = appendParams(url, { callback });
    document.head.appendChild(script);
  }

  window.salvarExtrasPedidoV16 = function(id){
    const obsEl = document.getElementById('vesco-obs-v16-' + CSS.escape(String(id)));
    const linkEl = document.getElementById('vesco-link-v16-' + CSS.escape(String(id)));
    const obs = obsEl ? obsEl.value.trim() : '';
    const link = linkEl ? linkEl.value.trim() : '';
    const order = findOrderByKeyV16(id);
    if(order){ order.observacao_pedido = obs; order.link_pedido = link; }
    callJsonpV16({ action: API_EXTRAS_ACTION, id, observacao_pedido: obs, link_pedido: link, operador: window.currentOperator || (typeof currentOperator !== 'undefined' ? currentOperator : '') }, (err, res) => {
      if(err || (res && res.success === false)) {
        // fallback: preserva no campo observacao_logistica se endpoint novo ainda não foi publicado.
        try { if(typeof updateStatusJsonp === 'function') updateStatusJsonp(id, '', `Obs: ${obs} | Link: ${link}`); } catch(e) {}
        toast('Obs/link salvos localmente; publique o Apps Script V15 para gravar em colunas próprias.', 'warning', 4500);
      } else {
        toast('Observação e link salvos no pedido.', 'success', 2500);
      }
      try { if(typeof render === 'function') render(); } catch(e) {}
    });
  };

  function injectExtrasInFila(){
    const tbody = document.getElementById('table-fila');
    if(!tbody) return;
    tbody.querySelectorAll('tr').forEach(row => {
      if(row.querySelector('.vesco-extra-box-v16')) return;
      const txt = row.innerText || '';
      const m = txt.match(/#\s*([0-9A-Za-z._-]+)/) || txt.match(/\b(\d{5,})\b/);
      if(!m) return;
      const order = findOrderByKeyV16(m[1]);
      if(!order) return;
      const id = String(order.id || order.numero || m[1]);
      const target = row.querySelector('td:nth-child(2)') || row.querySelector('td:last-child');
      if(!target) return;
      const obs = esc(order.observacao_pedido || order.obs_pedido || '');
      const link = esc(order.link_pedido || order.linkPedido || order.link_tiny || '');
      target.insertAdjacentHTML('beforeend', `
        <div class="vesco-extra-box-v16">
          <input id="vesco-obs-v16-${esc(id)}" value="${obs}" placeholder="Observação do pedido" title="Observação do pedido">
          <input id="vesco-link-v16-${esc(id)}" value="${link}" placeholder="Link do pedido" title="Link do pedido">
          <button type="button" onclick="window.salvarExtrasPedidoV16 && window.salvarExtrasPedidoV16('${esc(id)}')">Salvar obs/link</button>
        </div>
      `);
    });
  }

  function ensureRetiradasView(){
    injectCssV16();
    if(!document.getElementById('main-retiradas-v16')) {
      const btn = document.createElement('button');
      btn.id = 'main-retiradas-v16';
      btn.className = 'tab-btn';
      btn.innerHTML = '<i class="fas fa-hand-holding-box text-purple-600"></i>Retiradas';
      btn.onclick = () => switchTab('retiradas_v16');
      const anchor = document.getElementById('main-saiu') || document.getElementById('main-rotas') || document.getElementById('main-log');
      if(anchor && anchor.parentElement) anchor.insertAdjacentElement('afterend', btn);
    }
    if(!document.getElementById('view-retiradas-v16')) {
      const main = document.querySelector('main') || document.body;
      const sec = document.createElement('section');
      sec.id = 'view-retiradas-v16';
      sec.className = 'hidden w-full space-y-3';
      sec.innerHTML = `
        <div class="card p-3 md:p-5 w-full rounded-xl border border-slate-200 bg-white">
          <div class="flex flex-col md:flex-row md:items-center justify-between gap-2 mb-3">
            <div>
              <h2 class="font-black text-slate-800 uppercase tracking-wide text-sm"><i class="fas fa-hand-holding-box text-purple-600 mr-2"></i>Pedidos para retirada</h2>
              <p class="text-xs text-slate-500 mt-1">Prioridade 2: pedidos com forma de envio Retirar pessoalmente / RETIRADA.</p>
            </div>
            <button type="button" onclick="window.renderRetiradasV16 && window.renderRetiradasV16()" class="bg-slate-900 text-white px-3 py-2 rounded-lg text-xs font-bold">Atualizar retiradas</button>
          </div>
          <div id="retiradas-list-v16" class="vesco-mobile-scroll-v16"></div>
        </div>`;
      main.appendChild(sec);
    }
  }

  window.renderRetiradasV16 = function(){
    ensureRetiradasView();
    normalizeAllV16();
    const el = document.getElementById('retiradas-list-v16');
    if(!el) return;
    const list = allOrdersV16().filter(o => isPickup(o) && !isDelivered(o)).sort((a,b) => {
      const da = String(a.data_prevista || '9999-12-31');
      const db = String(b.data_prevista || '9999-12-31');
      return da.localeCompare(db) || String(a.numero || a.id).localeCompare(String(b.numero || b.id), 'pt-BR', {numeric:true});
    });
    if(!list.length) {
      el.innerHTML = `<div class="p-5 text-center text-slate-400 font-bold">Nenhum pedido de retirada encontrado para ${esc(selectedDateBR() || 'a data selecionada')}.</div>`;
      return;
    }
    el.innerHTML = list.map(o => {
      const id = esc(o.id || o.numero || '');
      const num = esc(o.numero || o.id || 'S/N');
      const obs = esc(o.observacao_pedido || o.observacao_logistica || '');
      const link = esc(o.link_pedido || o.link_tiny || '');
      return `
        <div class="vesco-retirada-card-v16">
          <div class="flex flex-col md:flex-row md:items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2"><b class="text-slate-900">#${num}</b><span class="vesco-retirada-badge-v16">${esc(o.prioridade_label || '2 - Retirada')}</span><span class="text-[10px] text-slate-500 font-bold">${esc(o.forma_envio_nome || o.transportadora || 'Retirada')}</span></div>
              <div class="font-bold text-slate-700 mt-1">${esc(o.cliente_nome || o.destinatario || '')}</div>
              <div class="text-xs text-slate-500 mt-1">Data prevista: <b>${esc(dateBR(o.data_prevista))}</b> • Conta: ${esc(o.conta_tiny || '')}</div>
              <div class="text-xs text-slate-500 mt-1">${esc(o.endereco_completo || 'Endereço não informado')}</div>
              ${(obs || link) ? `<div class="mt-2 text-xs bg-slate-50 border border-slate-200 rounded-lg p-2">${obs ? `<div><b>Obs:</b> ${obs}</div>` : ''}${link ? `<div><b>Link:</b> <a class="text-blue-600 font-bold" href="${link}" target="_blank">abrir pedido</a></div>` : ''}</div>` : ''}
            </div>
            <div class="flex flex-col gap-2 md:w-44">
              <button class="bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-3 py-2 text-xs font-black" onclick="window.concluirRetiradaV16 && window.concluirRetiradaV16('${id}')">Marcar retirado</button>
              <button class="bg-amber-500 hover:bg-amber-600 text-white rounded-lg px-3 py-2 text-xs font-black" onclick="window.moverParaPendenciaPrompt && window.moverParaPendenciaPrompt('${id}')">Pendência</button>
            </div>
          </div>
        </div>`;
    }).join('');
  };

  window.concluirRetiradaV16 = function(id){
    if(!confirm('Confirmar que este pedido foi retirado/entregue?')) return;
    const o = findOrderByKeyV16(id);
    if(o){ o.status_logistica = 'Entregue'; o.situacao_nome = 'Entregue'; o.observacao_logistica = [o.observacao_logistica, 'Retirada concluída'].filter(Boolean).join(' | '); }
    try { if(typeof updateStatusJsonp === 'function') updateStatusJsonp(id, 'Entregue', 'Retirada concluída'); } catch(e) {}
    setTimeout(() => { renderRetiradasV16(); try { if(typeof render === 'function') render(); } catch(e){} }, 500);
  };

  function switchCompatInstall(){
    if(window.__vescoSwitchV16Wrapped) return;
    const oldSwitch = window.switchTab;
    if(typeof oldSwitch !== 'function') return;
    window.__vescoSwitchV16Wrapped = true;
    window.switchTab = function(which){
      ensureRetiradasView();
      const isRet = which === 'retiradas_v16' || which === 'retiradas' || which === 'retirada';
      const res = isRet ? oldSwitch.call(this, 'separacao') : oldSwitch.apply(this, arguments);
      const view = document.getElementById('view-retiradas-v16');
      if(view) view.classList.toggle('hidden', !isRet);
      const btn = document.getElementById('main-retiradas-v16');
      if(btn) btn.className = isRet ? 'tab-btn active' : 'tab-btn';
      if(isRet) setTimeout(window.renderRetiradasV16, 80);
      return res;
    };
  }

  function afterRenderV16(){
    normalizeAllV16();
    injectExtrasInFila();
    ensureRetiradasView();
    try { if(window.vescoFormasEnvioPriorityV15 && typeof window.vescoFormasEnvioPriorityV15.applyPriorityUI === 'function') window.vescoFormasEnvioPriorityV15.applyPriorityUI(); } catch(e) {}
    if(!document.getElementById('view-retiradas-v16')?.classList.contains('hidden')) window.renderRetiradasV16();
  }

  const oldRender = typeof render === 'function' ? render : window.render;
  if(oldRender && !window.__vescoRenderV16Wrapped){
    window.__vescoRenderV16Wrapped = true;
    window.render = render = function(){
      normalizeAllV16();
      const res = oldRender.apply(this, arguments);
      setTimeout(afterRenderV16, 80);
      return res;
    };
  }

  const oldLoad = window.load || (typeof load === 'function' ? load : null);
  if(oldLoad && !window.__vescoLoadV16Wrapped){
    window.__vescoLoadV16Wrapped = true;
    window.load = load = function(){
      try { localStorage.removeItem('vesco_formas_envio_cache_v15'); localStorage.removeItem('vesco_formas_envio_cache_ts_v15'); } catch(e) {}
      const res = oldLoad.apply(this, arguments);
      setTimeout(() => {
        try { if(window.vescoFormasEnvioPriorityV15 && typeof window.vescoFormasEnvioPriorityV15.carregarFormasEnvio === 'function') window.vescoFormasEnvioPriorityV15.carregarFormasEnvio(true); } catch(e) {}
        afterRenderV16();
      }, 1200);
      return res;
    };
  }

  document.addEventListener('DOMContentLoaded', function(){
    injectCssV16(); ensureRetiradasView(); switchCompatInstall();
    setTimeout(() => { normalizeAllV16(); afterRenderV16(); }, 800);
  });
  if(document.readyState !== 'loading') {
    injectCssV16(); ensureRetiradasView(); switchCompatInstall();
    setTimeout(() => { normalizeAllV16(); afterRenderV16(); }, 500);
  }

  window.vescoV16 = {
    normalizeFormaEnvio: normalizeFormaEnvioV16,
    normalizeAll: normalizeAllV16,
    renderRetiradas: window.renderRetiradasV16,
    findOrder: findOrderByKeyV16,
    debug: function(){
      normalizeAllV16();
      return allOrdersV16().map(o => ({ numero:o.numero, conta:o.conta_tiny, id:o.id_forma_envio, forma:o.forma_envio_nome || o.transportadora, prioridade:o.prioridade_label, obs:o.observacao_pedido, link:o.link_pedido })).slice(0,50);
    }
  };
  log('V16 ativo — formas por conta corrigidas, Retiradas, obs/link e responsividade reforçada.');
})();

// =================================================================
// CAMADA V17 — BLOQUEIO DEFINITIVO DE GEOCODIFICAÇÃO EM MASSA
// Regra de Preservação: não remove o motor antigo; apenas intercepta chamadas
// caras/duplicadas e permite geocodificação somente para rota selecionada.
// =================================================================
(function installVescoGeocodeMassBlockV17(){
  if (window.__vescoGeocodeMassBlockV17) return;
  window.__vescoGeocodeMassBlockV17 = true;

  const LOG_PREFIX = 'V17 geocode:';
  const GEO_MEM_KEY = 'vesco_route_geocode_cache_v17';

  function log(){ try { console.log.apply(console, arguments); } catch(e) {} }
  function warn(){ try { console.warn.apply(console, arguments); } catch(e) {} }
  function strip(v){
    return String(v || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }
  function cleanAddress(addr){
    return String(addr || '')
      .replace(/\s+/g, ' ')
      .replace(/\|/g, ',')
      .replace(/\bSao\b/gi, 'São')
      .trim();
  }
  function addressLooksReal(addr){
    const s = strip(addr);
    if(!s || s.length < 12) return false;
    if(/^rota\s*\d+/i.test(String(addr || '').trim())) return false;
    if(/^(teste|retirada|motorista|entrega|cliente)$/i.test(String(addr || '').trim())) return false;
    return /\b(rua|r\.|av\.?|avenida|alameda|travessa|rodovia|estrada|pra[çc]a|largo|via|marginal)\b/i.test(s) && /\d/.test(s);
  }
  function getCache(){ try { return JSON.parse(localStorage.getItem(GEO_MEM_KEY) || '{}') || {}; } catch(e) { return {}; } }
  function setCache(cache){ try { localStorage.setItem(GEO_MEM_KEY, JSON.stringify(cache || {})); } catch(e) {} }
  function cacheKey(addr){ return cleanAddress(addr).toLowerCase(); }

  // 1) Impede que qualquer renderização de mapa principal geocodifique dezenas de pedidos.
  // A partir daqui, Logística/Flex só plotam pedidos que já vieram com lat/lon da planilha.
  const previousPlotV17 = window.plotMapMarkers || (typeof plotMapMarkers === 'function' ? plotMapMarkers : null);
  if(previousPlotV17 && !window.__vescoPlotMapMarkersNoBulkGeoV17){
    window.__vescoPlotMapMarkersNoBulkGeoV17 = true;
    window.plotMapMarkers = plotMapMarkers = function(orderList, flexList){
      const canPlot = !!document.querySelector('#view-logistica:not(.hidden), #view-envios_flex:not(.hidden)');
      if(!canPlot) return;

      const onlyWithCoords = (list) => (Array.isArray(list) ? list : []).filter(item => {
        try {
          const c = typeof getCoords === 'function' ? getCoords(item) : null;
          return !!(c && Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lon)));
        } catch(e) { return false; }
      });

      return previousPlotV17.call(this, onlyWithCoords(orderList), onlyWithCoords(flexList));
    };
  }

  // 2) Neutraliza tryGeocodeIfNeeded para uso em massa. Ele só usa coordenadas existentes.
  // Rotas continuam usando o motor próprio V12/V13/V16 com lista selecionada.
  const previousTryGeoV17 = window.tryGeocodeIfNeeded || (typeof tryGeocodeIfNeeded === 'function' ? tryGeocodeIfNeeded : null);
  if(previousTryGeoV17 && !window.__vescoTryGeocodeNoBulkV17){
    window.__vescoTryGeocodeNoBulkV17 = true;
    window.tryGeocodeIfNeeded = tryGeocodeIfNeeded = function(item, onResolved){
      let coords = null;
      try { coords = typeof getCoords === 'function' ? getCoords(item) : null; } catch(e) {}
      if(typeof onResolved === 'function') onResolved(coords || null);
      return coords || null;
    };
  }

  // 3) Substitui o proxy JSONP por versão segura: callback atrasado não gera ReferenceError.
  window.geocodeViaVescoProxy = geocodeViaVescoProxy = function(address){
    return new Promise((resolve) => {
      const addr = cleanAddress(address);
      if(!addressLooksReal(addr)) return resolve(null);

      const callbackName = 'jsonp_callback_' + Date.now() + '_' + Math.round(Math.random() * 1000000);
      const script = document.createElement('script');
      let resolved = false;

      function finish(value){
        if(resolved) return;
        resolved = true;
        try { if(script.parentNode) script.parentNode.removeChild(script); } catch(e) {}
        // Mantém callback no-op por alguns segundos para evitar erro se o script chegar atrasado.
        window[callbackName] = function(){};
        setTimeout(() => { try { delete window[callbackName]; } catch(e) {} }, 15000);
        resolve(value || null);
      }

      window[callbackName] = function(data){
        if(data && data.lat && data.lon) {
          finish({ lat: Number(data.lat), lon: Number(data.lon) });
        } else {
          finish(null);
        }
      };

      script.onerror = function(){ finish(null); };
      const timer = setTimeout(() => finish(null), 6500);
      const previousFinish = finish;
      finish = function(value){ clearTimeout(timer); previousFinish(value); };

      const proxyUrl = typeof GAS_GEO_PROXY_URL !== 'undefined' ? GAS_GEO_PROXY_URL : (typeof API !== 'undefined' ? API : '');
      if(!proxyUrl) return finish(null);
      script.src = `${proxyUrl}?action=geocode&address=${encodeURIComponent(addr)}&callback=${callbackName}`;
      document.body.appendChild(script);
    });
  };

  // 4) Geocode público agora é controlado. Só executa quando uma camada de rota pedir
  // explicitamente ou quando a chamada vier de um botão/rota selecionada.
  const previousGeocodeV17 = window.geocodeAddress || (typeof geocodeAddress === 'function' ? geocodeAddress : null);
  if(previousGeocodeV17 && !window.__vescoGeocodeAddressControlledV17){
    window.__vescoGeocodeAddressControlledV17 = true;
    window.geocodeAddress = geocodeAddress = async function(address){
      const addr = cleanAddress(address);
      if(!addressLooksReal(addr)) return null;

      const routeVisible = !!document.querySelector('#view-saiu:not(.hidden), #view-rotas:not(.hidden)');
      const allow = !!window.__vescoAllowRouteGeocodeV17 || routeVisible;
      if(!allow) return null;

      const cache = getCache();
      const key = cacheKey(addr);
      if(cache[key] && Number.isFinite(Number(cache[key].lat)) && Number.isFinite(Number(cache[key].lon))) {
        return cache[key];
      }

      try {
        // Tenta proxy seguro primeiro.
        const fromProxy = await window.geocodeViaVescoProxy(addr);
        if(fromProxy && Number.isFinite(Number(fromProxy.lat)) && Number.isFinite(Number(fromProxy.lon))) {
          cache[key] = fromProxy;
          setCache(cache);
          return fromProxy;
        }
      } catch(e) {}

      try {
        // Fallback direto com AbortController, sem fila infinita.
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), 5000) : null;
        const q = encodeURIComponent(addr.includes('Brasil') ? addr : `${addr}, Brasil`);
        const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&addressdetails=0`, {
          headers: { 'Accept-Language': 'pt-BR' },
          signal: controller ? controller.signal : undefined
        });
        if(timer) clearTimeout(timer);
        const js = await res.json();
        if(Array.isArray(js) && js[0]) {
          const out = { lat: Number(js[0].lat), lon: Number(js[0].lon) };
          if(Number.isFinite(out.lat) && Number.isFinite(out.lon)) {
            cache[key] = out;
            setCache(cache);
            return out;
          }
        }
      } catch(e) {}
      return null;
    };
  }

  // 5) Expõe helper para rotas selecionadas: qualquer função nova pode encapsular geocode.
  window.vescoRouteGeocodeOnceV17 = async function(address){
    window.__vescoAllowRouteGeocodeV17 = true;
    try { return await window.geocodeAddress(address); }
    finally { window.__vescoAllowRouteGeocodeV17 = false; }
  };

  window.vescoGeocodeV17 = {
    debug: function(){
      return {
        activeTab: document.querySelector('#view-logistica:not(.hidden)') ? 'logistica' : document.querySelector('#view-envios_flex:not(.hidden)') ? 'envios_flex' : document.querySelector('#view-saiu:not(.hidden)') ? 'pronto_envio' : document.querySelector('#view-rotas:not(.hidden)') ? 'rotas' : 'outro',
        bulkGeocodeBlocked: true,
        cacheSize: Object.keys(getCache()).length,
        message: 'Logística/Flex só usam lat/lon da planilha. Geocode no navegador apenas para rota selecionada.'
      };
    }
  };

  log(`${LOG_PREFIX} geocodificação em massa bloqueada; rotas selecionadas continuam habilitadas.`);
})();

// =================================================================
// CAMADA V18 — RETIRADAS SOMENTE DE PEDIDOS SEPARADOS + COMPROVANTE
// Regra de Preservação: camada aditiva; não remove a V16, apenas refina
// a página Retiradas para listar somente pedidos separados/prontos e
// registrar quem retirou, como no fluxo de Entregues.
// =================================================================
(function installVescoRetiradasSeparadasV18(){
  if (window.__vescoRetiradasSeparadasV18) return;
  window.__vescoRetiradasSeparadasV18 = true;

  function log(){ try { console.log.apply(console, arguments); } catch(e) {} }
  function warn(){ try { console.warn.apply(console, arguments); } catch(e) {} }
  function esc(v){
    try { return typeof escapeHtml === 'function' ? escapeHtml(v) : String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
    catch(e){ return String(v ?? ''); }
  }
  function toast(msg, type='info', ms=3500){
    try { if(typeof showToast === 'function') return showToast(msg, type, ms); } catch(e) {}
    log(msg);
  }
  function strip(v){ return String(v || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); }
  function norm(v){ return strip(v).toLowerCase().replace(/\s+/g,' ').trim(); }
  function digits(v){ return String(v || '').replace(/\D/g,''); }
  function orderKey(v){
    try { return typeof normalizeOrderNumber === 'function' ? normalizeOrderNumber(v) : String(v ?? '').replace(/^#/,'').trim(); }
    catch(e){ return String(v ?? '').replace(/^#/,'').trim(); }
  }
  function first(o, keys){
    if(!o) return '';
    for(const k of keys){
      if(o[k] !== undefined && o[k] !== null && String(o[k]).trim() !== '') return String(o[k]).trim();
    }
    return '';
  }
  function pools(){
    const out = [];
    try { if(typeof orders !== 'undefined' && Array.isArray(orders)) out.push(...orders); } catch(e) {}
    try { if(Array.isArray(window.orders)) out.push(...window.orders); } catch(e) {}
    try { if(typeof flexOrders !== 'undefined' && Array.isArray(flexOrders)) out.push(...flexOrders); } catch(e) {}
    try { if(Array.isArray(window.flexOrders)) out.push(...window.flexOrders); } catch(e) {}
    return Array.from(new Set(out.filter(Boolean)));
  }
  function findOrder(value){
    const raw = String(value || '').replace(/^#/,'').trim();
    const targetSet = new Set([raw, orderKey(raw), digits(raw)].filter(Boolean));
    return pools().find(o => {
      const vals = [
        o.id, o.numero, o.pedido, o.id_tiny, o.pedido_key, o.numero_ecommerce,
        o.ecom, o.reference, o.referencia, o.order_id, o.orderNumber
      ].map(v => String(v ?? '').replace(/^#/,'').trim());
      return vals.some(v => targetSet.has(v) || targetSet.has(orderKey(v)) || targetSet.has(digits(v)));
    }) || null;
  }
  function selectedDateLabel(){
    try { return isoToBRDate(getSelectedOperationalDateISO()); } catch(e) { return ''; }
  }
  function formatDateBR(v){
    try {
      if(typeof dateValueToISO === 'function') {
        const iso = dateValueToISO(v);
        if(iso) return iso.split('-').reverse().join('/');
      }
    } catch(e) {}
    return String(v || '—');
  }
  function isDelivered(o){
    return /entregue|finalizado|conclu/i.test(String(first(o, ['status_logistica','situacao_nome','situacao','status'])));
  }
  function isPending(o){
    return /pendente|pendencia|pendência/i.test(String(first(o, ['status_logistica','situacao_nome','situacao','status'])));
  }
  function isSeparatedOrReady(o){
    const st = norm(first(o, ['status_logistica','situacao_nome','situacao','status']));
    // Inclui somente pedido que já saiu da fila de separação.
    // Não aceita "A Separar" nem "Em Separação".
    if(/a separar|em separacao|em separa[cç][aã]o/.test(st)) return false;
    if(/separado|pronto p\/ entrega|pronto para entrega|pronto para envio|pronto p\/ envio/.test(st)) return true;
    try { if(typeof isSeparatedReadyStatus === 'function' && isSeparatedReadyStatus(o) && !/a separar|em separa/.test(st)) return true; } catch(e) {}
    return false;
  }
  function isPickup(o){
    try { if(window.vescoV16 && typeof window.vescoV16.normalizeForma === 'function') window.vescoV16.normalizeForma(o); } catch(e) {}
    const id = digits(first(o, ['id_forma_envio','idFormaEnvio','idFormaEnvioPsq','id_forma_envio_psq','forma_envio_id']));
    const text = norm([
      o.tipo_operacional, o.tipo_entrega, o.prioridade_label, o.forma_envio_nome,
      o.nome_forma_envio, o.nomeformafenvio, o.transportadora, o.transportador,
      o.forma_envio, o.forma_frete, o.observacoes_tiny, o.observacao_logistica
    ].join(' | '));
    return Number(o.prioridade_operacional) === 2 || ['747632298','860463094','758290131'].includes(id) || /retirada|retirar pessoalmente|retirar|cliente retira|balcao|balcão/.test(text);
  }
  function shouldShowRetirada(o){
    return !!o && isPickup(o) && isSeparatedOrReady(o) && !isDelivered(o) && !isPending(o);
  }
  function retiradaSort(a,b){
    const da = String(a.data_prevista || a.data_previsao || '9999-12-31');
    const db = String(b.data_prevista || b.data_previsao || '9999-12-31');
    return da.localeCompare(db) || String(a.numero || a.id).localeCompare(String(b.numero || b.id), 'pt-BR', { numeric:true });
  }

  function ensureCss(){
    if(document.getElementById('vesco-v18-retiradas-style')) return;
    const st = document.createElement('style');
    st.id = 'vesco-v18-retiradas-style';
    st.textContent = `
      .vesco-retirada-card-v18{border:1px solid #e2e8f0;border-radius:14px;background:#fff;padding:12px;margin-bottom:10px;box-shadow:0 6px 16px rgba(15,23,42,.04);}
      .vesco-retirada-badge-v18{display:inline-flex;align-items:center;gap:4px;border:1px solid #f5d0fe;background:#faf5ff;color:#7e22ce;border-radius:999px;padding:2px 8px;font-size:10px;font-weight:900;}
      .vesco-retirada-ready-v18{display:inline-flex;align-items:center;gap:4px;border:1px solid #bbf7d0;background:#f0fdf4;color:#047857;border-radius:999px;padding:2px 8px;font-size:10px;font-weight:900;}
      .vesco-retirada-modal-v18{position:fixed;inset:0;background:rgba(15,23,42,.62);backdrop-filter:blur(6px);z-index:7000;display:flex;align-items:center;justify-content:center;padding:16px;}
      .vesco-retirada-modal-v18.hidden{display:none!important;}
      .vesco-retirada-dialog-v18{background:#fff;border:1px solid #e2e8f0;border-radius:18px;box-shadow:0 24px 70px rgba(15,23,42,.28);width:min(520px,100%);padding:18px;}
      .vesco-retirada-dialog-v18 input,.vesco-retirada-dialog-v18 textarea{width:100%;border:1px solid #dbe4f0;border-radius:12px;padding:10px;font-size:13px;font-weight:700;outline:none;background:#f8fafc;}
      .vesco-retirada-dialog-v18 input:focus,.vesco-retirada-dialog-v18 textarea:focus{border-color:#2563eb;background:#fff;}
      @media(max-width:768px){.vesco-retirada-card-v18{font-size:12px}.vesco-retirada-actions-v18{width:100%;display:grid;grid-template-columns:1fr;}.vesco-retirada-actions-v18 button{width:100%;}}
    `;
    document.head.appendChild(st);
  }

  function ensureView(){
    ensureCss();
    if(!document.getElementById('main-retiradas-v16') && !document.getElementById('main-retiradas-v18')) {
      const btn = document.createElement('button');
      btn.id = 'main-retiradas-v18';
      btn.className = 'tab-btn';
      btn.innerHTML = '<i class="fas fa-hand-holding-box text-purple-600"></i>Retiradas';
      btn.onclick = () => switchTab('retiradas_v16');
      const anchor = document.getElementById('main-saiu') || document.getElementById('main-rotas') || document.getElementById('main-log');
      if(anchor && anchor.parentElement) anchor.insertAdjacentElement('afterend', btn);
    }
    let sec = document.getElementById('view-retiradas-v16') || document.getElementById('view-retiradas-v18');
    if(!sec){
      const main = document.querySelector('main') || document.body;
      sec = document.createElement('section');
      sec.id = 'view-retiradas-v16';
      sec.className = 'hidden w-full space-y-3';
      main.appendChild(sec);
    }
    sec.innerHTML = `
      <div class="card p-3 md:p-5 w-full rounded-xl border border-slate-200 bg-white">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-2 mb-3">
          <div>
            <h2 class="font-black text-slate-800 uppercase tracking-wide text-sm"><i class="fas fa-hand-holding-box text-purple-600 mr-2"></i>Pedidos separados para retirada</h2>
            <p class="text-xs text-slate-500 mt-1">Aparecem aqui somente pedidos com forma de envio Retirada/Retirar pessoalmente e status Separado/Pronto. Pedidos ainda A Separar continuam na Separação.</p>
          </div>
          <button type="button" onclick="window.renderRetiradasV18 && window.renderRetiradasV18()" class="bg-slate-900 text-white px-3 py-2 rounded-lg text-xs font-bold">Atualizar retiradas</button>
        </div>
        <div id="retiradas-list-v16" class="vesco-mobile-scroll-v16"></div>
      </div>`;
    ensureModal();
  }

  function ensureModal(){
    if(document.getElementById('retiradaModalV18')) return;
    const modal = document.createElement('div');
    modal.id = 'retiradaModalV18';
    modal.className = 'vesco-retirada-modal-v18 hidden';
    modal.innerHTML = `
      <div class="vesco-retirada-dialog-v18">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center"><i class="fas fa-hand-holding-box"></i></div>
            <div>
              <h3 class="text-lg font-black text-slate-800 leading-none">Registrar retirada</h3>
              <div id="retiradaPedidoDisplayV18" class="text-xs text-slate-500 font-bold mt-1">Pedido #---</div>
            </div>
          </div>
          <button type="button" onclick="window.fecharRetiradaModalV18 && window.fecharRetiradaModalV18()" class="text-slate-400 hover:text-slate-700 text-xl font-black">×</button>
        </div>
        <input type="hidden" id="retiradaPedidoIdV18">
        <div class="space-y-3">
          <div>
            <label class="block text-[11px] font-black text-slate-500 uppercase mb-1">Nome de quem retirou</label>
            <input id="retiradaNomeV18" placeholder="Ex: João Silva">
          </div>
          <div>
            <label class="block text-[11px] font-black text-slate-500 uppercase mb-1">Documento RG ou CPF</label>
            <input id="retiradaDocV18" placeholder="Apenas números ou documento informado">
          </div>
          <div>
            <label class="block text-[11px] font-black text-slate-500 uppercase mb-1">Observação opcional</label>
            <textarea id="retiradaObsV18" rows="2" placeholder="Ex: retirado no balcão por autorização do comprador"></textarea>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-2 mt-4">
          <button type="button" onclick="window.fecharRetiradaModalV18 && window.fecharRetiradaModalV18()" class="bg-slate-100 hover:bg-slate-200 text-slate-700 py-2.5 rounded-xl font-bold text-sm">Cancelar</button>
          <button type="button" onclick="window.confirmarRetiradaV18 && window.confirmarRetiradaV18()" class="bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-xl font-black text-sm">Confirmar retirada</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }

  window.abrirRetiradaModalV18 = function(id){
    ensureModal();
    const o = findOrder(id);
    const display = o ? (o.numero || o.id || id) : id;
    const modal = document.getElementById('retiradaModalV18');
    document.getElementById('retiradaPedidoIdV18').value = id;
    document.getElementById('retiradaPedidoDisplayV18').innerText = `Pedido #${display}`;
    document.getElementById('retiradaNomeV18').value = '';
    document.getElementById('retiradaDocV18').value = '';
    document.getElementById('retiradaObsV18').value = '';
    modal.classList.remove('hidden');
    setTimeout(() => document.getElementById('retiradaNomeV18')?.focus(), 80);
  };
  window.fecharRetiradaModalV18 = function(){
    document.getElementById('retiradaModalV18')?.classList.add('hidden');
  };
  window.confirmarRetiradaV18 = function(){
    const id = document.getElementById('retiradaPedidoIdV18')?.value || '';
    const nome = document.getElementById('retiradaNomeV18')?.value.trim() || '';
    const doc = document.getElementById('retiradaDocV18')?.value.trim() || '';
    const obs = document.getElementById('retiradaObsV18')?.value.trim() || '';
    if(!id) return alert('Pedido não identificado.');
    if(!nome) return alert('Informe o nome de quem retirou.');
    const docLimpo = doc.replace(/\D/g,'');
    if(docLimpo.length < 6) return alert('Informe um documento válido de quem retirou.');

    const msgAudit = `Retirada presencial | Recebido por: ${nome} (Doc: ${doc || 'Não informado'})${obs ? ' | Obs: ' + obs : ''}`;
    const o = findOrder(id);
    if(o){
      o.status_logistica = 'Entregue';
      o.situacao_nome = 'Entregue';
      o.nome_recebedor = nome;
      o.doc_recebedor = doc || 'Não informado';
      o.entregue_em = new Date().toISOString();
      o.data_entregue = new Date().toLocaleDateString('pt-BR');
      o.data_entrega_realizada = o.data_entregue;
      o.observacao_logistica = [o.observacao_logistica, msgAudit].filter(Boolean).join(' | ');
    }
    try { if(typeof rememberStatusTransition === 'function') rememberStatusTransition(id, 'Entregue'); } catch(e) {}
    try { if(window.vescoDeliveredV6 && typeof window.vescoDeliveredV6.markDeliveredLocal === 'function') window.vescoDeliveredV6.markDeliveredLocal(id, nome, doc || 'Não informado', msgAudit); } catch(e) {}
    try { if(typeof syncGlobalOrderState === 'function') syncGlobalOrderState(); } catch(e) {}
    window.fecharRetiradaModalV18();
    try { if(typeof updateStatusJsonp === 'function') updateStatusJsonp(id, 'Entregue', msgAudit); } catch(e) { warn(e); }
    setTimeout(() => {
      try { window.renderRetiradasV18(); } catch(e) {}
      try { if(typeof render === 'function') render(); } catch(e) {}
      toast('Retirada registrada e enviada para Entregues.', 'success', 3500);
    }, 450);
  };

  window.renderRetiradasV18 = function(){
    ensureView();
    const el = document.getElementById('retiradas-list-v16');
    if(!el) return;
    const list = pools().filter(shouldShowRetirada).sort(retiradaSort);
    const pickupTotal = pools().filter(o => isPickup(o) && !isDelivered(o)).length;
    const awaitingSep = pools().filter(o => isPickup(o) && !isDelivered(o) && !isSeparatedOrReady(o)).length;

    if(!list.length){
      el.innerHTML = `
        <div class="p-5 text-center text-slate-400 font-bold">
          Nenhum pedido separado para retirada encontrado para ${esc(selectedDateLabel() || 'a data selecionada')}.
          ${awaitingSep ? `<div class="text-xs text-slate-500 mt-2">Existem ${awaitingSep} retirada(s) ainda não separada(s), por isso continuam na aba Separação.</div>` : ''}
        </div>`;
      return;
    }

    el.innerHTML = `
      <div class="text-xs text-slate-500 font-bold mb-3 flex flex-wrap gap-2">
        <span class="px-2 py-1 rounded bg-purple-50 text-purple-700 border border-purple-100">${list.length} separado(s) para retirada</span>
        ${awaitingSep ? `<span class="px-2 py-1 rounded bg-slate-50 text-slate-600 border border-slate-200">${awaitingSep} retirada(s) aguardando separação</span>` : ''}
        <span class="px-2 py-1 rounded bg-slate-50 text-slate-500 border border-slate-200">Total de retiradas abertas: ${pickupTotal}</span>
      </div>
      ${list.map(o => {
        const id = String(o.id || o.numero || '');
        const num = esc(o.numero || o.id || 'S/N');
        const cliente = esc(o.cliente_nome || o.destinatario || o.nome || '');
        const forma = esc(o.forma_envio_nome || o.nome_forma_envio || o.transportadora || o.forma_envio || 'Retirada');
        const conta = esc(o.conta_tiny || o.conta || '');
        const data = esc(formatDateBR(o.data_prevista || o.data_previsao));
        const obs = esc(o.observacao_pedido || o.observacao_logistica || '');
        const link = esc(o.link_pedido || o.link_tiny || '');
        return `
          <div class="vesco-retirada-card-v18">
            <div class="flex flex-col md:flex-row md:items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <b class="text-slate-900">#${num}</b>
                  <span class="vesco-retirada-badge-v18">2 - Retirada</span>
                  <span class="vesco-retirada-ready-v18">Separado / Pronto</span>
                  <span class="text-[10px] text-slate-500 font-bold">${forma}</span>
                </div>
                <div class="font-bold text-slate-700 mt-1">${cliente}</div>
                <div class="text-xs text-slate-500 mt-1">Data prevista: <b>${data}</b>${conta ? ` • Conta: ${conta}` : ''}</div>
                <div class="text-xs text-slate-500 mt-1">${esc(o.endereco_completo || 'Retirada presencial / endereço não necessário')}</div>
                ${(obs || link) ? `<div class="mt-2 text-xs bg-slate-50 border border-slate-200 rounded-lg p-2">${obs ? `<div><b>Obs:</b> ${obs}</div>` : ''}${link ? `<div><b>Link:</b> <a class="text-blue-600 font-bold" href="${link}" target="_blank">abrir pedido</a></div>` : ''}</div>` : ''}
              </div>
              <div class="vesco-retirada-actions-v18 flex flex-col gap-2 md:w-48">
                <button class="bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-3 py-2 text-xs font-black" onclick="window.abrirRetiradaModalV18 && window.abrirRetiradaModalV18('${esc(id)}')">Registrar quem retirou</button>
                <button class="bg-amber-500 hover:bg-amber-600 text-white rounded-lg px-3 py-2 text-xs font-black" onclick="window.moverParaPendenciaPrompt && window.moverParaPendenciaPrompt('${esc(id)}')">Pendência</button>
              </div>
            </div>
          </div>`;
      }).join('')}`;
  };

  // Mantém compatibilidade com botão antigo "Marcar retirado", mas agora exige identificação.
  window.concluirRetiradaV16 = function(id){ return window.abrirRetiradaModalV18(id); };
  window.concluirRetiradaV18 = window.abrirRetiradaModalV18;

  // Wrap do switchTab para garantir que a aba Retiradas mostre a visão V18.
  if(!window.__vescoSwitchV18Wrapped && typeof window.switchTab === 'function'){
    const oldSwitch = window.switchTab;
    window.__vescoSwitchV18Wrapped = true;
    window.switchTab = function(which){
      const isRet = which === 'retiradas_v16' || which === 'retiradas_v18' || which === 'retiradas' || which === 'retirada';
      const res = isRet ? oldSwitch.call(this, 'separacao') : oldSwitch.apply(this, arguments);
      const view = document.getElementById('view-retiradas-v16') || document.getElementById('view-retiradas-v18');
      if(view) view.classList.toggle('hidden', !isRet);
      const btn = document.getElementById('main-retiradas-v16') || document.getElementById('main-retiradas-v18');
      if(btn) btn.className = isRet ? 'tab-btn active' : 'tab-btn';
      if(isRet) setTimeout(window.renderRetiradasV18, 80);
      return res;
    };
  }

  // Depois de qualquer renderização, se a aba estiver aberta, reaplica a lista filtrada.
  if(!window.__vescoRenderV18Wrapped){
    const oldRender = typeof render === 'function' ? render : window.render;
    if(typeof oldRender === 'function'){
      window.__vescoRenderV18Wrapped = true;
      window.render = render = function(){
        const res = oldRender.apply(this, arguments);
        setTimeout(() => {
          const view = document.getElementById('view-retiradas-v16') || document.getElementById('view-retiradas-v18');
          if(view && !view.classList.contains('hidden')) window.renderRetiradasV18();
        }, 100);
        return res;
      };
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    ensureView();
    setTimeout(() => {
      const view = document.getElementById('view-retiradas-v16') || document.getElementById('view-retiradas-v18');
      if(view && !view.classList.contains('hidden')) window.renderRetiradasV18();
    }, 700);
  });

  window.vescoRetiradasV18 = {
    debug: function(){
      const all = pools();
      return {
        totalPedidos: all.length,
        retiradasAbertas: all.filter(o => isPickup(o) && !isDelivered(o)).length,
        retiradasSeparadas: all.filter(shouldShowRetirada).length,
        retiradasAguardandoSeparacao: all.filter(o => isPickup(o) && !isDelivered(o) && !isSeparatedOrReady(o)).length,
        regra: 'Retiradas só aparecem se prioridade/formato for retirada e status estiver Separado/Pronto. A Separar fica na Separação.'
      };
    },
    render: window.renderRetiradasV18,
    shouldShow: shouldShowRetirada,
    openModal: window.abrirRetiradaModalV18
  };

  log('V18 ativo — Retiradas mostra somente pedidos separados e registra quem retirou com nome/documento.');
})();

// =================================================================
// CAMADA V19 — RETIRADAS COMO PÁGINA ISOLADA, NÃO REPLICA SEPARAÇÃO
// Regra de Preservação: mantém V16/V18 intactas e apenas corrige
// a navegação para esconder a aba Separação quando Retiradas estiver ativa.
// =================================================================
(function installVescoRetiradasStandaloneV19(){
  if (window.__vescoRetiradasStandaloneV19) return;
  window.__vescoRetiradasStandaloneV19 = true;

  function log(){ try { console.log.apply(console, arguments); } catch(e) {} }

  function isRetiradasKey(which){
    return ['retiradas', 'retirada', 'retiradas_v16', 'retiradas_v18', 'retiradas_v19'].includes(String(which || '').trim());
  }

  function getRetiradasView(){
    return document.getElementById('view-retiradas-v16') ||
           document.getElementById('view-retiradas-v18') ||
           document.getElementById('view-retiradas-v19');
  }

  function getRetiradasButton(){
    return document.getElementById('main-retiradas-v16') ||
           document.getElementById('main-retiradas-v18') ||
           document.getElementById('main-retiradas-v19');
  }

  function ensureRetiradasExists(){
    // A V18 já cria a página correta. Chamamos o render apenas para garantir
    // que o HTML exista antes de alternar a visualização.
    try {
      if (typeof window.renderRetiradasV18 === 'function') {
        const viewBefore = getRetiradasView();
        if (!viewBefore) window.renderRetiradasV18();
      }
    } catch(e) {}

    let view = getRetiradasView();
    if (!view) {
      const main = document.querySelector('main') || document.body;
      view = document.createElement('section');
      view.id = 'view-retiradas-v19';
      view.className = 'hidden w-full space-y-3';
      view.innerHTML = `
        <div class="card p-3 md:p-5 w-full rounded-xl border border-slate-200 bg-white">
          <div class="flex flex-col md:flex-row md:items-center justify-between gap-2 mb-3">
            <div>
              <h2 class="font-black text-slate-800 uppercase tracking-wide text-sm">Retiradas</h2>
              <p class="text-xs text-slate-500 mt-1">Pedidos separados/prontos para retirada.</p>
            </div>
          </div>
          <div id="retiradas-list-v16" class="vesco-mobile-scroll-v16"></div>
        </div>`;
      main.appendChild(view);
    }

    let btn = getRetiradasButton();
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'main-retiradas-v19';
      btn.className = 'tab-btn';
      btn.innerHTML = '<i class="fas fa-hand-holding-box text-purple-600"></i>Retiradas';
      const anchor = document.getElementById('main-saiu') || document.getElementById('main-rotas') || document.getElementById('main-log');
      if (anchor && anchor.parentElement) anchor.insertAdjacentElement('afterend', btn);
      else (document.querySelector('.tab-nav .flex') || document.body).appendChild(btn);
    }
    btn.onclick = function(ev){ if(ev) ev.preventDefault(); window.switchTab('retiradas_v19'); return false; };
    return { view, btn };
  }

  function setAllMainViewsHiddenExceptRetiradas(){
    const retView = getRetiradasView();
    const selectors = [
      'main > section[id^="view-"]',
      'body > section[id^="view-"]',
      '#view-saiu',
      '#view-pronto-envio',
      '#view-pronto_envio',
      '#view-pronto_para_envio'
    ];
    const nodes = Array.from(new Set(selectors.flatMap(sel => Array.from(document.querySelectorAll(sel)))));
    nodes.forEach(el => {
      if (!el) return;
      if (retView && el === retView) return;
      // Garante que Separação e demais abas não fiquem por baixo da Retiradas.
      el.classList.add('hidden');
    });
    if (retView) retView.classList.remove('hidden');
  }

  function setRetiradasTabActive(){
    document.querySelectorAll('.tab-btn').forEach(btn => {
      if (btn === getRetiradasButton()) return;
      btn.classList.remove('active');
      // Alguns wrappers antigos sobrescrevem className manualmente.
      if (btn.className === 'tab-btn active') btn.className = 'tab-btn';
    });
    const btn = getRetiradasButton();
    if (btn) btn.className = 'tab-btn active';
  }

  function renderRetiradasOnly(){
    const { view } = ensureRetiradasExists();
    setAllMainViewsHiddenExceptRetiradas();
    setRetiradasTabActive();
    try { if (typeof window.renderRetiradasV18 === 'function') window.renderRetiradasV18(); } catch(e) {}
    setTimeout(() => {
      setAllMainViewsHiddenExceptRetiradas();
      setRetiradasTabActive();
    }, 80);
    setTimeout(() => {
      setAllMainViewsHiddenExceptRetiradas();
      setRetiradasTabActive();
    }, 250);
    return view;
  }

  if (!window.__vescoSwitchV19Wrapped && typeof window.switchTab === 'function') {
    const previousSwitch = window.switchTab;
    window.__vescoSwitchV19Wrapped = true;

    window.switchTab = function(which){
      if (isRetiradasKey(which)) {
        // Chama a cadeia antiga com uma chave neutra para ela esconder as telas conhecidas,
        // sem ativar Separação. Depois mostramos somente Retiradas.
        try { previousSwitch.call(this, '__vesco_retiradas_only__'); } catch(e) {}
        return renderRetiradasOnly();
      }

      const result = previousSwitch.apply(this, arguments);
      const retView = getRetiradasView();
      if (retView) retView.classList.add('hidden');
      const retBtn = getRetiradasButton();
      if (retBtn) retBtn.className = 'tab-btn';
      return result;
    };
  }

  // Captura cliques em botões antigos de Retiradas criados por V16/V18.
  document.addEventListener('click', function(e){
    const btn = e.target && e.target.closest && e.target.closest('#main-retiradas-v16, #main-retiradas-v18, #main-retiradas-v19');
    if (!btn) return;
    e.preventDefault();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    else e.stopPropagation();
    window.switchTab('retiradas_v19');
    return false;
  }, true);

  // Se a página abrir já com Retiradas visível por algum estado antigo, corrige.
  document.addEventListener('DOMContentLoaded', function(){
    ensureRetiradasExists();
    const view = getRetiradasView();
    if (view && !view.classList.contains('hidden')) renderRetiradasOnly();
  });

  window.vescoRetiradasV19 = {
    render: renderRetiradasOnly,
    debug: function(){
      const retView = getRetiradasView();
      return {
        active: !!retView && !retView.classList.contains('hidden'),
        separacaoHidden: !!document.getElementById('view-separacao')?.classList.contains('hidden'),
        viewId: retView ? retView.id : null,
        regra: 'Retiradas é uma página isolada. Ao abrir, view-separacao e demais abas ficam hidden.'
      };
    }
  };

  log('V19 ativo — Retiradas isolada, sem replicar a página de Separação.');
})();

// =================================================================
// CAMADA V20 — RESPONSIVIDADE TOTAL / MOBILE-FIRST SEM QUEBRAR LEGADO
// Regra de Preservação: camada aditiva. Não remove tabelas, abas, funções
// nem lógicas anteriores; apenas cria uma malha visual responsiva e
// sincroniza com renderizações existentes.
// =================================================================
(function installVescoResponsiveSystemV20(){
  if (window.__vescoResponsiveSystemV20) return;
  window.__vescoResponsiveSystemV20 = true;

  const STYLE_ID = 'vesco-responsive-system-v20-style';
  const MOBILE_BREAKPOINT = 768;
  const SMALL_BREAKPOINT = 420;
  let labelTimer = null;
  let layoutTimer = null;
  let observer = null;

  function log(){ try { console.log.apply(console, arguments); } catch(e) {} }

  function isMobile(){
    return Math.min(window.innerWidth || 9999, screen.width || 9999) <= MOBILE_BREAKPOINT;
  }

  function isSmall(){
    return Math.min(window.innerWidth || 9999, screen.width || 9999) <= SMALL_BREAKPOINT;
  }

  function injectViewportFix(){
    let vp = document.querySelector('meta[name="viewport"]');
    if(!vp) {
      vp = document.createElement('meta');
      vp.setAttribute('name', 'viewport');
      document.head.appendChild(vp);
    }
    vp.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover');
  }

  function injectCss(){
    if(document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      :root{
        --vesco-mobile-safe-bottom: env(safe-area-inset-bottom, 0px);
        --vesco-mobile-safe-top: env(safe-area-inset-top, 0px);
        --vesco-mobile-radius: 14px;
        --vesco-mobile-border: #e2e8f0;
      }

      html, body{
        width:100%;
        max-width:100%;
        overflow-x:hidden;
        -webkit-text-size-adjust:100%;
        text-size-adjust:100%;
      }

      *{ box-sizing:border-box; }
      img, svg, canvas, video{ max-width:100%; }
      input, select, textarea, button{ max-width:100%; }

      .vesco-rsp-scroll-x{
        overflow-x:auto !important;
        -webkit-overflow-scrolling:touch !important;
      }

      .vesco-rsp-soft-scroll{
        scrollbar-width:thin;
      }

      .vesco-rsp-soft-scroll::-webkit-scrollbar{ height:6px; width:6px; }
      .vesco-rsp-soft-scroll::-webkit-scrollbar-thumb{ background:#cbd5e1; border-radius:999px; }

      .vesco-mobile-only{ display:none !important; }

      .vesco-rsp-card-grid{
        display:grid;
        gap:12px;
        grid-template-columns:repeat(auto-fit, minmax(260px, 1fr));
      }

      .vesco-rsp-no-overflow{
        min-width:0 !important;
        max-width:100% !important;
      }

      @media (max-width: 1024px){
        main{ max-width:100vw !important; }
        .grid{ min-width:0 !important; }
        #view-logistica .grid,
        #view-envios_flex .grid,
        #view-rotas .grid{
          grid-template-columns:1fr !important;
        }
      }

      @media (max-width: 768px){
        body.vesco-rsp-mobile{ background:#f8fafc; }
        body.vesco-rsp-mobile .vesco-mobile-only{ display:initial !important; }
        body.vesco-rsp-mobile .vesco-desktop-only{ display:none !important; }

        body.vesco-rsp-mobile header{
          position:sticky;
          top:0;
          z-index:1200;
          padding:8px 10px !important;
          gap:8px !important;
        }

        body.vesco-rsp-mobile header > div{
          width:100% !important;
          min-width:0 !important;
        }

        body.vesco-rsp-mobile header .flex,
        body.vesco-rsp-mobile header [class*="flex"]{
          min-width:0 !important;
        }

        body.vesco-rsp-mobile .tab-nav{
          position:sticky;
          top:var(--vesco-rsp-header-height, 0px);
          z-index:1100;
          padding:6px 8px !important;
          gap:6px !important;
          border-bottom:1px solid #e2e8f0;
          overflow:hidden !important;
        }

        body.vesco-rsp-mobile .tab-nav > div:first-child{
          width:100% !important;
          max-width:100% !important;
          display:flex !important;
          gap:6px !important;
          overflow-x:auto !important;
          overflow-y:hidden !important;
          -webkit-overflow-scrolling:touch;
          padding-bottom:4px;
          scroll-snap-type:x proximity;
        }

        body.vesco-rsp-mobile .tab-nav > div:first-child::-webkit-scrollbar{ display:none; }

        body.vesco-rsp-mobile .tab-btn{
          flex:0 0 auto !important;
          min-width:max-content !important;
          padding:9px 12px !important;
          border-radius:12px !important;
          font-size:12px !important;
          line-height:1 !important;
          scroll-snap-align:start;
        }

        body.vesco-rsp-mobile .tab-btn i{ margin-right:5px; }

        body.vesco-rsp-mobile .tab-nav > div:last-child{
          width:100% !important;
          display:grid !important;
          grid-template-columns:1fr !important;
          gap:6px !important;
          padding:0 !important;
        }

        body.vesco-rsp-mobile .tab-nav input#search,
        body.vesco-rsp-mobile #search{
          height:38px !important;
          font-size:14px !important;
        }

        body.vesco-rsp-mobile main{
          width:100% !important;
          max-width:100vw !important;
          padding:8px !important;
          margin:0 !important;
        }

        body.vesco-rsp-mobile section[id^="view-"]{
          width:100% !important;
          max-width:100% !important;
          min-width:0 !important;
        }

        body.vesco-rsp-mobile .card,
        body.vesco-rsp-mobile .rounded-xl,
        body.vesco-rsp-mobile .rounded-2xl{
          max-width:100% !important;
        }

        body.vesco-rsp-mobile .card{
          padding:10px !important;
          border-radius:var(--vesco-mobile-radius) !important;
          overflow:hidden !important;
        }

        body.vesco-rsp-mobile .grid,
        body.vesco-rsp-mobile [class*="grid-cols-"]{
          grid-template-columns:1fr !important;
          gap:10px !important;
        }

        body.vesco-rsp-mobile [class*="lg:col-span"],
        body.vesco-rsp-mobile [class*="md:col-span"]{
          grid-column:auto !important;
        }

        body.vesco-rsp-mobile .flex{
          min-width:0 !important;
        }

        body.vesco-rsp-mobile .vesco-rsp-wrap,
        body.vesco-rsp-mobile td:last-child > div,
        body.vesco-rsp-mobile .action-group,
        body.vesco-rsp-mobile .acoes,
        body.vesco-rsp-mobile .actions{
          display:flex !important;
          flex-wrap:wrap !important;
          gap:6px !important;
          justify-content:flex-start !important;
        }

        body.vesco-rsp-mobile button,
        body.vesco-rsp-mobile .btn,
        body.vesco-rsp-mobile a[role="button"]{
          min-height:34px;
          touch-action:manipulation;
        }

        body.vesco-rsp-mobile textarea{
          min-height:64px;
        }

        body.vesco-rsp-mobile input,
        body.vesco-rsp-mobile select,
        body.vesco-rsp-mobile textarea{
          font-size:14px !important;
        }

        /* Conversão universal de tabelas em cards no celular */
        body.vesco-rsp-mobile table.vesco-responsive-table{
          display:block !important;
          width:100% !important;
          min-width:0 !important;
          border:0 !important;
        }

        body.vesco-rsp-mobile table.vesco-responsive-table thead{
          display:none !important;
        }

        body.vesco-rsp-mobile table.vesco-responsive-table tbody{
          display:block !important;
          width:100% !important;
        }

        body.vesco-rsp-mobile table.vesco-responsive-table tr{
          display:block !important;
          width:100% !important;
          margin:0 0 10px 0 !important;
          padding:10px !important;
          background:#fff !important;
          border:1px solid var(--vesco-mobile-border) !important;
          border-radius:14px !important;
          box-shadow:0 8px 20px rgba(15,23,42,.04) !important;
          overflow:hidden !important;
        }

        body.vesco-rsp-mobile table.vesco-responsive-table td{
          display:flex !important;
          align-items:flex-start !important;
          justify-content:space-between !important;
          gap:10px !important;
          width:100% !important;
          max-width:100% !important;
          padding:7px 0 !important;
          border:0 !important;
          border-bottom:1px dashed #e5e7eb !important;
          text-align:right !important;
          white-space:normal !important;
          overflow:visible !important;
          overflow-wrap:anywhere !important;
          word-break:break-word !important;
          font-size:12px !important;
          line-height:1.25 !important;
        }

        body.vesco-rsp-mobile table.vesco-responsive-table td:last-child{
          border-bottom:0 !important;
          padding-bottom:0 !important;
        }

        body.vesco-rsp-mobile table.vesco-responsive-table td::before{
          content:attr(data-label);
          flex:0 0 42%;
          max-width:42%;
          text-align:left;
          font-size:9px;
          line-height:1.15;
          font-weight:900;
          color:#64748b;
          text-transform:uppercase;
          letter-spacing:.02em;
          overflow-wrap:anywhere;
        }

        body.vesco-rsp-mobile table.vesco-responsive-table td[data-label="" ]::before{
          display:none;
        }

        body.vesco-rsp-mobile table.vesco-responsive-table td[data-label*="Ação"],
        body.vesco-rsp-mobile table.vesco-responsive-table td[data-label*="Status"],
        body.vesco-rsp-mobile table.vesco-responsive-table td[data-label*="Solução"]{
          display:block !important;
          text-align:left !important;
        }

        body.vesco-rsp-mobile table.vesco-responsive-table td[data-label*="Ação"]::before,
        body.vesco-rsp-mobile table.vesco-responsive-table td[data-label*="Status"]::before,
        body.vesco-rsp-mobile table.vesco-responsive-table td[data-label*="Solução"]::before{
          display:block;
          max-width:100%;
          margin-bottom:6px;
        }

        body.vesco-rsp-mobile table.vesco-responsive-table td .flex,
        body.vesco-rsp-mobile table.vesco-responsive-table td > div{
          max-width:100% !important;
          min-width:0 !important;
        }

        body.vesco-rsp-mobile table.vesco-responsive-table td button{
          margin:2px 2px 2px 0 !important;
          white-space:normal !important;
        }

        body.vesco-rsp-mobile table.vesco-responsive-table td input,
        body.vesco-rsp-mobile table.vesco-responsive-table td textarea{
          width:100% !important;
          min-width:0 !important;
        }

        body.vesco-rsp-mobile table.vesco-responsive-table .hidden,
        body.vesco-rsp-mobile table.vesco-responsive-table .md\\:table-cell,
        body.vesco-rsp-mobile table.vesco-responsive-table .lg\\:table-cell{
          display:flex !important;
        }

        /* Áreas específicas */
        body.vesco-rsp-mobile #view-saiu,
        body.vesco-rsp-mobile #view-rotas,
        body.vesco-rsp-mobile #view-retiradas-v16,
        body.vesco-rsp-mobile #view-retiradas-v18,
        body.vesco-rsp-mobile #view-retiradas-v19{
          width:100% !important;
          max-width:100% !important;
        }

        body.vesco-rsp-mobile #view-saiu .grid,
        body.vesco-rsp-mobile #view-rotas .grid{
          display:grid !important;
          grid-template-columns:1fr !important;
        }

        body.vesco-rsp-mobile #saiu-pedidos-list,
        body.vesco-rsp-mobile #saiu-rota-selected,
        body.vesco-rsp-mobile #table-rotas,
        body.vesco-rsp-mobile #saiu-rotas-list{
          max-height:none !important;
          width:100% !important;
          overflow-x:hidden !important;
        }

        body.vesco-rsp-mobile .pedido-item{
          display:grid !important;
          grid-template-columns:auto 1fr !important;
          gap:8px !important;
          max-width:100% !important;
        }

        body.vesco-rsp-mobile .pedido-item button{
          width:auto !important;
        }

        body.vesco-rsp-mobile .map-wrapper,
        body.vesco-rsp-mobile #vesco-route-map-panel-v6,
        body.vesco-rsp-mobile #vesco-route-map-panel-v12,
        body.vesco-rsp-mobile #vesco-route-map-panel-v13{
          width:100% !important;
          max-width:100% !important;
          min-height:280px !important;
          height:auto !important;
        }

        body.vesco-rsp-mobile #map,
        body.vesco-rsp-mobile #map-flex,
        body.vesco-rsp-mobile #map-rotas,
        body.vesco-rsp-mobile #vesco-route-map-v5,
        body.vesco-rsp-mobile #vesco-route-map-v6,
        body.vesco-rsp-mobile #vesco-route-map-v12,
        body.vesco-rsp-mobile #vesco-route-map-v13,
        body.vesco-rsp-mobile #vesco-route-map-v20{
          width:100% !important;
          height:320px !important;
          min-height:320px !important;
          max-height:55vh !important;
        }

        body.vesco-rsp-mobile .summary-box{
          position:relative !important;
          bottom:auto !important;
          right:auto !important;
          width:100% !important;
          margin-top:8px !important;
        }

        body.vesco-rsp-mobile .map-toolbar{
          transform:scale(.9);
          transform-origin:top right;
        }

        body.vesco-rsp-mobile #vesco-saiu-layout-v6,
        body.vesco-rsp-mobile #vesco-saiu-layout-v12,
        body.vesco-rsp-mobile #vesco-saiu-layout-v13,
        body.vesco-rsp-mobile #vesco-saiu-layout-v20{
          display:grid !important;
          grid-template-columns:1fr !important;
          gap:10px !important;
          width:100% !important;
        }

        body.vesco-rsp-mobile #vesco-saiu-right-v6,
        body.vesco-rsp-mobile #vesco-saiu-right-v12,
        body.vesco-rsp-mobile #vesco-saiu-right-v13,
        body.vesco-rsp-mobile #vesco-saiu-right-v20{
          position:relative !important;
          top:0 !important;
          width:100% !important;
          order:2;
        }

        body.vesco-rsp-mobile #vesco-saiu-left-v6,
        body.vesco-rsp-mobile #vesco-saiu-left-v12,
        body.vesco-rsp-mobile #vesco-saiu-left-v13,
        body.vesco-rsp-mobile #vesco-saiu-left-v20{
          width:100% !important;
          min-width:0 !important;
          order:1;
        }

        body.vesco-rsp-mobile .fixed.inset-0 > div{
          max-width:calc(100vw - 18px) !important;
          max-height:calc(100vh - 18px) !important;
          overflow:auto !important;
        }

        body.vesco-rsp-mobile #operatorModal input,
        body.vesco-rsp-mobile #pendenciaModal input,
        body.vesco-rsp-mobile #pendenciaModal textarea,
        body.vesco-rsp-mobile #pendenciaModal select{
          width:100% !important;
        }

        body.vesco-rsp-mobile .leaflet-control-container{
          font-size:12px !important;
        }
      }

      @media (max-width: 420px){
        body.vesco-rsp-mobile header{
          padding:7px !important;
        }
        body.vesco-rsp-mobile .tab-btn{
          font-size:11px !important;
          padding:8px 10px !important;
        }
        body.vesco-rsp-mobile main{
          padding:6px !important;
        }
        body.vesco-rsp-mobile .card{
          padding:8px !important;
        }
        body.vesco-rsp-mobile table.vesco-responsive-table tr{
          padding:8px !important;
        }
        body.vesco-rsp-mobile table.vesco-responsive-table td{
          gap:7px !important;
          font-size:11px !important;
        }
        body.vesco-rsp-mobile table.vesco-responsive-table td::before{
          flex-basis:38%;
          max-width:38%;
          font-size:8px;
        }
        body.vesco-rsp-mobile button{
          font-size:10px !important;
          padding-left:8px !important;
          padding-right:8px !important;
        }
        body.vesco-rsp-mobile #map,
        body.vesco-rsp-mobile #map-flex,
        body.vesco-rsp-mobile #map-rotas,
        body.vesco-rsp-mobile #vesco-route-map-v5,
        body.vesco-rsp-mobile #vesco-route-map-v6,
        body.vesco-rsp-mobile #vesco-route-map-v12,
        body.vesco-rsp-mobile #vesco-route-map-v13,
        body.vesco-rsp-mobile #vesco-route-map-v20{
          height:285px !important;
          min-height:285px !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function getHeaderHeight(){
    const header = document.querySelector('header');
    if(!header) return 0;
    return Math.ceil(header.getBoundingClientRect().height || 0);
  }

  function applyModeClass(){
    document.body.classList.toggle('vesco-rsp-mobile', isMobile());
    document.body.classList.toggle('vesco-rsp-small', isSmall());
    document.documentElement.style.setProperty('--vesco-rsp-header-height', `${getHeaderHeight()}px`);
  }

  function cleanText(v){
    return String(v || '').replace(/\s+/g, ' ').trim();
  }

  function tableHeaderLabels(table){
    const headers = Array.from(table.querySelectorAll('thead th')).map(th => cleanText(th.innerText || th.textContent));
    return headers;
  }

  function inferLabelFromCell(td, idx){
    const row = td.parentElement;
    const table = td.closest('table');
    const tableId = table ? table.id || table.closest('section')?.id || '' : '';
    const common = ['Pedido', 'Cliente', 'Status', 'Data', 'Endereço', 'Ação'];
    if(idx < common.length) return common[idx];
    if(tableId.includes('entreg')) return ['Pedido', 'Cliente', 'Recebedor', 'Tempo', 'Status'][idx] || '';
    if(tableId.includes('fila')) return ['Status', 'Pedido', 'Alarme', 'Previsão', 'Endereço', 'Pagamento', 'Ação'][idx] || '';
    if(tableId.includes('rotas')) return ['Selecionar', 'Pedido', 'Cliente e endereço', 'Status'][idx] || '';
    if(row && row.children.length === 1) return '';
    return `Campo ${idx + 1}`;
  }

  function labelTablesNow(){
    const tables = Array.from(document.querySelectorAll('table'));
    tables.forEach(table => {
      table.classList.add('vesco-responsive-table');
      table.classList.add('vesco-rsp-no-overflow');
      const wrapper = table.parentElement;
      if(wrapper) {
        wrapper.classList.add('vesco-rsp-scroll-x');
        wrapper.classList.add('vesco-rsp-soft-scroll');
      }
      const labels = tableHeaderLabels(table);
      Array.from(table.querySelectorAll('tbody tr')).forEach(row => {
        Array.from(row.children || []).forEach((td, idx) => {
          if(!(td instanceof HTMLElement)) return;
          const label = labels[idx] || td.getAttribute('data-label') || inferLabelFromCell(td, idx);
          td.setAttribute('data-label', label);
        });
      });
    });
  }

  function scheduleLabelTables(){
    clearTimeout(labelTimer);
    labelTimer = setTimeout(labelTablesNow, 40);
  }

  function tuneScrollableAreas(){
    document.querySelectorAll('.overflow-x-auto, .overflow-auto').forEach(el => {
      el.classList.add('vesco-rsp-soft-scroll');
      el.classList.add('vesco-rsp-no-overflow');
    });
    document.querySelectorAll('section[id^="view-"], .card, .grid, table, tbody, tr, td').forEach(el => {
      if(el instanceof HTMLElement) el.classList.add('vesco-rsp-no-overflow');
    });
  }

  function invalidateVisibleMaps(){
    const possibleMaps = ['map','mapFlex','mapRotas','routeMap','routeMapV6','routeMapV12','routeMapV13','routeMapV20'];
    possibleMaps.forEach(name => {
      try {
        const m = window[name];
        if(m && typeof m.invalidateSize === 'function') m.invalidateSize(true);
      } catch(e) {}
    });
    try { if(window.map && typeof window.map.invalidateSize === 'function') window.map.invalidateSize(true); } catch(e) {}
    try { if(window.mapFlex && typeof window.mapFlex.invalidateSize === 'function') window.mapFlex.invalidateSize(true); } catch(e) {}
  }

  function fitActiveTabIntoView(){
    if(!isMobile()) return;
    const active = document.querySelector('.tab-nav .tab-btn.active');
    if(active && typeof active.scrollIntoView === 'function') {
      try { active.scrollIntoView({ behavior:'smooth', inline:'center', block:'nearest' }); } catch(e) {}
    }
  }

  function applyLayoutNow(){
    injectViewportFix();
    injectCss();
    applyModeClass();
    tuneScrollableAreas();
    labelTablesNow();
    fitActiveTabIntoView();
    setTimeout(invalidateVisibleMaps, 120);
    setTimeout(invalidateVisibleMaps, 500);
  }

  function scheduleLayout(){
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(applyLayoutNow, 80);
  }

  // Conversa com renderizações antigas: depois de qualquer render/switchTab/load,
  // a camada ajusta a UI responsiva sem interferir no fluxo de dados.
  if(!window.__vescoResponsiveRenderWrappedV20 && typeof window.render === 'function'){
    const prevRender = window.render;
    window.__vescoResponsiveRenderWrappedV20 = true;
    window.render = function(){
      const res = prevRender.apply(this, arguments);
      scheduleLayout();
      return res;
    };
    try { render = window.render; } catch(e) {}
  }

  if(!window.__vescoResponsiveSwitchWrappedV20 && typeof window.switchTab === 'function'){
    const prevSwitch = window.switchTab;
    window.__vescoResponsiveSwitchWrappedV20 = true;
    window.switchTab = function(which){
      const res = prevSwitch.apply(this, arguments);
      scheduleLayout();
      return res;
    };
  }

  if(!window.__vescoResponsiveLoadWrappedV20 && typeof window.load === 'function'){
    const prevLoad = window.load;
    window.__vescoResponsiveLoadWrappedV20 = true;
    window.load = function(){
      const res = prevLoad.apply(this, arguments);
      scheduleLayout();
      return res;
    };
    try { load = window.load; } catch(e) {}
  }

  if(!window.__vescoResponsiveObserverV20){
    window.__vescoResponsiveObserverV20 = true;
    observer = new MutationObserver(function(mutations){
      let should = false;
      for(const m of mutations){
        if(m.type === 'childList' && (m.addedNodes.length || m.removedNodes.length)) { should = true; break; }
        if(m.type === 'attributes') { should = true; break; }
      }
      if(should) scheduleLabelTables();
    });
  }

  function start(){
    injectViewportFix();
    injectCss();
    applyLayoutNow();
    try { observer && observer.observe(document.body, { childList:true, subtree:true, attributes:false }); } catch(e) {}
    window.addEventListener('resize', scheduleLayout, { passive:true });
    window.addEventListener('orientationchange', function(){ setTimeout(scheduleLayout, 250); }, { passive:true });
    document.addEventListener('visibilitychange', function(){ if(!document.hidden) scheduleLayout(); });
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.vescoResponsiveV20 = {
    apply: applyLayoutNow,
    labelTables: labelTablesNow,
    debug: function(){
      return {
        active: true,
        mobile: isMobile(),
        small: isSmall(),
        width: window.innerWidth,
        headerHeight: getHeaderHeight(),
        tables: document.querySelectorAll('table.vesco-responsive-table').length,
        regra: 'Camada responsiva aditiva: tabelas viram cards no mobile, menus rolam, mapas redimensionam e nada do legado é removido.'
      };
    }
  };

  log('V20 ativo — responsividade total aplicada por camada aditiva, conversando com render/switchTab/load existentes.');
})();

// =================================================================
// CAMADA V21 — RESPONSIVO MOBILE REFINADO / CARDS LIMPOS
// Regra de Preservação: camada visual aditiva, sem remover lógica antiga.
// Objetivo: corrigir telas pequenas onde os cards ainda ficavam espremidos.
// =================================================================
(function installVescoResponsiveV21(){
  if (window.__vescoResponsiveV21) return;
  window.__vescoResponsiveV21 = true;

  let timer = null;
  const BP = 720;

  function isMobile(){
    return window.innerWidth <= BP || window.matchMedia('(max-width: 720px)').matches;
  }

  function clean(v){
    return String(v || '').replace(/\s+/g, ' ').trim();
  }

  function injectCss(){
    if (document.getElementById('vesco-responsive-v21-style')) return;
    const style = document.createElement('style');
    style.id = 'vesco-responsive-v21-style';
    style.textContent = `
      /* Base segura */
      html, body{
        max-width:100%;
        overflow-x:hidden;
      }
      .vesco-mobile-card-table,
      .vesco-mobile-card-table *{
        box-sizing:border-box !important;
      }

      @media (max-width: 720px){
        body.vesco-v21-mobile{
          background:#f8fafc !important;
          width:100% !important;
          max-width:100vw !important;
          overflow-x:hidden !important;
        }

        body.vesco-v21-mobile header{
          padding:8px !important;
          display:flex !important;
          flex-direction:column !important;
          align-items:stretch !important;
          gap:8px !important;
        }
        body.vesco-v21-mobile header > div{
          width:100% !important;
          max-width:100% !important;
          justify-content:center !important;
        }
        body.vesco-v21-mobile header .flex.items-center.justify-center.gap-2,
        body.vesco-v21-mobile header .bg-slate-800{
          max-width:100% !important;
          min-width:0 !important;
        }
        body.vesco-v21-mobile #topCalendar{
          min-width:110px !important;
          max-width:125px !important;
          font-size:11px !important;
        }
        body.vesco-v21-mobile #clock{
          margin-left:0 !important;
          font-size:12px !important;
        }

        body.vesco-v21-mobile .tab-nav{
          padding:6px !important;
          gap:8px !important;
          position:sticky !important;
          top:0 !important;
          z-index:1100 !important;
          border-bottom:1px solid #e2e8f0 !important;
        }
        body.vesco-v21-mobile .tab-nav > div:first-child{
          width:100% !important;
          display:flex !important;
          overflow-x:auto !important;
          overflow-y:hidden !important;
          gap:6px !important;
          padding-bottom:3px !important;
          scroll-snap-type:x proximity !important;
          -webkit-overflow-scrolling:touch !important;
        }
        body.vesco-v21-mobile .tab-nav .tab-btn{
          flex:0 0 auto !important;
          white-space:nowrap !important;
          scroll-snap-align:start !important;
          min-height:34px !important;
          padding:8px 10px !important;
          font-size:11px !important;
          border-radius:10px !important;
        }
        body.vesco-v21-mobile .tab-nav > div:last-child{
          width:100% !important;
          display:grid !important;
          grid-template-columns:1fr !important;
          gap:7px !important;
        }
        body.vesco-v21-mobile #search,
        body.vesco-v21-mobile .tab-nav input,
        body.vesco-v21-mobile .tab-nav button[onclick="load()"]{
          width:100% !important;
          max-width:100% !important;
        }

        body.vesco-v21-mobile main{
          width:100% !important;
          max-width:100vw !important;
          padding:7px !important;
          margin:0 !important;
        }
        body.vesco-v21-mobile section[id^="view-"]{
          width:100% !important;
          max-width:100% !important;
          padding:0 !important;
          margin:0 !important;
        }
        body.vesco-v21-mobile .card{
          width:100% !important;
          max-width:100% !important;
          min-width:0 !important;
          padding:10px !important;
          border-radius:14px !important;
          overflow:hidden !important;
        }
        body.vesco-v21-mobile .grid,
        body.vesco-v21-mobile [class*="grid-cols"],
        body.vesco-v21-mobile [class*="lg:grid-cols"],
        body.vesco-v21-mobile [class*="md:grid-cols"]{
          grid-template-columns:1fr !important;
        }

        /* Tabelas como cards definitivos */
        body.vesco-v21-mobile table.vesco-mobile-card-table{
          display:block !important;
          width:100% !important;
          min-width:0 !important;
          max-width:100% !important;
          table-layout:fixed !important;
          border:0 !important;
          background:transparent !important;
        }
        body.vesco-v21-mobile table.vesco-mobile-card-table thead{
          display:none !important;
        }
        body.vesco-v21-mobile table.vesco-mobile-card-table tbody{
          display:block !important;
          width:100% !important;
          max-width:100% !important;
          background:transparent !important;
        }
        body.vesco-v21-mobile table.vesco-mobile-card-table tbody tr{
          display:block !important;
          width:100% !important;
          max-width:100% !important;
          min-width:0 !important;
          margin:0 0 10px !important;
          padding:10px !important;
          border:1px solid #e2e8f0 !important;
          border-radius:14px !important;
          background:#ffffff !important;
          box-shadow:0 2px 10px rgba(15,23,42,.04) !important;
          overflow:hidden !important;
        }
        body.vesco-v21-mobile table.vesco-mobile-card-table tbody tr td{
          display:block !important;
          width:100% !important;
          max-width:100% !important;
          min-width:0 !important;
          padding:8px 0 !important;
          border:0 !important;
          border-bottom:1px dashed #e5e7eb !important;
          text-align:left !important;
          white-space:normal !important;
          word-break:normal !important;
          overflow-wrap:break-word !important;
          font-size:12px !important;
          line-height:1.35 !important;
        }
        body.vesco-v21-mobile table.vesco-mobile-card-table tbody tr td:last-child{
          border-bottom:0 !important;
          padding-bottom:0 !important;
        }
        body.vesco-v21-mobile table.vesco-mobile-card-table tbody tr td::before{
          content:attr(data-label) !important;
          display:block !important;
          width:100% !important;
          max-width:100% !important;
          margin:0 0 5px !important;
          padding:0 !important;
          color:#64748b !important;
          font-size:9px !important;
          font-weight:900 !important;
          text-transform:uppercase !important;
          letter-spacing:.04em !important;
          line-height:1.1 !important;
        }
        body.vesco-v21-mobile table.vesco-mobile-card-table tbody tr td[data-label=""]::before,
        body.vesco-v21-mobile table.vesco-mobile-card-table tbody tr td.vesco-no-label::before{
          display:none !important;
          content:"" !important;
        }
        body.vesco-v21-mobile table.vesco-mobile-card-table tbody tr td[colspan]{
          text-align:center !important;
          color:#64748b !important;
        }
        body.vesco-v21-mobile table.vesco-mobile-card-table tbody tr td[colspan]::before{
          display:none !important;
        }

        /* Corrige número do pedido quebrando em coluna */
        body.vesco-v21-mobile table.vesco-mobile-card-table td,
        body.vesco-v21-mobile table.vesco-mobile-card-table td *{
          min-width:0 !important;
          max-width:100% !important;
        }
        body.vesco-v21-mobile table.vesco-mobile-card-table td:nth-child(2),
        body.vesco-v21-mobile table.vesco-mobile-card-table td:nth-child(2) b,
        body.vesco-v21-mobile table.vesco-mobile-card-table td:nth-child(2) span:first-child{
          word-break:keep-all !important;
          overflow-wrap:normal !important;
        }

        /* Badges e informações longas */
        body.vesco-v21-mobile .status-pill,
        body.vesco-v21-mobile [class*="badge"],
        body.vesco-v21-mobile span[class*="bg-"],
        body.vesco-v21-mobile div[class*="bg-"]{
          max-width:100% !important;
          white-space:normal !important;
          overflow-wrap:break-word !important;
          line-height:1.25 !important;
        }
        body.vesco-v21-mobile .font-mono,
        body.vesco-v21-mobile code{
          white-space:normal !important;
          word-break:break-word !important;
        }

        /* Inputs, observação, link, horário */
        body.vesco-v21-mobile input,
        body.vesco-v21-mobile select,
        body.vesco-v21-mobile textarea{
          max-width:100% !important;
          min-width:0 !important;
        }
        body.vesco-v21-mobile input[type="time"]{
          width:100% !important;
          max-width:150px !important;
        }
        body.vesco-v21-mobile textarea{
          min-height:58px !important;
        }

        /* Ações sempre utilizáveis */
        body.vesco-v21-mobile table.vesco-mobile-card-table td:last-child > div,
        body.vesco-v21-mobile table.vesco-mobile-card-table td .flex.items-center.justify-end,
        body.vesco-v21-mobile table.vesco-mobile-card-table td .flex.justify-end{
          display:flex !important;
          flex-wrap:wrap !important;
          justify-content:flex-start !important;
          align-items:center !important;
          gap:7px !important;
        }
        body.vesco-v21-mobile table.vesco-mobile-card-table td:last-child button,
        body.vesco-v21-mobile .card button{
          min-height:32px !important;
          border-radius:9px !important;
          white-space:nowrap !important;
        }

        /* Separação: card mais limpo */
        body.vesco-v21-mobile #view-separacao #table-fila tr td:nth-child(1){
          padding-bottom:5px !important;
        }
        body.vesco-v21-mobile #view-separacao #table-fila tr td:nth-child(2){
          font-size:13px !important;
          font-weight:900 !important;
          color:#0f172a !important;
        }
        body.vesco-v21-mobile #view-separacao #table-fila tr td:nth-child(5){
          color:#475569 !important;
          font-size:11px !important;
        }
        body.vesco-v21-mobile #view-separacao #subview-fila,
        body.vesco-v21-mobile #view-separacao #subview-pendencias{
          border:0 !important;
          overflow:visible !important;
        }

        /* Cards de retirada/entregues/logística ficam menos apertados */
        body.vesco-v21-mobile #view-entregues table td,
        body.vesco-v21-mobile #view-retiradas table td,
        body.vesco-v21-mobile #view-logistica table td,
        body.vesco-v21-mobile #view-envios_flex table td{
          font-size:12px !important;
        }

        /* Mapas e painéis */
        body.vesco-v21-mobile #map,
        body.vesco-v21-mobile #map-flex,
        body.vesco-v21-mobile #map-rotas,
        body.vesco-v21-mobile [id^="vesco-route-map"]{
          height:300px !important;
          min-height:300px !important;
          width:100% !important;
        }
        body.vesco-v21-mobile .map-wrapper,
        body.vesco-v21-mobile [id*="route-map-panel"],
        body.vesco-v21-mobile [id*="map-panel"]{
          width:100% !important;
          max-width:100% !important;
          overflow:hidden !important;
        }

        /* Modais */
        body.vesco-v21-mobile .fixed.inset-0{
          padding:8px !important;
        }
        body.vesco-v21-mobile .fixed.inset-0 > div{
          width:100% !important;
          max-width:calc(100vw - 16px) !important;
          max-height:calc(100vh - 16px) !important;
          overflow:auto !important;
        }
      }

      @media (max-width: 420px){
        body.vesco-v21-mobile header{
          padding:6px !important;
        }
        body.vesco-v21-mobile .tab-nav .tab-btn{
          font-size:10px !important;
          padding:7px 9px !important;
        }
        body.vesco-v21-mobile table.vesco-mobile-card-table tbody tr{
          padding:9px !important;
          border-radius:13px !important;
        }
        body.vesco-v21-mobile table.vesco-mobile-card-table tbody tr td{
          font-size:11px !important;
          padding:7px 0 !important;
        }
        body.vesco-v21-mobile table.vesco-mobile-card-table tbody tr td::before{
          font-size:8.5px !important;
        }
        body.vesco-v21-mobile table.vesco-mobile-card-table td:last-child button,
        body.vesco-v21-mobile .card button{
          font-size:10px !important;
          padding:7px 9px !important;
        }
        body.vesco-v21-mobile #map,
        body.vesco-v21-mobile #map-flex,
        body.vesco-v21-mobile #map-rotas,
        body.vesco-v21-mobile [id^="vesco-route-map"]{
          height:270px !important;
          min-height:270px !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function tableLabels(table){
    const labels = Array.from(table.querySelectorAll('thead th')).map(th => clean(th.textContent || th.innerText));
    if(labels.length) return labels;
    const id = table.id || table.closest('section')?.id || '';
    if(id.includes('fila') || id.includes('separacao')) return ['Status','Pedido','Limite alarme','Data previsão','Endereço','Forma pag.','Ação'];
    if(id.includes('pendencia')) return ['Pedido','Cliente / motivo','Solução','Ação'];
    if(id.includes('entreg')) return ['Pedido','Cliente / destinatário','Recebedor / documento','Tempo','Status'];
    if(id.includes('retir')) return ['Pedido','Cliente','Retirada','Observação','Ação'];
    if(id.includes('logistica')) return ['Pedido','Data','Cliente','Status','Forma','Ação'];
    if(id.includes('flex')) return ['Pedido / ID Flex','Volumes','Destinatário','Data prevista','Situação / loja','Status'];
    if(id.includes('rotas')) return ['Selecionar','Pedido / e-com','Cliente e endereço','Status / origem'];
    return [];
  }

  function applyTableCards(){
    const tables = Array.from(document.querySelectorAll('table'));
    tables.forEach(table => {
      table.classList.add('vesco-mobile-card-table');
      const labels = tableLabels(table);
      Array.from(table.querySelectorAll('tbody tr')).forEach(row => {
        Array.from(row.children || []).forEach((td, idx) => {
          if(!(td instanceof HTMLElement)) return;
          const existing = clean(td.getAttribute('data-label'));
          const label = labels[idx] || existing || '';
          td.setAttribute('data-label', label);
          td.classList.toggle('vesco-no-label', !label || td.hasAttribute('colspan'));
        });
      });
    });
  }

  function normalizeMobileText(){
    if(!isMobile()) return;
    document.querySelectorAll('#view-separacao #table-fila td, #view-retiradas td, #view-entregues td').forEach(td => {
      if(!(td instanceof HTMLElement)) return;
      td.style.wordBreak = 'normal';
      td.style.overflowWrap = 'break-word';
    });
  }

  function invalidateMaps(){
    ['map','mapFlex','mapRotas','routeMap','routeMapV6','routeMapV12','routeMapV13','routeMapV20'].forEach(name => {
      try { const m = window[name]; if(m && typeof m.invalidateSize === 'function') m.invalidateSize(true); } catch(e) {}
    });
  }

  function apply(){
    injectCss();
    document.body.classList.toggle('vesco-v21-mobile', isMobile());
    applyTableCards();
    normalizeMobileText();
    setTimeout(invalidateMaps, 120);
  }

  function schedule(){
    clearTimeout(timer);
    timer = setTimeout(apply, 70);
  }

  function wrapOnce(name, flag, after){
    try {
      if(window[flag] || typeof window[name] !== 'function') return;
      const prev = window[name];
      window[flag] = true;
      window[name] = function(){
        const res = prev.apply(this, arguments);
        after();
        return res;
      };
      if(name === 'render') { try { render = window[name]; } catch(e) {} }
      if(name === 'load') { try { load = window[name]; } catch(e) {} }
    } catch(e) {}
  }

  function start(){
    injectCss();
    apply();
    wrapOnce('render', '__vescoResponsiveRenderWrappedV21', schedule);
    wrapOnce('switchTab', '__vescoResponsiveSwitchWrappedV21', schedule);
    wrapOnce('load', '__vescoResponsiveLoadWrappedV21', schedule);
    window.addEventListener('resize', schedule, { passive:true });
    window.addEventListener('orientationchange', () => setTimeout(schedule, 250), { passive:true });
    try {
      const obs = new MutationObserver(schedule);
      obs.observe(document.body, { childList:true, subtree:true });
      window.__vescoResponsiveObserverV21 = obs;
    } catch(e) {}
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.vescoResponsiveV21 = {
    apply,
    debug(){
      return {
        active:true,
        mobile:isMobile(),
        width:window.innerWidth,
        tables:document.querySelectorAll('table.vesco-mobile-card-table').length,
        cards:document.querySelectorAll('table.vesco-mobile-card-table tbody tr').length,
        regra:'V21: responsivo refinado em cards de largura total, corrigindo pedido quebrado e conteúdo espremido.'
      };
    }
  };

  console.log('V21 ativo — responsivo refinado: cards mobile limpos, sem conteúdo espremido e sem alterar lógica.');
})();


// ============================================================================
// VESCO APP — CAMADA V22: AUDITORIA DE STATUS + LOGÍSTICA COMPACTA PROFISSIONAL
// Regra de Preservação: camada aditiva, sem remover lógicas V1-V21.
// Objetivos:
// - impedir erro sendDriverNotification is not defined;
// - marcar no front operador/data/hora de início e conclusão da separação;
// - deixar a aba Logística visualmente profissional, compactando informações longas;
// - reduzir duplicidade visual de badges de prioridade/transportadora.
// ============================================================================
(function installVescoAuditProfessionalV22(){
  if (window.__vescoAuditProfessionalV22) return;
  window.__vescoAuditProfessionalV22 = true;

  // Correção imediata do erro que estava interrompendo o callback de updateStatusJsonp.
  if (typeof window.sendDriverNotification !== 'function') {
    window.sendDriverNotification = function(order){
      return Promise.resolve({ success: true, skipped: true, reason: 'sendDriverNotification não configurado', order: order && (order.id || order.numero) });
    };
  }
  try { if (typeof sendDriverNotification === 'undefined') sendDriverNotification = window.sendDriverNotification; } catch(e) {}

  const AUDIT_KEY = 'vesco_status_audit_v22';

  function esc(v){
    try { return typeof escapeHtml === 'function' ? escapeHtml(v) : String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
    catch(e){ return String(v ?? ''); }
  }
  function norm(v){
    return String(v || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  }
  function todayBR(d = new Date()){
    return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  }
  function timeBR(d = new Date()){
    return d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  function readAudit(){
    try { return JSON.parse(localStorage.getItem(AUDIT_KEY) || '{}') || {}; } catch(e) { return {}; }
  }
  function saveAudit(data){
    try { localStorage.setItem(AUDIT_KEY, JSON.stringify(data || {})); } catch(e) {}
  }
  function orderKeys(oOrId){
    const vals = [];
    if (oOrId && typeof oOrId === 'object') {
      vals.push(oOrId.id, oOrId.numero, oOrId.pedido, oOrId.id_tiny, oOrId.pedido_key, oOrId.numero_ecommerce, oOrId.ecom);
      try { if (typeof getEcomNum === 'function') vals.push(getEcomNum(oOrId)); } catch(e) {}
    } else {
      vals.push(oOrId);
    }
    const out = [];
    vals.forEach(v => {
      if (v === undefined || v === null || String(v).trim() === '') return;
      const raw = String(v).trim();
      out.push(raw);
      try { if (typeof normalizeOrderNumber === 'function') out.push(normalizeOrderNumber(raw)); } catch(e) {}
      try { if (typeof normalizeEcomNumber === 'function') out.push(normalizeEcomNumber(raw)); } catch(e) {}
    });
    return Array.from(new Set(out.filter(Boolean)));
  }
  function findOrder(id){
    const targets = orderKeys(id);
    const pools = [];
    try { if (Array.isArray(orders)) pools.push(...orders); } catch(e) {}
    try { if (Array.isArray(flexOrders)) pools.push(...flexOrders); } catch(e) {}
    try { if (Array.isArray(window.orders)) pools.push(...window.orders); } catch(e) {}
    try { if (Array.isArray(window.flexOrders)) pools.push(...window.flexOrders); } catch(e) {}
    return pools.find(o => orderKeys(o).some(k => targets.includes(k))) || null;
  }
  function operatorName(){
    try { return window.currentOperator || currentOperator || localStorage.getItem('vesco_operator') || '—'; }
    catch(e){ return localStorage.getItem('vesco_operator') || '—'; }
  }
  function rememberLocalAudit(id, status){
    const now = new Date();
    const st = norm(status);
    const keys = orderKeys(id);
    if (!keys.length) return;
    const store = readAudit();
    let merged = {};
    keys.forEach(k => { if (store[k]) merged = Object.assign(merged, store[k]); });
    merged.operador_ultima_alteracao = operatorName();
    merged.data_ultima_alteracao = todayBR(now);
    merged.hora_ultima_alteracao = timeBR(now);
    merged.ultima_alteracao_em = now.toISOString();
    merged.status_ultima_alteracao = status || '';

    if (st.includes('em separa')) {
      merged.operador_inicio_separacao = operatorName();
      merged.data_inicio_separacao = todayBR(now);
      merged.hora_inicio_separacao = timeBR(now);
      merged.inicio_separacao_em = now.toISOString();
    }
    if (st.includes('separado') || st.includes('pronto p/ entrega') || st.includes('pronto para entrega')) {
      merged.operador_conclusao_separacao = operatorName();
      merged.data_conclusao_separacao = todayBR(now);
      merged.hora_conclusao_separacao = timeBR(now);
      merged.conclusao_separacao_em = now.toISOString();
    }
    if (st.includes('despach') || st.includes('pronto para envio') || st.includes('rota')) {
      merged.operador_saida_entrega = operatorName();
      merged.data_saida_entrega = todayBR(now);
      merged.hora_saida_entrega = timeBR(now);
      merged.saida_entrega_em = now.toISOString();
    }
    if (st.includes('entregue') || st.includes('finaliz') || st.includes('conclu')) {
      merged.operador_entrega = operatorName();
      merged.data_entrega_realizada = todayBR(now);
      merged.hora_entrega_realizada = timeBR(now);
      merged.entrega_realizada_em = now.toISOString();
    }

    keys.forEach(k => { store[k] = Object.assign({}, merged); });
    saveAudit(store);

    const o = findOrder(id);
    if (o) Object.assign(o, merged);
    try { if (typeof syncGlobalOrderState === 'function') syncGlobalOrderState(); } catch(e) {}
  }

  const oldUpdateStatusV22 = typeof updateStatusJsonp === 'function' ? updateStatusJsonp : window.updateStatusJsonp;
  if (typeof oldUpdateStatusV22 === 'function' && !window.__vescoUpdateStatusWrappedAuditV22) {
    window.__vescoUpdateStatusWrappedAuditV22 = true;
    updateStatusJsonp = window.updateStatusJsonp = function(id, status, observacao = ''){
      try { rememberLocalAudit(id, status); } catch(e) { console.warn('Auditoria local V22 falhou:', e); }
      return oldUpdateStatusV22.apply(this, arguments);
    };
  }

  function injectCss(){
    if (document.getElementById('vesco-professional-logistica-v22-style')) return;
    const st = document.createElement('style');
    st.id = 'vesco-professional-logistica-v22-style';
    st.textContent = `
      /* V22: melhora visual profissional sem alterar desktop global */
      #view-logistica .card { border-radius: 16px !important; box-shadow: 0 12px 28px rgba(15,23,42,.055) !important; }
      #view-logistica table thead th { font-size: 11px !important; letter-spacing: .035em !important; text-transform: uppercase !important; }
      #view-logistica tbody tr { transition: background .18s ease, transform .18s ease; }
      #view-logistica tbody tr:hover { background: #f8fafc !important; }
      #view-logistica td { vertical-align: middle !important; }
      #view-logistica .vesco-priority-badge-v14,
      #view-logistica .vesco-priority-badge-v15,
      #view-logistica .vesco-priority-badge-v16,
      #view-logistica .vesco-priority-badge-v21 {
        max-width: 240px !important;
        justify-content: flex-end !important;
        gap: 4px !important;
      }
      #view-logistica .vesco-priority-badge-v14 span,
      #view-logistica .vesco-priority-badge-v15 span,
      #view-logistica .vesco-priority-badge-v16 span,
      #view-logistica .vesco-priority-badge-v21 span,
      .vesco-transport-chip-v22 {
        max-width: 180px !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
      }
      .vesco-transport-chip-v22 {
        display:inline-flex;align-items:center;border:1px solid #dbeafe;background:#eff6ff;color:#1d4ed8;border-radius:999px;padding:3px 8px;font-size:10px;font-weight:900;line-height:1.1;
      }
      .vesco-audit-chip-v22 { display:inline-flex;align-items:center;gap:4px;border:1px solid #e2e8f0;background:#f8fafc;color:#475569;border-radius:999px;padding:3px 8px;font-size:10px;font-weight:800;line-height:1.1; }
      .vesco-audit-row-v22 { margin-top:5px;display:flex;flex-wrap:wrap;gap:4px;align-items:center; }
      .vesco-compact-details-v22 { margin-top:5px;max-width:260px; }
      .vesco-compact-details-v22 summary { cursor:pointer;list-style:none;display:inline-flex;align-items:center;gap:4px;border:1px solid #e2e8f0;background:#fff;color:#475569;border-radius:999px;padding:3px 8px;font-size:10px;font-weight:900; }
      .vesco-compact-details-v22 summary::-webkit-details-marker { display:none; }
      .vesco-compact-details-v22 div { margin-top:6px;background:#0f172a;color:#fff;border-radius:10px;padding:8px;max-width:320px;white-space:normal;font-size:10px;line-height:1.45;box-shadow:0 12px 30px rgba(15,23,42,.22); }
      .vesco-log-actions-v22 { display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap; }
      #view-logistica .vesco-priority-legend-v15 { background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:8px 10px;box-shadow:0 4px 14px rgba(15,23,42,.04); }
      @media (max-width: 768px) {
        #view-logistica .vesco-priority-badge-v14,
        #view-logistica .vesco-priority-badge-v15,
        #view-logistica .vesco-priority-badge-v16,
        #view-logistica .vesco-priority-badge-v21 { max-width:100% !important; justify-content:flex-start !important; }
        .vesco-log-actions-v22 { justify-content:flex-start; }
        .vesco-compact-details-v22 { max-width:100%; }
      }
    `;
    document.head.appendChild(st);
  }

  function compactPipeText(text){
    const raw = String(text || '').replace(/\s+/g,' ').trim();
    if (!raw) return { label:'', full:'' };
    const parts = raw.split('|').map(x => x.trim()).filter(Boolean);
    const unique = [];
    parts.forEach(p => {
      const key = norm(p).replace(/[^a-z0-9]/g,'');
      if (!key) return;
      if (!unique.some(u => norm(u).replace(/[^a-z0-9]/g,'') === key)) unique.push(p);
    });
    const full = unique.length ? unique.join(' | ') : raw;
    let label = unique[0] || raw;
    if (/lal(a)?move/i.test(full)) label = 'LALAMOVE';
    else if (/retir|retirada/i.test(full)) label = 'Retirada';
    else if (/mercado envios flex/i.test(full)) label = 'Mercado Envios Flex';
    else if (/mercado envios/i.test(full)) label = 'Mercado Envios';
    else if (/shopee/i.test(full)) label = 'Shopee Envios';
    else if (/amazon/i.test(full)) label = 'Amazon DBA';
    else if (/loggi/i.test(full)) label = 'Loggi';
    return { label, full };
  }

  function auditForOrder(order){
    if(!order) return {};
    const store = readAudit();
    let out = {};
    orderKeys(order).forEach(k => { if (store[k]) out = Object.assign(out, store[k]); });
    return Object.assign({}, out, order || {});
  }
  function rowKey(row){
    if(!row) return '';
    const attrs = ['data-num','data-ecom','data-pedido','data-id'].map(a => row.getAttribute(a)).filter(Boolean);
    if(attrs.length) return attrs[0];
    const txt = row.innerText || '';
    const m = txt.match(/#\s*([0-9A-Za-z._-]+)/) || txt.match(/\b([A-Z]+__\d+)\b/) || txt.match(/\b(\d{5,})\b/);
    return m ? m[1] : '';
  }
  function addAuditBadges(row, order){
    if(!row || row.querySelector('.vesco-audit-row-v22')) return;
    const audit = auditForOrder(order);
    const chips = [];
    if (audit.operador_inicio_separacao || audit.hora_inicio_separacao) chips.push(`Início: ${audit.hora_inicio_separacao || '—'} ${audit.operador_inicio_separacao ? '• ' + audit.operador_inicio_separacao : ''}`);
    if (audit.operador_conclusao_separacao || audit.hora_conclusao_separacao) chips.push(`Separado: ${audit.hora_conclusao_separacao || '—'} ${audit.operador_conclusao_separacao ? '• ' + audit.operador_conclusao_separacao : ''}`);
    if (audit.operador_ultima_alteracao || audit.hora_ultima_alteracao) chips.push(`Última: ${audit.hora_ultima_alteracao || '—'} ${audit.operador_ultima_alteracao ? '• ' + audit.operador_ultima_alteracao : ''}`);
    if (!chips.length) return;
    const target = row.querySelector('td:nth-child(3)') || row.querySelector('td:nth-child(2)') || row.querySelector('td:first-child');
    if(!target) return;
    const div = document.createElement('div');
    div.className = 'vesco-audit-row-v22';
    div.innerHTML = chips.slice(0,3).map(c => `<span class="vesco-audit-chip-v22">${esc(c)}</span>`).join('');
    target.appendChild(div);
  }
  function dedupeAndCompactBadges(row){
    if(!row) return;
    const badges = Array.from(row.querySelectorAll('.vesco-priority-badge-v14,.vesco-priority-badge-v15,.vesco-priority-badge-v16,.vesco-priority-badge-v21'));
    if (badges.length > 1) badges.slice(1).forEach(b => b.remove());
    const badge = badges[0];
    if(!badge) return;
    const spans = Array.from(badge.querySelectorAll('span'));
    spans.forEach(sp => {
      const tx = (sp.textContent || '').trim();
      if (tx.length > 45 || tx.includes('|')) {
        const c = compactPipeText(tx);
        sp.textContent = c.label;
        sp.title = c.full;
      }
    });
  }
  function compactLongInfo(row){
    if(!row || row.dataset.vescoCompactInfoV22 === '1') return;
    const tds = Array.from(row.querySelectorAll('td'));
    tds.forEach(td => {
      if (td.querySelector('button,input,textarea,select')) return;
      const txt = (td.textContent || '').replace(/\s+/g,' ').trim();
      if (txt.length < 95 && !txt.includes('|')) return;
      if (!/(LALAMOVE|Retirar|Retirada|Mercado Envios|Shopee|Amazon|Loggi|Transportadora|Correios)/i.test(txt)) return;
      const c = compactPipeText(txt);
      const small = document.createElement('div');
      small.className = 'mt-1';
      small.innerHTML = `<span class="vesco-transport-chip-v22" title="${esc(c.full)}">${esc(c.label)}</span><details class="vesco-compact-details-v22"><summary>Detalhes</summary><div>${esc(c.full)}</div></details>`;
      td.innerHTML = '';
      td.appendChild(small);
    });
    row.dataset.vescoCompactInfoV22 = '1';
  }
  function professionalizeLogistica(){
    injectCss();
    const rows = Array.from(document.querySelectorAll('#table-logistica tr'));
    rows.forEach(row => {
      const order = findOrder(rowKey(row));
      dedupeAndCompactBadges(row);
      compactLongInfo(row);
      if(order) addAuditBadges(row, order);
      const last = row.querySelector('td:last-child');
      if(last && !last.querySelector('.vesco-log-actions-v22') && last.querySelector('button')) {
        const wrap = document.createElement('div');
        wrap.className = 'vesco-log-actions-v22';
        Array.from(last.childNodes).forEach(n => wrap.appendChild(n));
        last.appendChild(wrap);
      }
    });
  }

  const oldRenderV22 = typeof render === 'function' ? render : window.render;
  if (typeof oldRenderV22 === 'function' && !window.__vescoRenderWrappedProfessionalV22) {
    window.__vescoRenderWrappedProfessionalV22 = true;
    render = window.render = function(){
      const res = oldRenderV22.apply(this, arguments);
      setTimeout(professionalizeLogistica, 80);
      return res;
    };
  }
  const oldSwitchV22 = window.switchTab;
  if (typeof oldSwitchV22 === 'function' && !window.__vescoSwitchWrappedProfessionalV22) {
    window.__vescoSwitchWrappedProfessionalV22 = true;
    window.switchTab = function(which){
      const res = oldSwitchV22.apply(this, arguments);
      if (which === 'logistica') setTimeout(professionalizeLogistica, 160);
      return res;
    };
  }

  document.addEventListener('DOMContentLoaded', () => {
    injectCss();
    setTimeout(professionalizeLogistica, 600);
  });

  window.vescoAuditProfessionalV22 = {
    debug(){ return { auditItems: Object.keys(readAudit()).length, operator: operatorName(), sendDriverNotificationOk: typeof window.sendDriverNotification === 'function' }; },
    rememberLocalAudit,
    professionalizeLogistica
  };

  console.log('V22 ativo — auditoria local, correção sendDriverNotification e Logística compacta/profissional.');
})();

// =================================================================

// ============================================================================
// CAMADA V42 — LIMPEZA FINAL DE FORMA DE ENVIO / LOGÍSTICA SEM POLUIÇÃO
// Regra de preservação:
// - Não apaga dados originais: guarda o texto bruto em __vesco_forma_envio_original_v42.
// - Remove da TELA repetições como "Forma de envio não informada | ... | Não definida".
// - ID 0, vazio ou sem ID = "Não definida".
// - Código "R" em forma_frete NÃO transforma pedido em Retirada.
// - Retirada somente por ID oficial ou texto explícito quando NÃO houver ID 0.
// ============================================================================
(function installVescoCleanLogisticaV42(){
  if (window.__vescoCleanLogisticaV42) return;
  window.__vescoCleanLogisticaV42 = true;

  const FORMAS_ENVIO_V42 = {
    '0': 'Não definida',
    '747632293': 'Correios',
    '747632297': 'Transportadora',
    '747632298': 'Retirar pessoalmente',
    '769570519': 'Mercado Envios',
    '778029845': 'Shopee Envios',
    '780391986': 'Mercado Envios Flex',
    '849173976': 'Amazon DBA',
    '850044775': 'Magalu Entregas',
    '852535843': 'Loggi',
    '854284026': 'TikTok Shipping',
    '860463094': 'RETIRADA',
    '758290128': 'Correios',
    '758290130': 'Transportadora',
    '758290131': 'Retirar pessoalmente',
    '778095610': 'Shopee Envios',
    '780192106': 'Amazon DBA',
    '846935602': 'LALAMOVE',
    '847199235': 'Mercado Envios',
    '850341481': 'Loggi',
    '857757016': 'Enviali'
  };

  const IDS_RETIRADA_V42 = {
    '747632298': true,
    '758290131': true,
    '860463094': true
  };

  const KNOWN_LABELS_V42 = [
    ['mercado envios flex', 'Mercado Envios Flex'],
    ['mercado envios', 'Mercado Envios'],
    ['shopee envios', 'Shopee Envios'],
    ['shopee', 'Shopee Envios'],
    ['amazon dba', 'Amazon DBA'],
    ['amazon', 'Amazon DBA'],
    ['magalu entregas', 'Magalu Entregas'],
    ['magalu', 'Magalu Entregas'],
    ['tiktok shipping', 'TikTok Shipping'],
    ['tiktok', 'TikTok Shipping'],
    ['lalamove', 'LALAMOVE'],
    ['loggi', 'Loggi'],
    ['correios', 'Correios'],
    ['transportadora', 'Transportadora'],
    ['retirar pessoalmente', 'Retirar pessoalmente'],
    ['cliente retira', 'Retirar pessoalmente'],
    ['retirada', 'Retirar pessoalmente'],
    ['enviali', 'Enviali']
  ];

  function $(sel, root){ return (root || document).querySelector(sel); }
  function $$(sel, root){ return Array.from((root || document).querySelectorAll(sel)); }

  function esc(v){
    return String(v ?? '').replace(/[&<>"']/g, m => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[m]));
  }

  function txt(v){
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') {
      try {
        if (v.nome !== undefined) return txt(v.nome);
        if (v.descricao !== undefined) return txt(v.descricao);
        if (v.valor !== undefined) return txt(v.valor);
        if (v.value !== undefined) return txt(v.value);
        if (v.id !== undefined) return txt(v.id);
        return JSON.stringify(v);
      } catch(e) { return ''; }
    }
    return String(v).trim();
  }

  function norm(v){
    return txt(v)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g,'')
      .toLowerCase()
      .replace(/\s+/g,' ')
      .trim();
  }

  function onlyDigits(v){
    const s = txt(v);
    const m = s.match(/\b(\d{1,18})\b/);
    return m ? m[1] : '';
  }

  function getIdFormaEnvio(o){
    if (!o) return '';

    const candidates = [
      o.id_forma_envio,
      o.idFormaEnvio,
      o.idFormaEnvioPsq,
      o.id_forma_envio_psq,
      o.forma_envio_id,
      o.formaEnvioId
    ];

    for (const c of candidates) {
      const s = txt(c);
      if (s === '0') return '0';
      const id = onlyDigits(s);
      if (id) return id;
    }

    // Segurança: às vezes o backend devolve "0 | Não definida" em transporte_completo.
    const bruto = txt(o.transporte_completo || o.forma_envio_nome || o.nome_forma_envio || o.nomeformafenvio);
    const n = norm(bruto);
    if (n.includes('id 0') || n.startsWith('0 |') || n === '0' || n.includes('nao definida') || n.includes('nao informado')) return '0';

    return '';
  }

  function getKnownLabelFromText(raw){
    const n = norm(raw);
    if (!n) return '';

    for (const [needle, label] of KNOWN_LABELS_V42) {
      if (n.includes(needle)) return label;
    }

    return '';
  }

  function isNaoDefinidaText(raw){
    const n = norm(raw);
    return (
      !n ||
      n === '0' ||
      n === 'id 0' ||
      n.includes('id 0') ||
      n.includes('nao definida') ||
      n.includes('nao informado') ||
      n.includes('nao informada') ||
      n.includes('sem forma definida') ||
      n.includes('forma de envio nao informada') ||
      n.includes('forma de envio nao definida')
    );
  }

  function compactarFormaEnvio(raw, forcedId){
    const original = txt(raw);
    const id = txt(forcedId);

    if (id === '0') return 'Não definida';
    if (id && FORMAS_ENVIO_V42[id]) return FORMAS_ENVIO_V42[id];

    if (!original) return 'Não definida';

    const known = getKnownLabelFromText(original);
    if (known) return known;

    const parts = original
      .split(/\s*\|\s*|•|;|\n|,/g)
      .map(s => s.trim())
      .filter(Boolean)
      .filter(s => {
        const n = norm(s);
        if (!n) return false;
        if (['0','id 0','r','d','x','t','s','n','normal','entrega'].includes(n)) return false;
        if (isNaoDefinidaText(n)) return false;
        if (/^\d{5,18}$/.test(n)) return false;
        return true;
      });

    const unicos = [];
    const vistos = new Set();

    for (const p of parts) {
      const knownPart = getKnownLabelFromText(p);
      const clean = knownPart || p;
      const key = norm(clean);
      if (!key || vistos.has(key)) continue;
      vistos.add(key);
      unicos.push(clean);
    }

    if (!unicos.length) return 'Não definida';
    return unicos[0];
  }

  function rawFormaEnvio(o){
    if (!o) return '';
    return [
      o.forma_envio_resumo,
      o.forma_envio_nome,
      o.nome_forma_envio,
      o.nomeformafenvio,
      o.transportadora,
      o.transportador,
      o.nome_transportadora,
      o.nome_transportador,
      o.forma_envio,
      o.forma_envio_tiny,
      o.forma_frete_tiny,
      o.transporte_completo,
      o.tipo_entrega,
      o.prioridade_label
    ].map(txt).filter(Boolean).join(' | ');
  }

  function getStatus(o){
    return txt(o && (o.operacao_status || o.status_logistica || o.situacao_nome || o.situacao || o.status)) || '—';
  }

  function getNum(o){
    return txt(o && (o.numero || o.id || o.pedido || o.order_id || o.orderNumber || o.reference || o.referencia));
  }

  function getId(o){
    return txt(o && (o.id || o.numero || o.pedido || o.order_id || o.orderNumber || o.reference || o.referencia));
  }

  function getCliente(o){
    return txt(o && (o.cliente_nome || o.destinatario || o.cliente || o.nome || o.receiver || o.recipient || o.customer_name));
  }

  function getEndereco(o){
    return txt(o && (o.endereco_completo || o.endereco || o.address || o.full_address || o.logradouro));
  }

  function getData(o){
    return txt(o && (o.operacao_data || o.data_prevista || o.data_previsao || o.previsao || o.data_entrega || o.data || o.deliverydate || o.expecteddate));
  }

  function getPagamento(o){
    return txt(o && (o.instrucao_entrega || o.forma_pagamento || o.payment || o.pagamento));
  }

  function resolveFormaEnvio(o){
    const id = getIdFormaEnvio(o);
    const bruto = rawFormaEnvio(o);

    if (id === '0') {
      return {
        id: '0',
        nome: 'Não definida',
        tipo: 'Não definida',
        prioridade: 4,
        prioridadeLabel: '4 - Sem forma definida',
        raw: bruto
      };
    }

    if (id && FORMAS_ENVIO_V42[id]) {
      const nome = FORMAS_ENVIO_V42[id];
      const retirada = !!IDS_RETIRADA_V42[id];
      return {
        id,
        nome,
        tipo: retirada ? 'Retirada' : 'Entrega',
        prioridade: retirada ? 2 : 3,
        prioridadeLabel: retirada ? '2 - Retirada' : '3 - Entrega',
        raw: bruto
      };
    }

    const nome = compactarFormaEnvio(bruto, id);

    if (nome === 'Não definida') {
      return {
        id: id || '0',
        nome: 'Não definida',
        tipo: 'Não definida',
        prioridade: 4,
        prioridadeLabel: '4 - Sem forma definida',
        raw: bruto
      };
    }

    const n = norm(nome + ' | ' + bruto);
    const emergencial = n.includes('emergencial') || n.includes('urgente') || n.includes('prioridade');
    const retirada = n.includes('retirada') || n.includes('retirar pessoalmente') || n.includes('cliente retira');

    return {
      id: id || '',
      nome,
      tipo: emergencial ? 'Emergencial' : (retirada ? 'Retirada' : 'Entrega'),
      prioridade: emergencial ? 1 : (retirada ? 2 : 3),
      prioridadeLabel: emergencial ? '1 - Emergencial' : (retirada ? '2 - Retirada' : '3 - Entrega'),
      raw: bruto
    };
  }

  function setDisplayFields(o){
    if (!o || typeof o !== 'object') return o;

    const bruto = rawFormaEnvio(o);
    if (bruto && !o.__vesco_forma_envio_original_v42) {
      try {
        Object.defineProperty(o, '__vesco_forma_envio_original_v42', {
          value: bruto,
          configurable: true,
          enumerable: false,
          writable: true
        });
      } catch(e) {
        o.__vesco_forma_envio_original_v42 = bruto;
      }
    }

    const r = resolveFormaEnvio(o);

    o.forma_envio_resumo = r.nome;
    o.forma_envio_nome = r.nome;
    o.nome_forma_envio = r.nome;
    o.nomeformafenvio = r.nome;
    o.transportadora = r.nome;
    o.transportador = r.nome;
    o.nome_transportadora = r.nome;
    o.nome_transportador = r.nome;
    o.forma_envio = r.nome;
    o.forma_envio_tiny = r.nome;
    o.transporte_completo = r.nome;

    if (r.id) {
      o.id_forma_envio = r.id;
      o.idFormaEnvio = r.id;
      o.idFormaEnvioPsq = r.id;
      o.id_forma_envio_psq = r.id;
      o.forma_envio_id = r.id;
    }

    // Não deixar "R" de forma_frete puxar Retirada.
    if (r.id === '0' || r.nome === 'Não definida') {
      o.tipo_entrega = 'Não definida';
      o.tipo_operacional = 'Não definida';
    } else if (r.tipo === 'Retirada' || r.tipo === 'Emergencial') {
      o.tipo_entrega = r.tipo;
      o.tipo_operacional = r.tipo;
    } else if (norm(o.tipo_entrega).includes('retirada') && !IDS_RETIRADA_V42[r.id]) {
      o.tipo_entrega = 'Entrega';
      o.tipo_operacional = 'Entrega';
    }

    o.prioridade_operacional = r.prioridade;
    o.prioridade_label = r.prioridadeLabel;

    return o;
  }

  function listOrders(){
    try { if (Array.isArray(orders)) return orders; } catch(e) {}
    return Array.isArray(window.orders) ? window.orders : [];
  }

  function listFlex(){
    try { if (Array.isArray(flexOrders)) return flexOrders; } catch(e) {}
    return Array.isArray(window.flexOrders) ? window.flexOrders : [];
  }

  function normalizeAll(){
    try { listOrders().forEach(setDisplayFields); } catch(e) {}
    try { listFlex().forEach(setDisplayFields); } catch(e) {}
    try { if (typeof syncGlobalOrderState === 'function') syncGlobalOrderState(); } catch(e) {}
  }

  function currentView(){
    const candidates = [
      ['logistica', '#view-logistica'],
      ['flex', '#view-envios_flex'],
      ['rotas', '#view-rotas'],
      ['rotas', '#view-saiu'],
      ['retiradas', '#view-retiradas'],
      ['separacao', '#view-separacao'],
      ['separados_hoje', '#view-separados_hoje'],
      ['pronto_envio', '#view-pronto_envio']
    ];

    for (const [name, sel] of candidates) {
      const el = $(sel);
      if (el && !el.classList.contains('hidden') && el.offsetParent !== null) return name;
    }

    if ($('#main-logistica') && $('#main-logistica').classList.contains('active')) return 'logistica';
    if ($('#main-flex') && $('#main-flex').classList.contains('active')) return 'flex';

    return '';
  }

  function shouldShowLogistica(o){
    try {
      if (typeof shouldShowLogisticForOperationalDate === 'function') return shouldShowLogisticForOperationalDate(o);
    } catch(e) {}
    return true;
  }

  function shouldShowFlex(o){
    try {
      if (typeof shouldShowFlexForOperationalDate === 'function') return shouldShowFlexForOperationalDate(o);
    } catch(e) {}
    return true;
  }

  function isFlexLike(o){
    const r = resolveFormaEnvio(o);
    const n = norm([r.nome, o && o.nomeformafenvio, o && o.forma_envio, o && o.transportadora].join(' | '));
    return n.includes('mercado envios flex') || n.includes('flex');
  }

  function dateKeyBR(d){
    const s = txt(d);
    const m = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (!m) return '9999-99-99';
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  }

  function rowMatchesSearch(o, extra){
    const q = norm($('#search')?.value || '');
    if (!q) return true;
    return norm([
      getNum(o),
      getCliente(o),
      getEndereco(o),
      getData(o),
      getStatus(o),
      resolveFormaEnvio(o).nome,
      extra || ''
    ].join(' ')).includes(q);
  }

  function operacaoTexto(o){
    const r = resolveFormaEnvio(o);
    const data = getData(o) || 'Sem data';
    const status = getStatus(o);
    return `${r.tipo} • ${data} • ${status}`;
  }

  function chipClassByTipo(tipo){
    const n = norm(tipo);
    if (n.includes('emergencial')) return 'bg-red-50 text-red-700 border-red-200';
    if (n.includes('retirada')) return 'bg-purple-50 text-purple-700 border-purple-200';
    if (n.includes('nao definida') || n.includes('sem forma')) return 'bg-slate-50 text-slate-600 border-slate-200';
    return 'bg-blue-50 text-blue-700 border-blue-200';
  }

  function renderDetailsModal(o){
    let modal = $('#vescoCleanModalV42');

    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'vescoCleanModalV42';
      modal.className = 'hidden fixed inset-0 bg-slate-900/50 z-[99999] p-4 flex items-center justify-center';
      modal.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-5 border border-slate-200 max-h-[85vh] overflow-y-auto">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-black text-slate-900 text-lg">Detalhes do pedido</h3>
            <button class="text-slate-400 hover:text-slate-900 font-black text-xl" data-close>×</button>
          </div>
          <div id="vescoCleanModalBodyV42" class="text-sm text-slate-700 space-y-2"></div>
        </div>`;
      document.body.appendChild(modal);
      modal.addEventListener('click', e => {
        if (e.target === modal || e.target.matches('[data-close]')) modal.classList.add('hidden');
      });
    }

    const r = resolveFormaEnvio(o);
    const raw = txt(o.__vesco_forma_envio_original_v42 || r.raw || '—');

    $('#vescoCleanModalBodyV42').innerHTML = `
      <div><b>Pedido:</b> #${esc(getNum(o) || '—')}</div>
      <div><b>Cliente:</b> ${esc(getCliente(o) || '—')}</div>
      <div><b>Endereço:</b> ${esc(getEndereco(o) || '—')}</div>
      <div><b>Data prevista:</b> ${esc(getData(o) || '—')}</div>
      <div><b>Status:</b> ${esc(getStatus(o) || '—')}</div>
      <div><b>Forma de envio exibida:</b> ${esc(r.nome)}</div>
      <div><b>ID forma envio:</b> ${esc(r.id || '—')}</div>
      <div><b>Texto original preservado:</b><br><span class="text-xs text-slate-500 break-words">${esc(raw)}</span></div>
      <div><b>Pagamento/instrução:</b> ${esc(getPagamento(o) || '—')}</div>
      <div><b>Observação logística:</b> ${esc(txt(o.observacao_logistica || o.observacao || '—'))}</div>
      <div><b>Observações Tiny:</b> ${esc(txt(o.observacoes_tiny || o.observacoes || '—'))}</div>
    `;

    modal.classList.remove('hidden');
  }

  window.vescoCleanDetailsV42 = function(id){
    normalizeAll();
    const sid = String(id || '');
    const o = listOrders().find(x => getId(x) === sid || getNum(x) === sid) ||
              listFlex().find(x => getId(x) === sid || getNum(x) === sid);
    if (o) renderDetailsModal(o);
  };

  window.vescoCleanFocusV42 = function(id){
    normalizeAll();
    const sid = String(id || '');
    const o = listOrders().find(x => getId(x) === sid || getNum(x) === sid) ||
              listFlex().find(x => getId(x) === sid || getNum(x) === sid);

    if (!o) return;

    const c = (typeof getCoords === 'function') ? getCoords(o) : null;

    if (c && window.map && typeof map.setView === 'function') {
      try {
        if (typeof switchTab === 'function') switchTab('logistica');
        setTimeout(() => {
          try { map.invalidateSize(); } catch(e) {}
          map.setView([c.lat, c.lon], 16);
        }, 120);
        return;
      } catch(e) {}
    }

    try {
      if (typeof focusOrderOnMap === 'function') return focusOrderOnMap(getNum(o));
    } catch(e) {}

    alert('Esse pedido ainda não possui coordenada carregada. Confira lat/lon na planilha.');
  };

  function renderLogisticaClean(){
    const tbody = $('#table-logistica');
    if (!tbody) return false;

    normalizeAll();

    const table = tbody.closest('table');
    if (table) {
      table.classList.add('vesco-clean-log-table-v42');
      const thead = table.querySelector('thead');
      if (thead) {
        thead.innerHTML = `
          <tr>
            <th class="p-3 pl-4 text-left">Pedido</th>
            <th class="p-3 text-left">Cliente e endereço</th>
            <th class="p-3 text-left">Operação</th>
            <th class="p-3 text-left">Forma de envio</th>
            <th class="p-3 pr-4 text-right">Ação</th>
          </tr>`;
      }
    }

    const rows = listOrders()
      .filter(o => o && shouldShowLogistica(o))
      .filter(o => !isFlexLike(o))
      .filter(o => rowMatchesSearch(o))
      .sort((a,b) => {
        const ra = resolveFormaEnvio(a);
        const rb = resolveFormaEnvio(b);
        return (ra.prioridade - rb.prioridade) ||
          dateKeyBR(getData(a)).localeCompare(dateKeyBR(getData(b))) ||
          getNum(a).localeCompare(getNum(b));
      });

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-slate-400 font-bold">Nenhum pedido logístico disponível.</td></tr>`;
      return true;
    }

    tbody.innerHTML = rows.map((o, idx) => {
      const id = getId(o) || getNum(o);
      const r = resolveFormaEnvio(o);
      const tipoClass = chipClassByTipo(r.tipo);
      const formaClass = r.nome === 'Não definida'
        ? 'bg-slate-50 text-slate-600 border-slate-200'
        : 'bg-white text-slate-700 border-slate-200';

      return `
        <tr class="${idx % 2 ? 'bg-slate-50/60' : 'bg-white'} hover:bg-blue-50/30 border-b border-slate-100 text-xs md:text-sm">
          <td class="p-3 pl-4 align-middle font-black text-slate-900 whitespace-nowrap">#${esc(getNum(o) || 'S/N')}</td>
          <td class="p-3 align-middle min-w-[260px]">
            <div class="font-black text-slate-900 truncate max-w-[380px]">${esc(getCliente(o) || '—')}</div>
            <div class="text-[11px] text-slate-500 truncate max-w-[460px] mt-0.5">${esc(getEndereco(o) || 'Endereço não disponível')}</div>
          </td>
          <td class="p-3 align-middle min-w-[230px]">
            <span class="inline-flex items-center px-3 py-1 rounded-full border font-black text-[11px] ${tipoClass}">${esc(operacaoTexto(o))}</span>
          </td>
          <td class="p-3 align-middle">
            <span class="inline-flex items-center px-2.5 py-1 rounded-lg border font-black text-[10px] ${formaClass}" title="${esc(txt(o.__vesco_forma_envio_original_v42 || r.raw || r.nome))}">
              ${esc(r.nome)}
            </span>
          </td>
          <td class="p-3 pr-4 align-middle text-right whitespace-nowrap">
            <button class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg font-black text-[11px]" onclick="vescoCleanFocusV42('${esc(id)}')">Localizar</button>
            <button class="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-lg font-black text-[11px] ml-1" onclick="updateStatusJsonp('${esc(id)}','Pronto p/ Entrega')">Concluir</button>
            <button class="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-lg font-black text-[11px] ml-1" onclick="vescoCleanDetailsV42('${esc(id)}')">Detalhes</button>
          </td>
        </tr>`;
    }).join('');

    return true;
  }

  function renderFlexClean(){
    const tbody = $('#table-envios-flex-corpo');
    if (!tbody) return false;

    normalizeAll();

    const rows = listFlex()
      .filter(f => f && shouldShowFlex(f))
      .filter(f => rowMatchesSearch(f, [f.numero_ecommerce, f.produtos, f.store_name].join(' ')))
      .sort((a,b) => dateKeyBR(getData(a)).localeCompare(dateKeyBR(getData(b))) || getNum(a).localeCompare(getNum(b)));

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-slate-400 font-bold">Nenhum pedido Flex detectado.</td></tr>`;
      return true;
    }

    tbody.innerHTML = rows.map((f, idx) => {
      const id = getId(f) || getNum(f);
      const r = resolveFormaEnvio(f);
      const numeroEcom = txt(f.numero_ecommerce || f.referencia || '—');
      const volumes = txt(f.qtd_volumes || f.volumes || f.items_count || 1);

      return `
        <tr class="${idx % 2 ? 'bg-slate-50/60' : 'bg-white'} hover:bg-blue-50/30 border-b border-slate-100 text-xs md:text-sm">
          <td class="p-3 pl-4 font-black text-slate-900">
            #${esc(getNum(f) || 'S/N')}
            <div class="text-[11px] text-slate-400 font-bold">E-com: ${esc(numeroEcom)}</div>
          </td>
          <td class="p-3 text-center font-bold">${esc(volumes)}</td>
          <td class="p-3">
            <div class="font-black text-slate-900">${esc(getCliente(f) || '—')}</div>
            <div class="text-[11px] text-slate-500 mt-0.5">${esc(getEndereco(f) || '—')}</div>
            ${f.produtos ? `<div class="mt-1 inline-block bg-blue-50 border border-blue-100 rounded-lg px-2 py-1 text-[10px] font-bold text-blue-700">${esc(f.produtos)}</div>` : ''}
          </td>
          <td class="p-3 text-center font-black text-slate-700">${esc(getData(f) || '—')}</td>
          <td class="p-3">
            <span class="inline-flex px-3 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-black text-[11px]">
              ${esc(r.nome === 'Não definida' ? 'Entrega' : r.nome)} • ${esc(getStatus(f))}
            </span>
          </td>
          <td class="p-3 pr-4 text-right">
            <button class="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-lg font-black text-[11px]" onclick="markFlexDelivered('${esc(id)}','${esc(getNum(f))}')">Entregue</button>
          </td>
        </tr>`;
    }).join('');

    return true;
  }

  function cleanPollutedDom(){
    const pollutedRegex = /Forma de envio n[aã]o informada.*Forma de envio n[aã]o informada|Forma de envio n[aã]o definida.*Forma de envio|Retirar pessoalmente.*Retirar pessoalmente|Não definida.*Não definida|Normal\s*\|\s*Normal|LALAMOVE.*LALAMOVE/i;

    $$('span, small, button, div, td').forEach(el => {
      if (!el || !el.textContent) return;
      if (el.children && el.children.length > 3) return;

      const text = el.textContent.trim();
      if (!text || text.length < 12) return;
      if (!pollutedRegex.test(text)) return;

      const clean = compactarFormaEnvio(text);
      if (!clean) return;

      el.textContent = clean;
      el.title = text;
      el.classList.add('vesco-cleaned-text-v42');
    });
  }

  function cleanDuplicatedMapButtons(){
    ['#view-logistica', '#view-envios_flex', '#view-rotas', '#view-saiu'].forEach(sel => {
      const root = $(sel);
      if (!root) return;

      const buttons = $$('button', root).filter(b => /ampliar mapa|minimizar mapa/i.test(b.textContent || ''));
      buttons.forEach((b, i) => { if (i > 0) b.remove(); });

      const labels = $$('div, span, strong', root).filter(el => /^mapa log[íi]stico$/i.test((el.textContent || '').trim()));
      labels.forEach((l, i) => { if (i > 0) l.remove(); });
    });
  }

  function applyClean(){
    normalizeAll();

    const view = currentView();

    if (view === 'logistica') renderLogisticaClean();
    if (view === 'flex') renderFlexClean();

    cleanPollutedDom();
    cleanDuplicatedMapButtons();
  }

  function installCss(){
    if ($('#vescoCleanLogisticaV42Css')) return;

    const style = document.createElement('style');
    style.id = 'vescoCleanLogisticaV42Css';
    style.textContent = `
      .vesco-clean-log-table-v42{min-width:920px!important;table-layout:auto!important;}
      #table-logistica td{height:auto!important;vertical-align:middle!important;}
      #view-logistica .card{overflow:hidden!important;}
      #view-logistica .overflow-x-auto{overflow-x:auto!important;}
      #view-logistica .leaflet-container{min-height:260px!important;}
      .vesco-cleaned-text-v42{
        max-width:180px!important;
        overflow:hidden!important;
        text-overflow:ellipsis!important;
        white-space:nowrap!important;
      }
      @media(max-width:760px){
        .vesco-clean-log-table-v42{min-width:760px!important;}
        #view-logistica .grid{display:block!important;}
      }
    `;
    document.head.appendChild(style);
  }

  function patchKnownClassifiers(){
    try {
      if (window.vescoV16 && !window.vescoV16.__cleanV42) {
        const oldNormalize = window.vescoV16.normalizeFormaEnvio || window.vescoV16.normalizeForma;
        if (typeof oldNormalize === 'function') {
          window.vescoV16.normalizeFormaEnvio = function(o){
            setDisplayFields(o);
            return resolveFormaEnvio(o).nome;
          };
          window.vescoV16.normalizeForma = window.vescoV16.normalizeFormaEnvio;
        }
        window.vescoV16.__cleanV42 = true;
      }
    } catch(e) {}

    try {
      if (window.vescoFormasEnvioPriorityV15 && !window.vescoFormasEnvioPriorityV15.__cleanV42) {
        window.vescoFormasEnvioPriorityV15.classifyOrder = function(o){
          setDisplayFields(o);
          const r = resolveFormaEnvio(o);
          return {
            rank: r.prioridade,
            label: r.prioridadeLabel,
            tipo: r.tipo,
            forma: r.nome
          };
        };
        window.vescoFormasEnvioPriorityV15.__cleanV42 = true;
      }
    } catch(e) {}
  }

  const oldRender = (typeof render === 'function') ? render : window.render;
  if (typeof oldRender === 'function' && !window.__vescoCleanLogisticaV42RenderWrapped) {
    window.__vescoCleanLogisticaV42RenderWrapped = true;

    window.render = function(){
      normalizeAll();
      const res = oldRender.apply(this, arguments);
      setTimeout(applyClean, 30);
      setTimeout(applyClean, 180);
      return res;
    };

    try { render = window.render; } catch(e) {}
  }

  const oldScheduleRender = (typeof scheduleRender === 'function') ? scheduleRender : window.scheduleRender;
  if (typeof oldScheduleRender === 'function' && !window.__vescoCleanLogisticaV42ScheduleWrapped) {
    window.__vescoCleanLogisticaV42ScheduleWrapped = true;

    window.scheduleRender = function(){
      normalizeAll();
      const res = oldScheduleRender.apply(this, arguments);
      setTimeout(applyClean, 90);
      setTimeout(applyClean, 300);
      return res;
    };

    try { scheduleRender = window.scheduleRender; } catch(e) {}
  }

  const oldSwitchTab = window.switchTab;
  if (typeof oldSwitchTab === 'function' && !window.__vescoCleanLogisticaV42SwitchWrapped) {
    window.__vescoCleanLogisticaV42SwitchWrapped = true;

    window.switchTab = function(which){
      normalizeAll();
      const res = oldSwitchTab.apply(this, arguments);
      setTimeout(applyClean, 80);
      setTimeout(applyClean, 300);
      return res;
    };
  }

  const oldLoad = window.load || (typeof load === 'function' ? load : null);
  if (typeof oldLoad === 'function' && !window.__vescoCleanLogisticaV42LoadWrapped) {
    window.__vescoCleanLogisticaV42LoadWrapped = true;

    window.load = function(){
      const res = oldLoad.apply(this, arguments);
      setTimeout(applyClean, 600);
      setTimeout(applyClean, 1600);
      return res;
    };

    try { load = window.load; } catch(e) {}
  }

  document.addEventListener('DOMContentLoaded', function(){
    installCss();
    patchKnownClassifiers();

    const search = $('#search');
    if (search && !search.dataset.vescoCleanV42Bound) {
      search.dataset.vescoCleanV42Bound = '1';
      search.addEventListener('input', () => setTimeout(applyClean, 60));
    }

    setTimeout(applyClean, 300);
    setTimeout(applyClean, 1200);
  });

  window.vescoCleanV42 = {
    apply: applyClean,
    normalizeAll,
    compactarFormaEnvio,
    resolveFormaEnvio,
    renderLogistica: renderLogisticaClean,
    renderFlex: renderFlexClean,
    debug(){
      normalizeAll();
      const polluted = $$('body *')
        .filter(el => /Forma de envio n[aã]o informada.*Forma de envio n[aã]o informada|Retirar pessoalmente.*Retirar pessoalmente|Não definida.*Não definida|Normal\s*\|\s*Normal/i.test(el.textContent || ''))
        .slice(0, 10)
        .map(el => (el.textContent || '').trim().slice(0, 160));

      return {
        view: currentView(),
        orders: listOrders().length,
        flex: listFlex().length,
        polluted,
        exemplo: listOrders().slice(0, 5).map(o => ({
          pedido: getNum(o),
          id_forma_envio: getIdFormaEnvio(o),
          forma: resolveFormaEnvio(o).nome,
          tipo: resolveFormaEnvio(o).tipo
        }))
      };
    }
  };

  installCss();
  patchKnownClassifiers();
  setTimeout(applyClean, 300);
  setTimeout(applyClean, 1200);

  console.log('V42 ativo — Logística limpa: forma de envio aparece uma vez; ID 0/sem ID = Não definida; dados originais preservados em Detalhes.');
})();
