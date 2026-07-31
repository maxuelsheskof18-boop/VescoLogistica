// app.js — VESCO CONTROL V10.34-WORKER-COMPAT (completo)
// Preserva o aplicativo legado e troca a fonte ERP/logística para o VESCO Operacional Realtime.
// Mercado Livre Flex e geocodificação continuam nas APIs específicas já existentes.

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
// --- Endpoints oficiais ---
const API = window.VESCO_API_URL ||
  "https://atendente-vesco-worker.2cwhzy.easypanel.host/api";

const API_FLEX = window.VESCO_API_FLEX_URL ||
  "https://script.google.com/macros/s/AKfycbyJXPpN3D8yrcRb0LCy8CY8vegzzF-vKkj7YPmx8WVGouAhBvj_5D_qxhSfyIYTacL1/exec";

const VESCO_WORKER_BASE = window.VESCO_EASYPANEL_URL ||
  API.replace(/\/api\/?(?:\?.*)?$/i, "");

const VESCO_EVENTS_URL = window.VESCO_EVENTS_URL ||
  VESCO_WORKER_BASE.replace(/\/+$/, "") + "/events";

const VESCO_FIREBASE_ROOT = String(
  window.VESCO_FIREBASE_ROOT || "vesco_operacao_v2"
).replace(/^\/+|\/+$/g, "");

window.VESCO_API_URL = API;
window.VESCO_API_FLEX_URL = API_FLEX;
window.VESCO_EASYPANEL_URL = VESCO_WORKER_BASE;
window.VESCO_EVENTS_URL = VESCO_EVENTS_URL;
window.VESCO_FIREBASE_ROOT = VESCO_FIREBASE_ROOT;

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

// --- Helpers básicos ---
function debounce(fn, ms = 60) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
function scheduleRender() {
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
function isAppsScriptUrl(url) {
  try {
    const host = new URL(url, window.location.href).hostname.toLowerCase();
    return host === "script.google.com" || host.endsWith(".googleusercontent.com");
  } catch (_) {
    return String(url || "").includes("script.google.com");
  }
}

function parseApiResponseText(raw) {
  let value = raw;
  for (let i = 0; i < 3 && typeof value === "string"; i++) {
    const trimmed = value.trim();
    if (!trimmed) return {};
    try {
      value = JSON.parse(trimmed);
      continue;
    } catch (_) {
      const jsonp = trimmed.match(/^[^(]*\(([\s\S]*)\)\s*;?\s*$/);
      if (jsonp && jsonp[1]) {
        value = JSON.parse(jsonp[1]);
        continue;
      }
      break;
    }
  }
  return value;
}

async function fetchJsonApi(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`API HTTP ${response.status}: ${raw.slice(0, 300)}`);
    }
    const parsed = parseApiResponseText(raw);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("A API retornou uma resposta inválida.");
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

function jsonpFetch(url, cb, timeoutMs = 30000) {
  // O VESCO Worker responde JSON/CORS. Apps Script Flex continua em JSONP.
  if (!isAppsScriptUrl(url)) {
    fetchJsonApi(url, timeoutMs)
      .then(data => {
        if (typeof cb === "function") cb(null, data);
      })
      .catch(error => {
        console.error("[VESCO API]", error);
        if (typeof cb === "function") cb(error, null);
      });
    return;
  }

  const cbName = "__jsonp_cb_" + Math.random().toString(36).slice(2, 11);
  const script = document.createElement("script");
  const timeout = setTimeout(() => {
    try { delete window[cbName]; } catch (_) {}
    if (script.parentNode) script.remove();
    if (typeof cb === "function") cb(new Error("JSONP timeout"), null);
  }, timeoutMs);

  window[cbName] = function (result) {
    clearTimeout(timeout);
    try {
      if (typeof cb === "function") cb(null, result);
    } finally {
      try { delete window[cbName]; } catch (_) {}
      if (script.parentNode) script.remove();
    }
  };

  script.onerror = function () {
    clearTimeout(timeout);
    try { delete window[cbName]; } catch (_) {}
    if (script.parentNode) script.remove();
    if (typeof cb === "function") cb(new Error("JSONP script error"), null);
  };

  const separator = url.includes("?") ? "&" : "?";
  script.src = `${url}${separator}callback=${encodeURIComponent(cbName)}`;
  script.id = cbName;
  document.head.appendChild(script);
}

function jsonpFetchPromise(url, timeoutMs = 30000) {
  if (!isAppsScriptUrl(url)) {
    return fetchJsonApi(url, timeoutMs).then(resp => ({ jsonp: false, resp }));
  }

  return new Promise((resolve, reject) => {
    jsonpFetch(url, (error, resp) => {
      if (error) reject(error);
      else resolve({ jsonp: true, resp });
    }, timeoutMs);
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
  const selectedDate =
    document.getElementById("date-filter")?.value ||
    document.getElementById("v8Date")?.value ||
    new Date().toISOString().slice(0, 10);

  const erpUrl = new URL(API, window.location.href);
  erpUrl.searchParams.set("action", "loadVesco");
  erpUrl.searchParams.set("dataISO", selectedDate);
  erpUrl.searchParams.set("_ts", Date.now());

  // ERP/logística pelo VESCO Operacional Realtime.
  jsonpFetch(erpUrl.toString(), function(err, resp){
    if (err) {
      console.error("Falha ao carregar VESCO Worker:", err);
      showToast("Não foi possível atualizar os pedidos do ERP.");
      scheduleRender();
      return;
    }

    const dadosErp = Array.isArray(resp)
      ? resp
      : (
          resp?.pedidos ||
          resp?.orders ||
          resp?.rows ||
          resp?.data ||
          []
        );

    if (!Array.isArray(dadosErp)) {
      console.warn("VESCO Worker respondeu sem lista de pedidos:", resp);
      scheduleRender();
      return;
    }

    orders = dadosErp
      .filter(o => o && (o.numero || o.id || o.pedido || o.pedido_key))
      .map(normalizeOrderObject);

    orders.forEach(o => {
      o.data_prevista = o.data_prevista && String(o.data_prevista).trim()
        ? extractDateDefinitiveWithDebug(o.data_prevista)
        : extractDateDefinitiveWithDebug(o);
    });

    window.VESCO_DATA = resp;
    window.VESCO_PEDIDOS = orders;
    window.dispatchEvent(new CustomEvent("vesco:data", {
      detail: {
        ...(resp && typeof resp === "object" ? resp : {}),
        pedidos: orders,
        data: orders,
        rows: orders
      }
    }));

    scheduleRender();
  }, 45000);

  // FLEX
  (function fetchFlexRobust(){
    const urlBase = `${API_FLEX}?action=separacoesIndex`;
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
    return (st === 'a separar' || st === 'em separação') && (String(o.numero || '').toLowerCase().includes(searchQ) || String(o.cliente_nome || '').toLowerCase().includes(searchQ));
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
    const prontosOrders = orders.filter(o => String(o.status_logistica || '').toLowerCase().trim().includes('pronto') && (String(o.numero || '').toLowerCase().includes(searchQ) || String(o.cliente_nome || '').toLowerCase().includes(searchQ)));
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
    const pendOrders = orders.filter(o => String(o.status_logistica || '').toLowerCase().trim() === 'pendente');
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
      return (
        String(f.numero || '').toLowerCase().includes(q) ||
        String(f.cliente_nome || '').toLowerCase().includes(q) ||
        String(f.endereco_completo || '').toLowerCase().includes(q) ||
        String(f.numero_ecommerce || '').toLowerCase().includes(q) ||
        String(f.store_name || '').toLowerCase().includes(q)
      );
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
    const entregueOrders = orders.filter(o => String(o.status_logistica || '').toLowerCase().trim() === 'entregue' && (String(o.numero || '').toLowerCase().includes(searchQ) || String(o.cliente_nome || '').toLowerCase().includes(searchQ)));
    
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
        const status = o.situacao_nome || '—';
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
  if(sumSepararEl) sumSepararEl.innerText = orders.filter(o => !o.status_logistica || String(o.status_logistica).toLowerCase().includes('a separar')).length;
  if(sumProcessoEl) sumProcessoEl.innerText = orders.filter(o => String(o.status_logistica).toLowerCase().includes('em separa')).length;
  if(sumTotalEl) sumTotalEl.innerText = orders.length;
  if(sumFlexEl) {
     const flexFiltrados = (flexOrders || []).filter(f => String(f.numero || '').trim() !== '');
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
      return !frete.includes('flex') && !frete.includes('mercado');
    });
    const flexFiltradosParaMapa = (flexOrders || []).filter(f => String(f.numero || '').trim() !== '');
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

    setInterval(load, 180000); // fallback; o realtime SSE atualiza antes
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
    topCalendar.value = new Date(dBr.getTime() - (offset*60*1000)).toISOString().split('T')[0];
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
    const hoje = new Date();
    const source = [...(window.orders || []), ...(window.flexOrders || [])];

    return source.filter(o => {
      try {
        const possibleDateFields = [
          o.separado_em, o.separadoEm, o.data_separacao, o.separado_data,
          o.data_separado, o.separado, o.data_separacao_extrato, o.dataSeparacao
        ];

        let sepDate = null;
        for (const f of possibleDateFields) {
          if (f) {
            if (typeof parseAnyDateValue === 'function') {
              sepDate = parseAnyDateValue(f);
            } else {
              sepDate = new Date(f);
            }
            if (sepDate && !isNaN(sepDate.getTime())) break;
          }
        }

        if ((!sepDate || isNaN(sepDate.getTime())) && typeof extractDateDefinitive === 'function') {
          try {
            const d2 = extractDateDefinitive(o);
            if (d2 && !isNaN(new Date(d2).getTime())) sepDate = new Date(d2);
          } catch (e) {}
        }

        if (sepDate && !isNaN(sepDate.getTime())) {
          const sameDay =
            sepDate.getFullYear() === hoje.getFullYear() &&
            sepDate.getMonth() === hoje.getMonth() &&
            sepDate.getDate() === hoje.getDate();
          if (sameDay) return true;
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
      el.innerHTML = `<div class="p-4 text-slate-500 text-sm">Nenhum pedido separado hoje.</div>`;
      return;
    }

    const checkedSet = new Set(getSelectedEcomsForRoute());

    const header = `
      <div class="flex items-center justify-between mb-2">
        <div class="text-sm text-slate-600 font-semibold">${list.length} pedido(s) separados hoje</div>
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

    if (!window.saiuRotas || window.saiuRotas.length === 0) {
      el.innerHTML = `<div class="p-4 text-slate-500">Nenhuma rota criada.</div>`;
      return;
    }

    el.innerHTML = window.saiuRotas.map(r => {
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

// =================================================================
// VESCO WORKER REALTIME — SSE + fallback
// =================================================================
(function installVescoWorkerRealtime(){
  if (window.__vescoWorkerRealtimeAppV1031) return;
  window.__vescoWorkerRealtimeAppV1031 = true;

  let source = null;
  let reloadTimer = null;
  let reconnectTimer = null;
  let connected = false;
  let lastEventAt = "";

  const eventNames = [
    "order.updated",
    "order.status.updated",
    "order.extras.updated",
    "order.route.assigned",
    "route.updated",
    "proof.created",
    "sync.completed",
    "sync.failed"
  ];

  function queueReload(reason){
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      lastEventAt = new Date().toISOString();
      console.log("[VESCO Realtime] Atualizando:", reason || "evento");
      try {
        const result = window.load ? window.load() : load();
        if (result && typeof result.catch === "function") result.catch(console.error);
      } catch (error) {
        console.error("[VESCO Realtime] Falha na atualização:", error);
      }
    }, 350);
  }

  function connect(){
    if (!window.EventSource || !VESCO_EVENTS_URL) return false;
    if (source) {
      try { source.close(); } catch (_) {}
    }

    source = new EventSource(VESCO_EVENTS_URL);

    source.addEventListener("connected", () => {
      connected = true;
      console.log("[VESCO Realtime] conectado em", VESCO_EVENTS_URL);
    });

    eventNames.forEach(name => {
      source.addEventListener(name, () => queueReload(name));
    });

    source.onmessage = () => queueReload("message");

    source.onerror = () => {
      connected = false;
      try { source.close(); } catch (_) {}
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 5000);
    };

    return true;
  }

  window.VescoAppRealtime = {
    version: "V10.34-WORKER-COMPAT",
    connect,
    refresh: () => queueReload("manual"),
    stop: () => {
      clearTimeout(reloadTimer);
      clearTimeout(reconnectTimer);
      if (source) source.close();
      source = null;
      connected = false;
    },
    status: () => ({
      connected,
      eventsUrl: VESCO_EVENTS_URL,
      lastEventAt
    })
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", connect, { once: true });
  } else {
    connect();
  }
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
// DIAGNÓSTICO DO APP LEGADO ATUALIZADO
// =================================================================
window.VESCO_APP_DEBUG = function(){
  return {
    version: "V10.34-WORKER-COMPAT",
    api: API,
    apiFlex: API_FLEX,
    events: VESCO_EVENTS_URL,
    firebaseRoot: VESCO_FIREBASE_ROOT,
    orders: Array.isArray(orders) ? orders.length : 0,
    flexOrders: Array.isArray(flexOrders) ? flexOrders.length : 0,
    realtime: window.VescoAppRealtime?.status?.() || null
  };
};

console.log("VESCO app.js V10.34-WORKER-COMPAT ativo — ERP pelo vesco-worker e Flex preservado.");
