// modulo.vesco-v8-operacional.js — V10.59 MENU MOBILE CORRIGIDO / PEDIDOS EMPILHADOS
// Base operacional V10.55 preservada. Alterações somente para navegação mobile e restauração do menu desktop.
// Base V10.51 preservada, com camada mobile completa, paginação adaptativa e navegação touch.

(function(){
  if (window.VescoV8 && window.VescoV8.__v1040) return;

  const API_MAIN = window.VESCO_API_URL || "https://script.google.com/macros/s/AKfycbwQ8-Rn-zZJQM0fLm9js3ErtJZefRnHP55E3M0r3Z_TIXS_skTioZ6p3yHqTLFYxPU9/exec";
  const API_FLEX = window.VESCO_API_FLEX_URL || "https://script.google.com/macros/s/AKfycbzDp2qs2S_MxDc_3afY1TurNKYEwfYKkk2cc4IliNxLiVaJuSKYyRqofOUMnhdFBjwNwg/exec";
  const EASYPANEL_URL = (window.VESCO_EASYPANEL_URL || "https://atendente-vesco-worker.2cwhzy.easypanel.host").replace(/\/$/,"");
  const PLANILHA_BRIDGE_URL = String(window.VESCO_PLANILHA_WEB_APP_URL || window.VESCO_BRIDGE_WEB_APP_URL || "").trim();
  // Por segurança, deixe vazio no frontend público. Se preencher, o botão Atualizar também chama /sync.
  const EASYPANEL_SECRET = window.VESCO_EASYPANEL_SECRET || "";

  const state = {
    tab: "dashboard",
    date: todayISO(),
    month: todayISO().slice(0,7),
    orders: [],
    flex: [],
    loaded: false,
    loading: false,
    maps: {},
    layers: {},
    markers: { logistica: {}, flex: {} },
    lastPayload: null,
    lastFlexPayload: null,
    lastFlexRawCount: 0,
    lastFlexAcceptedCount: 0,
    lastFlexRejectedSamples: [],
    rotas: [],
    deliveredExternal: [],
    routeDirections: {},
    tarefas: [],
    rotaFlexExtras: [],
    routeSelection: {},
    geoAutoRunning: {},
    geoCache: {},
    geoPersistentCache: {},
    cepCache: {},
    orderPatchesCache: {},
    orderPatchesCacheAt: 0,
    mapViews: {},
    mapFitKeys: {},
    flexArchive: {},
    flexMonthView: todayISO().slice(0,7),
    motoristasLocalizacao: {},
    motoristaTrackingFocus: "",
    driverTrackTimer: null,
    driverLiveMapFitDone: false,
    driverRealtimeAttached: false,
    driverLastRenderAt: 0,
    rotasCriadasCollapsed: localStorage.getItem("vesco:v1021:rotasCollapsed")!=="0",
    sidebarCollapsed: localStorage.getItem("vesco:v8:sidebarCollapsed")==="1",
    snapshotSeparadosHoje: [],
    hasSnapshotSeparadosHoje: false,
    snapshotEntreguesHoje: [],
    hasSnapshotEntreguesHoje: false,
    pageByTab: {},
    perfRevision: 1,
    badgeCacheRevision: -1,
    badgeCache: null,
    derivedCache: null,
    derivedCacheKey: "",
    masterOrderIndex: null,
    masterOrderIndexRevision: -1,
    routeReadyCache: null,
    routeReadyCacheKey: "",
    lastRenderedTab: "",
    userNavigatingUntil: 0,
    renderToken: 0
  };

  // V10.56 — paginação adaptativa preservada; layout desktop não é sobrescrito pela camada mobile.
  const VESCO_PERF_VERSION = "V10.59-MOBILE-MENU-PEDIDOS-EMPILHADOS";
  const VESCO_IS_MOBILE_RUNTIME = !!(window.matchMedia && window.matchMedia("(max-width: 899px), (max-height: 640px) and (max-width: 1100px)").matches);
  const VESCO_TABLE_LIMIT = Number(window.VESCO_TABLE_LIMIT || 120);
  function viewportWidth(){
    const values=[
      Number(document.documentElement?.clientWidth||0),
      Number(window.innerWidth||0),
      Number(window.visualViewport?.width||0)
    ].filter(v=>Number.isFinite(v)&&v>0);
    return Math.max(240, values.length ? Math.min(...values) : 1280);
  }
  function responsivePageSize(){
    const w=viewportWidth();
    // V10.59: no mobile os pedidos ficam empilhados em uma lista contínua.
    // Até 12 cards são exibidos um abaixo do outro antes da paginação.
    if(w<=899) return 12;
    const configured=Number(window.VESCO_PAGE_SIZE);
    if(Number.isFinite(configured)&&configured>0) return Math.max(1,Math.min(70,configured));
    if(w<1200) return 18;
    return 24;
  }
  function responsiveMapPageSize(){
    const w=viewportWidth();
    // Telas com mapa continuam leves, mas sem mostrar somente um pedido.
    if(w<=899) return 8;
    const configured=Number(window.VESCO_MAP_PAGE_SIZE);
    if(Number.isFinite(configured)&&configured>0) return Math.max(1,Math.min(50,configured));
    if(w<1200) return 14;
    return 20;
  }
  const VESCO_MAP_LIMIT = Math.max(10,Math.min(VESCO_IS_MOBILE_RUNTIME?50:160,Number(window.VESCO_MAP_LIMIT || (VESCO_IS_MOBILE_RUNTIME?50:120))));
  const VESCO_AUTO_GEOCODE = window.VESCO_AUTO_GEOCODE === true;
  const VESCO_ROUTE_LINE = window.VESCO_ROUTE_LINE === true;
  const VESCO_GEO_CONCURRENCY = Math.max(1, Math.min(5, Number(window.VESCO_GEO_CONCURRENCY || 3)));
  const VESCO_GEO_BATCH_LIMIT = Math.max(5, Math.min(80, Number(window.VESCO_GEO_BATCH_LIMIT || 36)));
  const VESCO_PATCH_CACHE_MS = Math.max(10000, Number(window.VESCO_PATCH_CACHE_MS || 30000));
  const VESCO_GEO_CACHE_TTL_MS = Math.max(86400000, Number(window.VESCO_GEO_CACHE_TTL_MS || 7776000000));
  let v1035RenderLock = false;
  let v1050NominatimChain = Promise.resolve();

  function limitRows(list, limit = VESCO_TABLE_LIMIT){
    return Array.isArray(list) ? list.slice(0, Math.max(1, Number(limit)||120)) : [];
  }
  function limitedNotice(total, shown, label){
    total = Number(total||0); shown = Number(shown||0);
    if(total <= shown) return "";
    return `<div class="v1035-perf-note"><b>Modo rápido:</b> mostrando ${shown} de ${total} ${esc(label||"registro(s)")}. Use a busca para filtrar ou abra a lista completa apenas quando necessário.</div>`;
  }

  function invalidatePerfCaches(){
    state.perfRevision = Number(state.perfRevision||0) + 1;
    state.badgeCacheRevision = -1;
    state.badgeCache = null;
    state.derivedCache = null;
    state.derivedCacheKey = "";
    state.masterOrderIndex = null;
    state.masterOrderIndexRevision = -1;
    state.routeReadyCache = null;
    state.routeReadyCacheKey = "";
  }
  function derivedLists(){
    const key=[state.perfRevision,state.date,state.month,state.orders.length,state.flex.length,state.rotas.length].join("|");
    if(state.derivedCache && state.derivedCacheKey===key) return state.derivedCache;
    const d={
      separacao:separacaoList(),
      pendencias:pendenciasProdutoList(),
      pronto:prontoList(),
      logistica:logisticaList(),
      retiradas:retiradaList(),
      flex:flexList(),
      separados:separadosList(),
      entregues:entreguesList(),
      tarefas:tarefasFrotaList()
    };
    state.derivedCache=d;
    state.derivedCacheKey=key;
    return d;
  }
  function paginationFor(list, tab=state.tab, pageSize=null){
    const rows=Array.isArray(list)?list:[];
    const resolved=pageSize===null||pageSize===undefined?responsivePageSize():Number(pageSize);
    const size=Math.max(1,Number(resolved)||responsivePageSize());
    const totalPages=Math.max(1,Math.ceil(rows.length/size));
    let page=Math.max(1,Number(state.pageByTab?.[tab]||1));
    if(page>totalPages) page=totalPages;
    state.pageByTab[tab]=page;
    const start=(page-1)*size;
    const end=Math.min(rows.length,start+size);
    return {tab,page,pageSize:size,total:rows.length,totalPages,start,end,items:rows.slice(start,end)};
  }
  function pagerHtml(p){
    if(!p || p.totalPages<=1) return "";
    const from=p.total? p.start+1 : 0;
    const tab=esc(p.tab);
    return `<div class="v1051-pager v1057-pager" role="navigation" aria-label="Paginação de pedidos" data-vpage-current="${p.page}" data-vpage-total="${p.totalPages}">
      <button type="button" class="v8-btn secondary v1057-page-btn" data-vpage-tab="${tab}" data-vpage="${p.page-1}" aria-label="Página anterior" ${p.page<=1?"disabled":""}><i class="fas fa-chevron-left" aria-hidden="true"></i><span class="v1057-page-label">Anterior</span></button>
      <span class="v1057-page-status"><b>${from}-${p.end}</b> de <b>${p.total}</b><small>Página ${p.page} de ${p.totalPages}</small></span>
      <button type="button" class="v8-btn secondary v1057-page-btn" data-vpage-tab="${tab}" data-vpage="${p.page+1}" aria-label="Próxima página" ${p.page>=p.totalPages?"disabled":""}><span class="v1057-page-label">Próxima</span><i class="fas fa-chevron-right" aria-hidden="true"></i></button>
    </div>`;
  }
  function isMobilePageRuntime(){
    return !!(window.matchMedia && window.matchMedia("(max-width: 899px), (max-width: 1100px) and (pointer: coarse)").matches);
  }
  function getPageScroller(){
    const main=document.getElementById("v8Main");
    if(isMobilePageRuntime() && main) return main;
    return document.scrollingElement || document.documentElement || document.body;
  }
  function scrollToCurrentList(){
    const target=document.querySelector("#v8Content .v1057-pager") || document.querySelector("#v8Content .v8-card .v8-table-wrap") || document.getElementById("v8Content");
    if(!target) return;
    const scroller=getPageScroller();
    if(scroller && scroller.id==="v8Main"){
      const topbar=document.getElementById("v8Topbar");
      const relativeTop=target.getBoundingClientRect().top-scroller.getBoundingClientRect().top+scroller.scrollTop-(topbar?.offsetHeight||0)-8;
      try{scroller.scrollTo({top:Math.max(0,relativeTop),behavior:"auto"});}catch(_e){scroller.scrollTop=Math.max(0,relativeTop);}
      return;
    }
    const top=Math.max(0,Math.round(target.getBoundingClientRect().top + (window.scrollY||0) - 76));
    try{window.scrollTo({top,behavior:"auto"});}catch(_e){window.scrollTo(0,top);}
  }
  function setListPage(tab,page){
    const t=txt(tab)||state.tab;
    const next=Math.max(1,Number(page)||1);
    if(state.pageByTab[t]===next && state.tab===t) return false;
    state.pageByTab[t]=next;
    state.userNavigatingUntil=Date.now()+180;
    if(isMobilePageRuntime()){
      render();
      requestAnimationFrame(scrollToCurrentList);
      setTimeout(scrollToCurrentList,60);
    }else{
      const scroller=document.scrollingElement || document.documentElement || document.body;
      if(scroller) scroller.scrollTop=0;
      scheduleRender(true);
    }
    return true;
  }
  let v1057LastPagerPointerAt=0;
  function bindPagerNavigation(){
    if(document.documentElement.dataset.v1057PagerBound==="1") return;
    document.documentElement.dataset.v1057PagerBound="1";
    const activate=ev=>{
      const btn=ev.target?.closest?.(".v1057-page-btn[data-vpage]");
      if(!btn || btn.disabled) return;
      if(ev.type==="click" && Date.now()-v1057LastPagerPointerAt<650){
        ev.preventDefault(); ev.stopPropagation();
        return;
      }
      if(ev.type==="pointerup") v1057LastPagerPointerAt=Date.now();
      ev.preventDefault();
      ev.stopPropagation();
      setListPage(btn.dataset.vpageTab||state.tab,Number(btn.dataset.vpage));
    };
    document.addEventListener("pointerup",activate,true);
    document.addEventListener("click",activate,true);
    document.addEventListener("keydown",ev=>{
      const btn=ev.target?.closest?.(".v1057-page-btn[data-vpage]");
      if(!btn || btn.disabled || (ev.key!=="Enter" && ev.key!==" ")) return;
      ev.preventDefault(); ev.stopPropagation();
      setListPage(btn.dataset.vpageTab||state.tab,Number(btn.dataset.vpage));
    },true);
  }
  let v1058ResponsiveSize=responsivePageSize();
  let v1058ResizeTimer=null;
  function bindResponsivePaginationResize(){
    if(document.documentElement.dataset.v1058ResponsivePagerBound==="1") return;
    document.documentElement.dataset.v1058ResponsivePagerBound="1";
    const onResize=()=>{
      clearTimeout(v1058ResizeTimer);
      v1058ResizeTimer=setTimeout(()=>{
        const next=responsivePageSize();
        if(next===v1058ResponsiveSize) return;
        v1058ResponsiveSize=next;
        state.pageByTab={};
        if(state.loaded) render();
        requestAnimationFrame(()=>{ const scroller=getPageScroller(); if(scroller) scroller.scrollTop=0; });
      },90);
    };
    window.addEventListener("resize",onResize,{passive:true});
    window.addEventListener("orientationchange",onResize,{passive:true});
    window.visualViewport?.addEventListener("resize",onResize,{passive:true});
  }
  function resetCurrentPage(){ state.pageByTab[state.tab]=1; }
  function tabMeta(tab){
    const all={
      dashboard:["Dashboard","Resumo executivo da operação em tempo real"],
      separacao:["Separação","Fila ativa de pedidos ERP ainda não separados."],
      separados:["Separados Hoje","Pedidos concluídos na data selecionada."],
      saiu:["Pronto para Envio","Pedidos separados disponíveis para montar rota."],
      logistica:["Logística ERP","Pedidos ERP pendentes de entrega."],
      retiradas:["Retiradas","Retiradas e pedidos sem rota."],
      tarefas:["Tarefas Frota","Tarefas externas da frota."],
      flex:["Envios Flex","Pedidos Flex do mês."],
      entregues:["Entregues","Pedidos finalizados na data selecionada."]
    };
    return all[tab]||all.dashboard;
  }
  let v1053NavWatchdog=null;
  function markNavigationBusy(on){
    document.body.classList.toggle("v1051-nav-busy",!!on);
    const c=document.getElementById("v8Content");
    if(c) c.setAttribute("aria-busy",on?"true":"false");
    clearTimeout(v1053NavWatchdog);
    if(on){
      // Em aparelhos móveis uma exceção ou render cancelado não pode deixar a tela sem clique.
      v1053NavWatchdog=setTimeout(()=>{
        document.body.classList.remove("v1051-nav-busy");
        const content=document.getElementById("v8Content");
        if(content) content.setAttribute("aria-busy","false");
      },1200);
    }
  }
  function defer(fn, ms=30){
    setTimeout(()=>{ try{ fn(); }catch(e){ console.warn("V10.35 defer falhou", e); } }, ms);
  }


  function sleep(ms){ return new Promise(resolve=>setTimeout(resolve, ms)); }
  function txt(v){ return v === null || v === undefined ? "" : String(v).trim(); }
  function norm(v){ return txt(v).normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim(); }
  function keyNorm(v){ return norm(v).replace(/\s+/g,""); }
  function esc(v){ return txt(v).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function todayISO(){
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone:"America/Sao_Paulo",
      year:"numeric", month:"2-digit", day:"2-digit"
    }).format(new Date());
  }
  function br(v){ const s=parseISO(v)||txt(v); const m=s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : (s||"—"); }
  function brDateTime(v){
    const raw=txt(v);
    if(!raw) return "—";
    let d=null;
    if(/^\d{4}-\d{2}-\d{2}T/.test(raw)){
      d=new Date(raw);
    }else if(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(raw)){
      d=new Date(raw.replace(" ","T"));
    }
    if(d && !isNaN(d.getTime())){
      return d.toLocaleString("pt-BR", {
        timeZone:"America/Sao_Paulo",
        day:"2-digit", month:"2-digit", year:"numeric",
        hour:"2-digit", minute:"2-digit", second:"2-digit"
      }) + " BRT";
    }
    const iso=parseISO(raw);
    if(iso && raw.length<=10) return br(iso);
    return raw;
  }
  function money(v){ return Number(v||0).toLocaleString("pt-BR", { style:"currency", currency:"BRL" }); }
  function parseMoney(v){
    if(typeof v==="number") return Number.isFinite(v)?v:0;
    let s=txt(v).replace(/[^0-9,.-]/g,"");
    if(!s) return 0;
    const comma=s.lastIndexOf(","), dot=s.lastIndexOf(".");
    if(comma>=0 && dot>=0){
      if(comma>dot) s=s.replace(/\./g,"").replace(",",".");
      else s=s.replace(/,/g,"");
    }else if(comma>=0){
      const decimals=s.length-comma-1;
      s=(decimals===1||decimals===2)?s.replace(/\./g,"").replace(",","."):s.replace(/,/g,"");
    }else if(dot>=0){
      const decimals=s.length-dot-1;
      if(!(decimals===1||decimals===2)) s=s.replace(/\./g,"");
    }
    const n=Number(s);
    return Number.isFinite(n)?n:0;
  }

  function pick(o, aliases){
    if(!o) return "";
    for(const a of aliases){ if(o[a] !== undefined && o[a] !== null && txt(o[a]) !== "") return o[a]; }
    const map = {};
    Object.keys(o).forEach(k => map[keyNorm(k)] = o[k]);
    for(const a of aliases){ const nk=keyNorm(a); if(map[nk] !== undefined && map[nk] !== null && txt(map[nk]) !== "") return map[nk]; }
    return "";
  }

  function parseISO(v){
    const s = txt(v);
    if(!s) return "";
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if(m){ const y=m[3].length===2?"20"+m[3]:m[3]; return `${y}-${String(m[2]).padStart(2,"0")}-${String(m[1]).padStart(2,"0")}`; }
    return "";
  }


  
  function safeLocalJson(key, fallback){
    try{
      const raw=localStorage.getItem(key);
      if(!raw) return fallback;
      const parsed=JSON.parse(raw);
      return parsed && typeof parsed==="object" ? parsed : fallback;
    }catch(e){ return fallback; }
  }
  function saveLocalJson(key, value){
    try{ localStorage.setItem(key, JSON.stringify(value)); return true; }catch(e){ return false; }
  }
  function extractCep(v){
    const m=txt(v).match(/\b(\d{2})\.?\s?(\d{3})-?\s?(\d{3})\b/);
    return m ? `${m[1]}${m[2]}${m[3]}` : "";
  }
  function addressKey(v){
    return norm(v).replace(/\b(referencia|ref|complemento|observacao)\b.*$/g,"").replace(/\s+/g," ").trim();
  }
  function cleanDisplayAddress(v){
    let a=txt(v);
    if(!a) return "";
    a=a.replace(/\s*\|\s*/g,", ").replace(/\s+/g," ").replace(/,\s*,+/g,", ").trim();
    a=a.replace(/,?\s*(refer[eê]ncia|referencia|ref\.?|observa[cç][aã]o)\s*[:\-]?\s*[^,]+(?:,\s*\d+[A-Za-z\-\/]{0,5})?/ig,"");
    const parts=a.split(",").map(x=>x.trim()).filter(Boolean);
    if(parts.length>2){
      const first=norm(parts[0]);
      const num=(parts[1].match(/\d+[A-Za-z\-\/]{0,5}/)||[""])[0];
      const kept=[];
      for(let i=0;i<parts.length;i++){
        const n=norm(parts[i]);
        if(i>1 && first && n.includes(first) && (!num || n.includes(norm(num)))) continue;
        kept.push(parts[i]);
      }
      a=kept.join(", ");
    }
    const cep=extractCep(a);
    if(cep){
      const fmt=`${cep.slice(0,5)}-${cep.slice(5)}`;
      a=a.replace(/\b\d{2}\.?\s?\d{3}-?\s?\d{3}\b/,fmt);
    }
    return a.replace(/,\s*,+/g,", ").replace(/\s+,/g,",").trim().replace(/^,|,$/g,"").trim();
  }
  function loadPersistentCaches(){
    state.geoPersistentCache=safeLocalJson("vesco:v1050:geoCache",{});
    state.cepCache=safeLocalJson("vesco:v1050:cepCache",{});
    const now=Date.now();
    Object.keys(state.geoPersistentCache||{}).forEach(k=>{
      const x=state.geoPersistentCache[k];
      if(!x || !x.ts || now-Number(x.ts)>VESCO_GEO_CACHE_TTL_MS) delete state.geoPersistentCache[k];
    });
  }
  function persistGeoCache(){
    const entries=Object.entries(state.geoPersistentCache||{}).sort((a,b)=>Number(b[1]?.ts||0)-Number(a[1]?.ts||0)).slice(0,1200);
    state.geoPersistentCache=Object.fromEntries(entries);
    saveLocalJson("vesco:v1050:geoCache",state.geoPersistentCache);
  }
  function cachedGeoForAddress(v){
    const key=addressKey(v);
    if(!key) return null;
    const x=state.geoPersistentCache?.[key];
    if(!x || x.status!=="OK" || Date.now()-Number(x.ts||0)>VESCO_GEO_CACHE_TTL_MS) return null;
    return x;
  }
  function rememberGeoForAddress(v, ge){
    const key=addressKey(v);
    if(!key || !ge || ge.status!=="OK") return false;
    state.geoPersistentCache[key]={...ge,ts:Date.now()};
    persistGeoCache();
    return true;
  }

  function transportadoraRealPainel(o){
    const vals=[
      o&&o.transportadora,o&&o.transportador,o&&o.nomeTransportador,o&&o.nome_transportador,
      o&&o.transportadora_nome,o&&o.nome_transportadora,o&&o.carrier,o&&o.shipping_carrier,
      o&&o.raw&&o.raw.nome_transportador,o&&o.raw&&o.raw.transportadora,o&&o.raw&&o.raw.transportador,
      o&&o.raw&&o.raw.transportador&&o.raw.transportador.nome,o&&o.raw&&o.raw.transportadora&&o.raw.transportadora.nome,
      o&&o.raw&&o.raw.transporte&&o.raw.transporte.nome_transportador,o&&o.raw&&o.raw.transporte&&o.raw.transporte.transportadora,
      o&&o.raw&&o.raw.transporte&&o.raw.transporte.nome
    ].map(v=>String(v||'').trim()).filter(Boolean);
    for(const v of vals){
      const n=norm(v);
      if(!n||n==='0'||n==='-'||n==='nao definida'||n==='nao definido'||n==='sem transportadora') continue;
      // T/X/R/D são códigos, não nome da transportadora.
      if(/^[txrd]$/i.test(v)) continue;
      return v;
    }
    return '';
  }
  function hasTransportCodeEntrega(o){
    const vals=[
      pick(o,["forma_envio_nome","formaEnvioNome","forma_envio","formaEnvio","id_forma_envio","idFormaEnvio","tipo_entrega","tipoEntrega"]),
      pick(o,["shipping_method_name","modalidade_envio","modalidadeEnvio","forma_entrega","formaEntrega"])
    ].map(txt).join(' | ');
    const s=norm(vals);
    // No Tiny/Olist, T e X aparecem como forma de entrega/transportadora. Não pode cair como retirada.
    return /(^|\s|\|)(t|x|d)(\s|\||$)/i.test(vals) || s.includes('transportadora') || s.includes('lalamove') || s.includes('entrega') || s.includes('delivery') || s.includes('motoboy');
  }
  function tipoEntregaPainel(o){
    if(transportadoraRealPainel(o) || hasTransportCodeEntrega(o)) return 'Entrega';
    const t=normalize(o&&o.tipo_entrega);
    if(t.includes('sem endereco')) return 'Sem endereço';
    return 'Retirada';
  }

  function orderKey(o){ return txt(pick(o,["pedido_key","pedidoKey","id","id_tiny","idTiny","tiny_order_id","pedido_id","numero","num","pedido","numero_pedido","numeroPedido"])); }
  function number(o){
    o=o||{};
    const internalIds=[
      pick(o,["id_tiny","idTiny","tiny_order_id","pedido_id","order_id"]),
      o.id
    ].map(txt).filter(Boolean).map(v=>v.replace(/^.*__/,""));
    const rawObjs=[o.raw,o.__raw,o.detalhe,o.raw_order,o.pedido_raw].filter(x=>x&&typeof x==="object");
    const candidates=[
      pick(o,["tiny_number","numero_tiny","numeroTiny","numero_pedido_tiny"]),
      pick(o,["numero","numeroPedido","numero_pedido"]),
      pick(o,["pedido","num"])
    ];
    rawObjs.forEach(r=>{
      candidates.push(pick(r,["numero","tiny_number","numeroPedido","numero_pedido"]));
      if(r.pedido&&typeof r.pedido==="object") candidates.push(pick(r.pedido,["numero","tiny_number","numeroPedido"]));
    });
    const clean=[...new Set(candidates.map(txt).filter(Boolean))];
    const commercial=clean.find(v=>!internalIds.includes(v.replace(/^.*__/,"")) && !v.includes("__"));
    return commercial || clean[0] || txt(pick(o,["id_tiny","idTiny","id"])) || orderKey(o);
  }
  function ecom(o){ return txt(pick(o,["numero_ecommerce","numeroEcommerce","ecommerce","e_commerce","ecom","id_ecommerce","idEcommerce"])); }
  function client(o){ return txt(pick(o,["cliente_nome","clienteNome","cliente nome","destinatario","destinatário","cliente","nome","nome_destinatario","nomeDestinatario"]) || "Cliente não informado"); }
  function addressCandidate(v){
    const s=txt(v);
    if(!s) return "";
    const n=norm(s);
    if(n==="-" || n==="—") return "";
    if(n.includes("endereco nao disponivel") || n.includes("endereco nao informado") || n.includes("sem endereco") || n.includes("nao informado")) return "";
    return s;
  }
  function addressFromParts(obj){
    if(!obj || typeof obj!=="object") return "";
    const parts=[
      pick(obj,["logradouro","rua","endereco","endereço","address"]),
      pick(obj,["numero","número","num"]),
      pick(obj,["complemento","bairro"]),
      pick(obj,["cidade","municipio","município"]),
      pick(obj,["uf","estado"]),
      pick(obj,["cep","zip"])
    ].map(txt).filter(Boolean);
    const joined=parts.join(", ");
    return addressCandidate(joined);
  }
  function safeJsonObj(v){
    if(!v || typeof v==="object") return v && typeof v==="object" ? v : null;
    try{ const p=JSON.parse(String(v)); return p && typeof p==="object" ? p : null; }catch(e){ return null; }
  }
  function address(o){
    o=o||{};
    const direct=addressCandidate(pick(o,[
      "endereco_completo","enderecoCompleto","endereco completo","endereço completo",
      "endereco","endereço","address","full_address","fullAddress",
      "endereco_entrega","enderecoEntrega","shipping_address","delivery_address"
    ]));
    if(direct) return cleanDisplayAddress(direct);

    const rawObjs=[
      o.raw,o.__raw,o.raw_order,o.pedido_raw,o.detalhe,o.pedido,
      safeJsonObj(o.raw_preview),safeJsonObj(o.rawPreview),safeJsonObj(o.raw)
    ].filter(x=>x && typeof x==="object");

    for(const r of rawObjs){
      const d=addressCandidate(pick(r,[
        "endereco_completo","enderecoCompleto","endereco completo","endereço completo",
        "endereco","endereço","address","full_address","fullAddress",
        "endereco_entrega","enderecoEntrega","shipping_address","delivery_address"
      ]));
      if(d) return cleanDisplayAddress(d);

      const nested=[
        r.endereco_entrega,r.enderecoEntrega,r.endereco,r.cliente,r.destinatario,
        r.shipping_address,r.delivery_address,r.address
      ].filter(x=>x && typeof x==="object");
      for(const n of nested){
        const nd=addressCandidate(pick(n,[
          "endereco_completo","enderecoCompleto","endereco completo","endereço completo",
          "endereco","endereço","address","full_address","fullAddress"
        ])) || addressFromParts(n);
        if(nd) return cleanDisplayAddress(nd);
      }

      const byParts=addressFromParts(r);
      if(byParts) return cleanDisplayAddress(byParts);
    }

    return "";
  }
  function statusAll(o){ return [pick(o,["status_logistica","statusLogistica","status logistica"]), pick(o,["situacao_tiny","situacaoTiny","situacao tiny"]), pick(o,["situacao_nome","situacaoNome","situacao nome"]), pick(o,["situacao","situação"]), pick(o,["status_tiny","statusTiny","status tiny"]), pick(o,["status"]), pick(o,["is_delivered"]), pick(o,["is_delivered","entregue"])] .map(txt).join(" | "); }
  function status(o){ return txt(pick(o,["status_logistica","statusLogistica","status logistica","status"]) || pick(o,["situacao_nome","situacaoNome","situacao","situação","situacao_tiny","status_tiny"]) || ""); }
  function formaText(o){
    const direct=[
      pick(o,["id_forma_envio","idFormaEnvio","idFormaEnvioPsq","forma_envio_id","id forma envio"]),
      pick(o,["forma_envio_nome","formaEnvioNome","nome_forma_envio","nomeformafenvio","forma envio nome"]),
      pick(o,["forma_envio","formaEnvio","forma envio","forma_de_envio","formaDeEnvio"]),
      pick(o,["forma_frete","formaFrete","forma de frete","forma_frete_nome","formaFreteNome"]),
      pick(o,["forma_recebimento","formaRecebimento","forma recebimento","forma_retirada","formaRetirada"]),
      pick(o,["modalidade_envio","modalidadeEnvio","modalidade","shipping_mode","shippingMode"]),
      pick(o,["transportadora","transportador","transportador_nome","transportadorNome"]),
      pick(o,["tipo_entrega","tipoEntrega","tipo entrega","tipo_envio","tipoEnvio","tipo_pedido"]),
      pick(o,["prioridade_label","prioridadeLabel","prioridade label"]),
      pick(o,["is_flex"]),
      pick(o,["__source","__v8source"])
    ];
    const extra=[];
    try{Object.keys(o||{}).forEach(k=>{const nk=norm(k); if(nk.includes("envio")||nk.includes("frete")||nk.includes("retir")||nk.includes("entrega")||nk.includes("shipping")||nk.includes("forma")||nk.includes("tipo")||nk==="forma_fr"||nk==="tipo_entr"){const v=o[k]; if(typeof v==="string"||typeof v==="number"||typeof v==="boolean") extra.push(v);}});}catch(e){}
    return direct.concat(extra).map(txt).filter(Boolean).join(" | ");
  }
  
  function retiradaCodigoFields(o){
    // V10.43: Retirada NÃO é definida por forma_frete=R/CIF.
    // O que vale: transportadora real/código T/X/D => Entrega. Retirada só quando o campo de retirada é explícito.
    if(transportadoraRealPainel(o) || hasTransportCodeEntrega(o)) return false;
    const keys=[
      "forma_retirada","formaRetirada","tipo_retirada","tipoRetirada",
      "retirada","retirada_confirmada","retiradaConfirmada","pickup","pick_up"
    ];
    for(const k of keys){
      const v=txt(pick(o,[k]));
      if(!v) continue;
      const n=norm(v);
      if(n==="true" || n==="1" || n==="sim" || n==="r" || n==="ret" || n.includes("retirada") || n.includes("retirar") || n.includes("pickup")) return true;
    }
    return false;
  }

  function produtosText(o){
    let v=pick(o,["produtos","produto","itens","items","itens_pedido","itensPedido","descricao_produtos","descricaoProdutos","descricao_itens","descricaoItens","nome_produto","produto_nome"]);
    if(Array.isArray(v)){
      return v.map(item=>{
        if(typeof item==="string") return item;
        const q=txt(item.quantidade||item.qtd||item.qty||item.qtde||"");
        const n=txt(item.nome||item.produto||item.descricao||item.sku||item.title||"");
        return [q?`${q}x`:"",n].filter(Boolean).join(" ");
      }).filter(Boolean).join(" + ");
    }
    if(v && typeof v==="object"){
      try{return Object.values(v).map(x=>typeof x==="string"?x:txt(x.nome||x.produto||x.descricao||"")).filter(Boolean).join(" + ");}catch(e){}
    }
    return txt(v);
  }
  function pagamentoText(o){
    return txt(pick(o,[
      "forma_pagamento","formaPagamento","forma pagamento","pagamento","meio_pagamento","meioPagamento",
      "condicao_pagamento","condicaoPagamento","condição pagamento","forma_pagamento_nome","formaPagamentoNome",
      "payment_method","paymentMethod","payment_method_id","paymentMethodId","parcelas","tipo_pagamento"
    ]));
  }
  function pagamentoHtml(o){
    const p=pagamentoText(o);
    return p?`<em class="v105-payment"><i class="fas fa-credit-card"></i> ${esc(p)}</em>`:"";
  }
  function produtoHtml(o){
    const p=produtosText(o);
    return p?`<div class="v105-products" title="${esc(p)}">${esc(p)}</div>`:`<span class="v8-chip gray">Sem produto</span>`;
  }
  function operadorAtual(force=false){
    let op=txt(localStorage.getItem("vesco:v105:operador") || localStorage.getItem("vesco:v9:operador_pendencia") || window.VESCO_OPERADOR || "");
    if((force || !op || op==="Painel") && !window.__vescoNoOperatorPrompt){
      const novo=prompt("Nome do operador:", op && op!=="Painel"?op:"");
      if(txt(novo)){
        op=txt(novo);
        localStorage.setItem("vesco:v105:operador",op);
        localStorage.setItem("vesco:v9:operador_pendencia",op);
      }else{
        op=op||"Painel";
      }
    }
    return op||"Painel";
  }
  function definirOperador(nome){
    const op=txt(nome || prompt("Nome do operador:", localStorage.getItem("vesco:v105:operador")||""));
    if(op){
      localStorage.setItem("vesco:v105:operador",op);
      localStorage.setItem("vesco:v9:operador_pendencia",op);
      alert("Operador definido: " + op);
    }
    return op;
  }
  function sepStartTime(o){ return pick(o,["separacao_inicio_em","inicio_separacao_em","hora_inicio","inicio_em","started_at"]); }
  function sepEndTime(o){ return pick(o,["separacao_fim_em","fim_separacao_em","conclusao_separacao_em","hora_conclusao","separado_em","finished_at"]); }
  function sepStartOperator(o){ return txt(pick(o,["operador_inicio_separacao","operador_inicio","operador_start","operador"])); }
  function sepEndOperator(o){ return txt(pick(o,["operador_conclusao_separacao","operador_separado","operador_fim","operador_finalizacao","operador"])); }
  function sepTempo(o){
    const saved=txt(pick(o,["tempo_separacao","tempoSeparacao"]));
    if(saved) return saved;
    const min=pick(o,["tempo_separacao_minutos","tempoSeparacaoMinutos"]);
    if(txt(min)) return `${min} min`;
    const start=Date.parse(sepStartTime(o));
    const end=Date.parse(sepEndTime(o));
    if(Number.isFinite(start)&&Number.isFinite(end)&&end>=start){
      const m=Math.round((end-start)/60000);
      return m<60?`${m} min`:`${Math.floor(m/60)}h ${m%60}min`;
    }
    return "—";
  }
  function operationalDate(o){
    // Data operacional: quando o pedido entrou/foi puxado para a fila.
    // NÃO usa data_prev/data_prevista, porque isso é previsão de entrega.
    return parseISO(pick(o,[
      "data_operacional_iso","data_operacional","data_ped","dataPed",
      "data_pedido","dataPedido","data pedido","data_emissao","dataEmissao",
      "data_criacao","dataCriacao","created_at","criado_em","data"
    ]));
  }
  function forecastDate(o){
    // Data prevista de entrega. Serve para exibir, mas não para esconder pedido da separação.
    return parseISO(pick(o,[
      "data_prevista_iso","data_prevista","dataPrevista","data_previsao","dataPrevisao",
      "data previsão","data_prev","dataPrev","previsao_entrega","previsaoEntrega","data_entrega"
    ]));
  }
  function dueDate(o){ return forecastDate(o) || operationalDate(o); }
  function pullDate(o){ return operationalDate(o) || parseISO(pick(o,["data_ped","data_pedido","dataPedido","created_at","criado_em","data"])) || ""; }
  function deliveryDate(o){
    // V10.29: Pendência/A Separar nunca usa updated_at como entrega.
    const s=norm(statusAll(o));
    if(planilhaStatusVetaEntregue(o) && !hasComprovanteEntregaReal(o)) return "";

    const real=parseISO(pick(o,[
      "data_entregue_iso","data_entregue","entregue_em","retirado_em","retirada_em",
      "finalizado_em","data_finalizado","data_entrega_realizada","data_retirada",
      "concluido_em","confirmado_entregue_em","confirmado_retirado_em"
    ]));
    if(real) return real;

    const finalStatus =
      s==="entregue" || s==="retirado" || s==="finalizado" || s==="finalizada" ||
      s==="concluido" || s==="concluído" || s.includes("entrega realizada") ||
      s.includes("pedido entregue") || s.includes("confirmado entregue") ||
      s.includes("retirada concluida") || s.includes("retirada finalizada");

    if(finalStatus && !planilhaStatusVetaEntregue(o)){
      return parseISO(pick(o,["updated_at","status_atualizado_em","atualizado_em","ultima_atualizacao_status"]));
    }
    return "";
  }
  function sepDate(o){
    // V10.43: usa somente data real do evento de separação; não usa ultima_sincronizacao.
    const finalDate=parseISO(pick(o,[
      "data_separacao_iso","data_conclusao_separacao","dataSeparacao","data_separacao",
      "separado_em","separado_data","data_separado",
      "conclusao_separacao_em","fim_separacao_em","separacao_fim_em","hora_conclusao",
      "separacao_finalizada_em","separacao_concluida_em"
    ]));
    if(finalDate) return finalDate;
    const s=norm(statusAll(o));
    const finalStatus=s.includes("separado") || s.includes("pronto") || s.includes("despachado");
    if(finalStatus){
      return parseISO(pick(o,[
        "status_atualizado_em","ultima_atualizacao_status",
        "operador_ultima_alteracao_em","updated_at"
      ]));
    }
    return "";
  }
  function value(o){ const v = pick(o,["valor_num","valor_total","valorPedido","valor_pedido","valor","total","total_pedido","preco_total","preco","valor_nf","valor_venda","receita"]); return parseMoney(v); }
  


  function isRetiradaFinalizada(o){
    // V10.45: função defensiva para não quebrar o boot.
    // Retirada finalizada só vale quando houver status final ou data/campo real de retirada.
    const s=norm([
      statusAll(o),
      pick(o,["status_retirada","statusRetirada","tipo_finalizacao","tipoFinalizacao"]),
      pick(o,["retirada_confirmada","retiradaConfirmada"]),
      pick(o,["retirado_em","retirada_em","data_retirada","confirmado_retirado_em"])
    ].map(txt).join(" | "));
    const hasData=!!txt(pick(o,[
      "retirado_em","retirada_em","data_retirada","confirmado_retirado_em",
      "nome_recebedor","recebedor","doc_recebedor"
    ]));
    if(String(pick(o,["retirada_confirmada","retiradaConfirmada"])).toLowerCase()==="true") return true;
    if(hasData && (s.includes("retir") || isRetirada(o))) return true;
    return s.includes("retirada finalizada") || s.includes("retirada concluida") ||
      s.includes("retirada concluída") || s.includes("retirado") || s.includes("confirmado retirado");
  }

  function isRetirada(o){
    // V10.45: transportadora/código de entrega vence qualquer heurística de retirada.
    if(transportadoraRealPainel(o) || hasTransportCodeEntrega(o)) return false;
    if(retiradaCodigoFields(o)) return true;
    const raw=formaText(o)+" | "+txt(pick(o,[
      "tipo_finalizacao","tipoFinalizacao","retirada_confirmada","motivo",
      "status_logistica","situacao_nome","tipo_entrega","tipoEntrega"
    ]));
    const s=norm(raw);
    return String(pick(o,["retirada_confirmada"])).toLowerCase()==="true" ||
      s.includes("retirada") || s.includes("retirado") ||
      s.includes("retirar pessoalmente") || s.includes("retira pessoalmente") ||
      s.includes("retirar na loja") || s.includes("retirar no local") ||
      s.includes("cliente retira") || s.includes("cliente retira na loja") ||
      s.includes("pickup") || s.includes("pick up") || s.includes("pick-up") ||
      ["747632298","758290131","860463094"].some(id=>raw.includes(id));
  }

  function isCancelledOrderFront(o){
    const s=norm([
      statusAll(o),
      pick(o,["situacao_tiny","situacao","status","status_logistica","situacao_nome"]),
      pick(o,["cancelado","canceled","is_cancelled","cancelled"])
    ].map(txt).join(" | "));
    return s.includes("cancelado") || s.includes("cancelada") ||
      s.includes("canceled") || s.includes("cancelled");
  }

  function isDelivered(o){
    // V10.45: função restaurada. Evita ReferenceError e impede que A Separar/Pendência vire Entregue.
    const s=norm(statusAll(o));
    if(isCancelledOrderFront(o)) return false;
    if(typeof planilhaStatusVetaEntregue === "function" && planilhaStatusVetaEntregue(o)) return false;
    if(isRetiradaFinalizada(o)) return true;
    const hasRealProof = typeof hasComprovanteEntregaReal === "function" ? hasComprovanteEntregaReal(o) : !!txt(pick(o,["entregue_em","data_entrega_realizada","nome_recebedor","recebedor"]));
    if(String(pick(o,["is_delivered","entregue"])).toLowerCase()==="true" && hasRealProof) return true;
    if(deliveryDate(o)) return true;

    // Estados intermediários não são entrega final.
    if(
      s.includes("nao entregue") || s.includes("não entregue") ||
      s.includes("a entregar") || s.includes("saiu para entrega") ||
      s.includes("em rota") || s.includes("pendente") ||
      s.includes("pendencia") || s.includes("pendência") ||
      s.includes("a separar") || s.includes("em separacao") ||
      s.includes("em separação") || s.includes("separado") ||
      s.includes("pronto para envio") || s.includes("pronto para rota") ||
      s.includes("pronto") || s.includes("em aberto")
    ) return false;

    return s==="entregue" || s==="finalizado" || s==="finalizada" ||
      s==="concluido" || s==="concluído" ||
      s.includes("entrega realizada") || s.includes("pedido entregue") ||
      s.includes("confirmado entregue");
  }

  function hasAddress(o){ const a=norm(address(o)); if(!a || a==="-" || a==="—") return false; return !(a.includes("endereco nao disponivel") || a.includes("endereço não disponível") || a.includes("sem endereco") || a.includes("sem endereço") || a.includes("nao informado") || a.includes("não informado")); }

  
  function looksLikeSPAddress(oOrAddress){
    const raw=typeof oOrAddress==="string" ? oOrAddress : address(oOrAddress);
    const a=norm(raw);
    const cep=extractCep(raw);
    const cepNum=cep?Number(cep):0;
    const cepSP=cepNum>=1000000 && cepNum<=19999999;
    return a.includes("sao paulo sp") || a.includes("sao paulo - sp") || a.includes(" sao paulo ") || /(^|\s)sp($|\s)/.test(a) || cepSP;
  }
  function explicitSaoPauloCity(oOrAddress){
    const raw=typeof oOrAddress==="string" ? oOrAddress : address(oOrAddress);
    const a=norm(raw);
    return a.includes("sao paulo sp") || a.includes("sao paulo - sp") || /,\s*s[aã]o paulo\s*,?\s*sp/i.test(raw);
  }
  function coordInGrandeSP(lat,lon){
    return Number.isFinite(lat) && Number.isFinite(lon) && lat>=-24.35 && lat<=-22.55 && lon>=-47.65 && lon<=-45.35;
  }
  function coordInEstadoSP(lat,lon){
    return Number.isFinite(lat) && Number.isFinite(lon) && lat>=-25.45 && lat<=-19.70 && lon>=-53.20 && lon<=-44.00;
  }
  function coordCompatibleWithAddress(oOrAddress, lat, lon){
    if(explicitSaoPauloCity(oOrAddress) && !coordInGrandeSP(lat,lon)) return false;
    if(looksLikeSPAddress(oOrAddress) && !coordInEstadoSP(lat,lon)) return false;
    return true;
  }
  function cleanAddressForSPGeocode(addr){
    let a=cleanDisplayAddress(addr);
    if(!a) return "";
    const cep=(a.match(/\b\d{2}\.?\d{3}-?\d{3}\b/)||[""])[0];
    const parts=a.split(",").map(x=>x.trim()).filter(Boolean);
    const street=parts[0]||"";
    let house="";
    for(let i=1;i<Math.min(parts.length,4);i++){
      const m=parts[i].match(/^\d+[A-Za-z\-\/]*/);
      if(m){house=m[0];break;}
    }
    const city=looksLikeSPAddress(a)?"São Paulo, SP, Brasil":"Brasil";
    return [street,house,city,cep].filter(Boolean).join(", ");
  }
  function geocodeCandidates(addr){
    const a=cleanDisplayAddress(addr);
    const clean=cleanAddressForSPGeocode(a);
    const cep=(a.match(/\b\d{2}\.?\d{3}-?\d{3}\b/)||[""])[0];
    const out=[];
    if(clean) out.push(clean);
    if(cep && looksLikeSPAddress(a)) out.push(`${cep}, São Paulo, SP, Brasil`);
    // Versão sem referência/complemento duplicado, comum nos endereços do Tiny.
    const noNoise=a
      .replace(/,?\s*(refer[eê]ncia|referencia|ref\.?|observa[cç][aã]o|complemento)\b.*?(?=,\s*(s[aã]o paulo|sp|\d{2}\.?\d{3}-?\d{3})\b|$)/ig,"")
      .replace(/,\s*,/g,",").trim();
    if(noNoise && noNoise!==clean) out.push(noNoise);
    if(a && a!==clean && a!==noNoise) out.push(a);
    return [...new Set(out.map(x=>x.replace(/\s+/g," ").replace(/,\s*,/g,",").trim()).filter(Boolean))];
  }
  async function geocodeNominatimRaw(query, originalAddress){
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),8000);
    try{
      const url="https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=br&addressdetails=1&q="+encodeURIComponent(query);
      const res=await fetch(url,{headers:{"Accept":"application/json","Accept-Language":"pt-BR"},signal:ctrl.signal,cache:"force-cache"});
      if(!res.ok) throw new Error("Nominatim HTTP "+res.status);
      const rows=await res.json();
      for(const row of rows||[]){
        const lat=parseFloat(row.lat), lon=parseFloat(row.lon);
        if(!Number.isFinite(lat)||!Number.isFinite(lon)) continue;
        if(!coordCompatibleWithAddress(originalAddress,lat,lon)) continue;
        return {status:"OK",lat,lon,lng:lon,source:"nominatim",display_name:row.display_name,query};
      }
      return {status:"ZERO_RESULTS",source:"nominatim",query};
    }finally{ clearTimeout(timer); }
  }
  function geocodeNominatim(query, originalAddress){
    const task=v1050NominatimChain.then(()=>geocodeNominatimRaw(query,originalAddress));
    v1050NominatimChain=task.catch(()=>null).then(()=>sleep(1050));
    return task;
  }

function coords(o){
    let lat = parseFloat(String(pick(o,["lat","latitude","lat_destino","latitude_destino","geo_lat"]) ?? "").replace(",","."));
    let lon = parseFloat(String(pick(o,["lon","lng","longitude","lon_destino","lng_destino","longitude_destino","geo_lon"]) ?? "").replace(",","."));
    if(!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const okBR = lat >= -34 && lat <= 6 && lon >= -74 && lon <= -34;
    const swappedBR = lon >= -34 && lon <= 6 && lat >= -74 && lat <= -34;
    if(!okBR && swappedBR){ const t=lat; lat=lon; lon=t; }
    if(!coordCompatibleWithAddress(o,lat,lon)){
      o.geocode_status="COORDENADA_FORA_DE_SP_RECALCULAR";
      return null;
    }
    return {lat, lon};
  }

  function normalizeOrder(o, src){
    o = o || {};
    const n = {...o};
    n.__v8source = src || n.__v8source || n.__source || "";
    n.pedido_key = orderKey(n);
    n.numero = number(n);
    n.numero_ecommerce = ecom(n);
    n.cliente_nome = client(n);
    n.endereco_completo = address(n);
    n.status_logistica = status(n);
    n.data_operacional_iso = operationalDate(n);
    n.data_prevista_iso = dueDate(n);
    n.data_entregue_iso = deliveryDate(n);
    n.data_separacao_iso = sepDate(n);
    n.valor_num = value(n);
    n.marcador_flex_id = flexMarker(n);
    let c = coords(n);
    if(!c){
      const cached=cachedGeoForAddress(n.endereco_completo);
      if(cached){
        const lat=parseFloat(cached.lat), lon=parseFloat(cached.lon ?? cached.lng);
        if(coordCompatibleWithAddress(n,lat,lon)){ n.lat=lat; n.lon=lon; n.geocode_status="OK_CACHE_LOCAL_V1050"; n.geocode_source=cached.source||"cache_local"; c={lat,lon}; }
      }
    }
    if(c){ n.lat=c.lat; n.lon=c.lon; }
    n.is_delivered = isDelivered(n);
    n.is_flex = src === "flex" || (typeof isFlexIndicator === "function" ? isFlexIndicator(n) : false);
    n.is_retirada = isRetirada(n);
    n.has_address = hasAddress(n);
    return n;
  }

  function isGhostFirebaseOrder(o){
    if(!o || typeof o!=="object") return false;
    const src=txt(o.__v8source || o.__source);
    const c=norm(client(o));
    const a=norm(address(o));
    const hasRealClient=client(o) && c!=="pedido atualizado no firebase";
    const hasRealAddress=hasAddress(o);
    // Linhas mínimas criadas por versões anteriores do realtime poluíam Retiradas/Sem rota.
    return (src==="firebase" || c==="pedido atualizado no firebase") &&
      !hasRealAddress &&
      (!hasRealClient || c==="pedido atualizado no firebase") &&
      !String(pick(o,["recebedor","nome_recebedor","recebido_por"])).trim();
  }
  function removeGhostFirebaseRows(rows){
    return (rows||[]).filter(o=>!isGhostFirebaseOrder(o));
  }

  function dedup(arr){ const seen=new Set(), out=[]; (arr||[]).forEach(o=>{ if(!o || typeof o!=="object") return; const k=orderKey(o)||number(o)||ecom(o)||JSON.stringify(o).slice(0,80); if(!k || seen.has(k)) return; seen.add(k); out.push(o); }); return out; }
  function keys(o){ const vals=[orderKey(o), number(o), ecom(o), o?.id, o?.id_tiny, o?.id_flex, o?.numero_ecommerce].map(txt).filter(Boolean); const out=new Set(); vals.forEach(v=>{ out.add(v); out.add(v.replace(/^#/,"")); const d=v.replace(/\D/g,""); if(d) out.add(d); }); return [...out]; }

  function localOrders(){ const out=[]; const add=arr=>Array.isArray(arr)&&arr.forEach(o=>out.push(normalizeOrder(o,"erp"))); try{add(window.orders)}catch(e){} try{add(window.pedidos)}catch(e){} try{ if(window.VescoState?.orders) add(window.VescoState.orders()); }catch(e){} return dedup(out.filter(o=>!o.is_flex)); }
  function localFlex(){ const out=[]; const add=arr=>Array.isArray(arr)&&arr.forEach(o=>out.push(normalizeOrder(o,"flex"))); try{add(window.flexOrders)}catch(e){} try{add(window.pedidosFlex)}catch(e){} try{add(window.enviosFlex)}catch(e){} try{ if(window.VescoState?.flexOrders) add(window.VescoState.flexOrders()); }catch(e){} return dedup(out).filter(o=>!o.is_delivered); }

  function jsonp(url, params={}, timeout=18000){
    return new Promise((resolve,reject)=>{
      const cb="__vesco_v92_cb_"+Math.random().toString(36).slice(2);
      const qs=new URLSearchParams({...params, callback:cb, _v:Date.now()});
      const script=document.createElement("script");
      let done=false;

      function installLateSafeStub(){
        // Apps Script às vezes responde depois do timeout. Se apagarmos o callback,
        // o navegador gera "ReferenceError: __vesco... is not defined".
        // Mantemos um callback vazio por 2 minutos só para absorver resposta atrasada.
        window[cb]=function(){};
        setTimeout(()=>{
          try{ delete window[cb]; }
          catch(e){ try{ window[cb]=undefined; }catch(_e){} }
        },120000);
      }

      function cleanup(mode){
        clearTimeout(timer);
        try{ script.onload=null; script.onerror=null; }catch(e){}
        try{ script.remove(); }catch(e){}
        if(mode==="late-safe") installLateSafeStub();
        else {
          try{ delete window[cb]; }
          catch(e){ try{ window[cb]=undefined; }catch(_e){} }
        }
      }

      const timer=setTimeout(()=>{
        if(done) return;
        done=true;
        cleanup("late-safe");
        reject(new Error("timeout"));
      }, timeout);

      window[cb]=data=>{
        if(done) return;
        done=true;
        cleanup("normal");
        resolve(data);
      };

      script.onerror=()=>{
        if(done) return;
        done=true;
        cleanup("late-safe");
        reject(new Error("jsonp error"));
      };

      script.async=true;
      script.src=url+(url.includes("?")?"&":"?")+qs.toString();
      document.head.appendChild(script);
    });
  }
  function extractArray(obj,names){ if(!obj||typeof obj!=="object") return []; for(const n of names) if(Array.isArray(obj[n])) return obj[n]; if(obj.data&&typeof obj.data==="object") for(const n of names) if(Array.isArray(obj.data[n])) return obj.data[n]; if(Array.isArray(obj.data)) return obj.data; if(Array.isArray(obj.rows)) return obj.rows; return []; }

  const VALID_FLEX_MARKERS=new Set(["169826","170123","180985"]);
  function flexMarker(o){
    return txt(pick(o,[
      "marcador_flex_id","marker_flex_id","id_marcador_flex",
      "idMarcacaoPsq","id_marcacao_psq","marcador_id",
      "marcacao_id","idMarcador"
    ])).trim();
  }
  function isFlexIndicator(o){
    // V10.46: função defensiva restaurada para evitar ReferenceError no boot.
    // Indica Flex apenas quando há marcador Flex real/validado ou origem explicitamente Flex.
    if(!o || typeof o!=="object") return false;
    const source = txt(pick(o,["__v8source","__source","source","origem","tipo_origem","canal"])).toLowerCase();
    if(source === "flex" || source.includes("mercado envios flex") || source.includes("mercado livre flex")) return true;
    if(VALID_FLEX_MARKERS.has(flexMarker(o))) return true;
    const raw = norm([
      pick(o,["tipo_entrega","tipoEntrega","tipo_envio","forma_envio_nome","forma_envio","transportadora"]),
      pick(o,["marcador_validado_no_detalhe","validado_flex","validadoFlex","marker_validated","markerValidated"]),
      pick(o,["tags","marcadores","labels"])
    ].map(txt).join(" | "));
    return raw.includes("mercado envios flex") || raw.includes("envios flex") || raw.includes(" flex ") || raw.includes("marcador confirmado");
  }
  function isStrictFlexMarker(o){ return VALID_FLEX_MARKERS.has(flexMarker(o)); }
  function flexValidated(o){
    const raw = [
      pick(o,["marcador_validado_no_detalhe","marcadorValidadoNoDetalhe","validado_flex","validadoFlex","marker_validated","markerValidated","validado"]),
      pick(o,["detalhe_status","detalheStatus"]),
      pick(o,["motivo","validacao_motivo","validacaoMotivo"])
    ].map(txt).join(" | ");
    const n = norm(raw);
    return n==="sim" || n==="true" || n==="ok" || n.includes("marcador confirmado") || n.includes("confirmado no pedido obter");
  }
  function isFlexProjeto(o){
    if(!o || typeof o!=="object") return false;
    const source=txt(pick(o,["__v8source","__source","source"])).toLowerCase();
    const explicitFlex = o.is_flex === true || isFlexIndicator(o);

    // V10.49: quando a linha veio do endpoint dedicado /flex-pedidos ou do
    // Apps Script Flex, ela já passou pela fonte exclusiva do Flex.
    // Não descarta mais a linha só porque uma implantação antiga omitiu o
    // campo marcador_flex_id no JSON.
    if(source==="flex" && explicitFlex) return true;

    if(!isStrictFlexMarker(o)) return false;
    return flexValidated(o) || explicitFlex;
  }
  function autoCleanFlexStorageV87(){
    let removedKeys=0, removedRows=0, keptRows=0;
    for(let i=localStorage.length-1;i>=0;i--){
      const k=localStorage.key(i);
      if(!k || !k.startsWith("vesco:v8:flexMonth:")) continue;
      try{
        const parsed=JSON.parse(localStorage.getItem(k)||"{}");
        const rows=Array.isArray(parsed.rows)?parsed.rows.map(o=>normalizeOrder(o,"flex")):[];
        const clean=dedup(rows).filter(o=>o.is_flex && isFlexProjeto(o) && !o.is_delivered);
        removedRows += Math.max(0, rows.length-clean.length);
        keptRows += clean.length;
        if(clean.length) localStorage.setItem(k, JSON.stringify({...parsed, rows:clean, cleanedBy:"V8.7", cleanedAt:new Date().toISOString()}));
        else { localStorage.removeItem(k); removedKeys++; }
      }catch(e){ localStorage.removeItem(k); removedKeys++; }
    }
    return {removedKeys,removedRows,keptRows};
  }
  function clearFlexStorage(){
    const removed=[];
    for(let i=localStorage.length-1;i>=0;i--){
      const k=localStorage.key(i);
      if(k && (k.startsWith("vesco:v8:flexMonth:") || k.startsWith("vesco:flex") || k.includes("flexMonth"))){
        removed.push(k);
        localStorage.removeItem(k);
      }
    }
    state.flex=[];
    return removed;
  }


  const FLEX_STORE_PREFIX="vesco:v8:flexMonth:";
  function flexMonthOf(o){
    return (dueDate(o) || parseISO(pick(o,["data_pedido","dataPedido","data","created_at","criado_em"])) || "").slice(0,7);
  }
  function flexStorageKey(month){ return FLEX_STORE_PREFIX + (month || state.month || todayISO().slice(0,7)); }
  function readStoredFlex(month){
    try{
      const raw=localStorage.getItem(flexStorageKey(month));
      if(!raw) return [];
      const parsed=JSON.parse(raw);
      return Array.isArray(parsed?.rows) ? parsed.rows.map(o=>normalizeOrder(o,"flex")).filter(o=>o.is_flex && isFlexProjeto(o) && !o.is_delivered) : [];
    }catch(e){ return []; }
  }
  function saveStoredFlex(rows,month){
    month = month || state.month || todayISO().slice(0,7);
    const normalized=dedup((rows||[]).map(o=>normalizeOrder(o,"flex")))
      .filter(o=>o.is_flex)
      .filter(o=>isFlexProjeto(o))
      .filter(o=>!o.is_delivered)
      .filter(o=>!month || flexMonthOf(o)===month || !flexMonthOf(o));
    if(!normalized.length) return {saved:false,total:0,month};
    const merged=dedup(normalized);
    try{
      localStorage.setItem(flexStorageKey(month), JSON.stringify({month, savedAt:new Date().toISOString(), rows:merged}));
      return {saved:true,total:merged.length,month};
    }catch(e){
      console.warn("V8.6: falha ao armazenar Flex local", e);
      return {saved:false,total:merged.length,month,error:e.message};
    }
  }
  function flexStoredMonths(){
    const out=[];
    for(let i=0;i<localStorage.length;i++){
      const k=localStorage.key(i);
      if(k && k.startsWith(FLEX_STORE_PREFIX)) out.push(k.replace(FLEX_STORE_PREFIX,""));
    }
    return out.sort().reverse();
  }
  function monthLabel(ym){
    const [y,m]=String(ym||"").split("-");
    if(!y||!m) return ym || "sem mês";
    const d=new Date(Number(y), Number(m)-1, 1);
    return d.toLocaleDateString("pt-BR",{month:"long",year:"numeric"});
  }
  function groupByMonth(list){
    const map={};
    (list||[]).forEach(o=>{
      const m=flexMonthOf(o) || "sem-mes";
      if(!map[m]) map[m]={month:m,count:0,value:0,coords:0,semCoords:0,contas:{}};
      map[m].count++;
      map[m].value += value(o);
      if(coords(o)) map[m].coords++; else map[m].semCoords++;
      const c=txt(pick(o,["conta","loja","store_name"]))||"Sem conta";
      map[m].contas[c]=(map[m].contas[c]||0)+1;
    });
    return Object.values(map).sort((a,b)=>String(a.month).localeCompare(String(b.month)));
  }
  function flexArchiveAll(){
    const current=dedup(state.flex||[]);
    const stored=flexStoredMonths().flatMap(m=>readStoredFlex(m));
    return dedup(current.concat(stored)).filter(o=>o.is_flex && isFlexProjeto(o) && !o.is_delivered);
  }


  
  function firebaseRestPath(path){
    const db=firebaseDbUrl();
    if(!db) return "";
    return db + "/" + String(path||"").replace(/^\/+/,"").replace(/\.json$/,"") + ".json";
  }
  async function firebaseFetchJson(path, opts={}, timeout=4500){
    const url=firebaseRestPath(path);
    if(!url) throw new Error("Firebase não configurado");
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(), timeout);
    try{
      const res=await fetch(url, Object.assign({cache:"no-store", signal:ctrl.signal}, opts));
      clearTimeout(timer);
      if(!res.ok) throw new Error("Firebase HTTP " + res.status);
      return await res.json();
    }catch(e){
      clearTimeout(timer);
      throw e;
    }
  }
  async function firebaseGet(path, timeout=4500){
    return firebaseFetchJson(path, {}, timeout);
  }
  async function firebasePut(path, data, timeout=6500){
    return firebaseFetchJson(path, {
      method:"PUT",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(data)
    }, timeout);
  }
  async function firebasePatch(path, data, timeout=6500){
    return firebaseFetchJson(path, {
      method:"PATCH",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(data)
    }, timeout);
  }
  function firebaseCacheKey(){
    const root = String(window.VESCO_FIREBASE_ROOT || "vesco_operacao_v2").replace(/^\/+|\/+$/g,"");
    return root + "/months/" + state.month;
  }
  function localSnapshotKey(){
    return "vesco:v102:snapshot:" + state.date + ":" + state.month;
  }
  function snapshotFromState(){
    return {
      version:"V10.38-PLANILHA-INSTANTANEA-SEPARACAO",
      date:state.date,
      month:state.month,
      updated_at:new Date().toISOString(),
      orders:state.orders||[],
      flex:state.flex||[],
      rotas:state.rotas||[],
      deliveredExternal:state.deliveredExternal||[]
    };
  }
  function saveLocalSnapshot(snap){
    try{ localStorage.setItem(localSnapshotKey(), JSON.stringify(snap)); }catch(e){}
  }
  function loadLocalSnapshot(){
    try{
      const raw=localStorage.getItem(localSnapshotKey());
      if(!raw) return null;
      const snap=JSON.parse(raw);
      return snap && (Array.isArray(snap.orders)||Array.isArray(snap.flex)||Array.isArray(snap.rotas)) ? snap : null;
    }catch(e){ return null; }
  }
  function mergeOrderPatchPreserveMaster(master, patch){
    // V10.32: Firebase de pendência/separação pode vir sem endereço.
    // O patch atualiza status/operador, mas não pode apagar endereço, cliente, pagamento e valor do pedido mestre.
    const base=master||{};
    const p=patch||{};
    const merged=Object.assign({}, base, p);

    if(hasAddress(base) && !hasAddress(merged)){
      const a=address(base);
      merged.endereco_completo=a;
      merged.endereco=a;
      merged.address=a;
    }
    if(client(base) && !client(merged)){
      merged.cliente_nome=client(base);
      merged.cliente=client(base);
    }
    if(pagamentoText(base) && !pagamentoText(merged)){
      merged.forma_pagamento=pagamentoText(base);
      merged.pagamento=pagamentoText(base);
    }
    if(formaText(base) && !formaText(merged)){
      merged.forma_envio=formaText(base);
      merged.forma_envio_nome=formaText(base);
    }
    if(value(base) && !value(merged)){
      merged.valor=value(base);
      merged.valor_num=value(base);
    }

    return merged;
  }

  function applyOrderPatchesFromFirebase(orders, patches){
    if(!patches || typeof patches!=="object") return removeGhostFirebaseRows(orders||[]);
    const patchKeys=Object.keys(patches);
    const out=(orders||[]).map(o=>{
      const vals=[orderKey(o),number(o),ecom(o),o.id,o.id_tiny,o.numero,o.numero_ecommerce,o.pedido_key,o.pedido,o.pedido_id]
        .map(txt).filter(Boolean);
      const patchKey=patchKeys.find(k=>vals.some(v=>firebaseSafeId(v)===k || v===k || firebaseSafeId(k)===firebaseSafeId(v)));
      return patchKey ? normalizeOrder(mergeOrderPatchPreserveMaster(o, patches[patchKey]), o.__v8source||"erp") : o;
    });

    // V10.43: NÃO cria mais linha mínima "Pedido atualizado no Firebase".
    // Firebase só atualiza pedido que já veio da planilha/API. Isso elimina pedidos nada a ver e deixa a tela fluida.
    return removeGhostFirebaseRows(out);
  }

  function normalizeExternalDelivery(row){
    const r=row||{};
    const pedido=txt(pick(r,["pedido_numero","pedido_num","pedido","numero","num","pedido_id","id","id_tiny"]));
    const recebedor=txt(pick(r,["recebedor","nome_recebedor","recebido_por","quem_recebeu"]));
    const ts=pick(r,["ts","timestamp","data","data_entrega","data_entrega_realizada","entregue_em","updated_at"]);
    const base=normalizeOrder(Object.assign({}, r, {
      id: pick(r,["pedido_id","id","id_tiny"]) || pedido,
      numero: pedido,
      pedido: pedido,
      cliente_nome: pick(r,["cliente_nome","cliente","destinatario"]) || pick(r,["nome"]),
      status_logistica:"Retirado",
      situacao_nome:"Retirado",
      is_delivered:true,
      data_entrega_realizada: parseISO(ts) || state.date,
      entregue_em: ts || new Date().toISOString(),
      recebedor,
      nome_recebedor:recebedor,
      doc_recebedor:pick(r,["documento","doc_recebedor","documento_retirada"]),
      transportador:pick(r,["transportador","motorista","operador_origem"]),
      observacao:pick(r,["observacao","obs"])
    }), "erp");
    base.__externalDelivered=true;
    return base;
  }
  function normalizeExternalDeliveries(rows){
    return dedup((rows||[]).map(normalizeExternalDelivery).filter(o=>number(o)||orderKey(o)||ecom(o)));
  }
  function externalDeliveredFromPayload(payload){
    if(!payload) return [];
    const rows=extractArray(payload,[
      "entregues","entregas","comprovantes","comprovantesMotorista","comprovantes_motorista",
      "entreguesMotorista","motoristaEntregues","comprovantes_entrega","delivered","data"
    ]);
    return normalizeExternalDeliveries(rows);
  }

  function deliveredFromFirebaseRoutesObj(routesObj){
    const out=[];
    const obj=routesObj||{};
    Object.keys(obj).forEach(routeKey=>{
      const r=obj[routeKey]||{};
      const entregas=r.entregas||{};
      Object.keys(entregas).forEach(entKey=>{
        const ent=entregas[entKey]||{};
        const stop=(routeStops(r)||[]).find(s=>{
          const vals=[s?.pedido,s?.numero,s?.id,s?.ecom,s?.numero_ecommerce].map(txt).filter(Boolean).map(firebaseSafeId);
          return vals.includes(firebaseSafeId(entKey)) || vals.includes(firebaseSafeId(ent.pedido));
        }) || {};
        const motorista=r.motorista || ent.motorista || ent.transportador || "";
        out.push(Object.assign({}, stop, ent, {
          rota_id: r.rota_id || r.id || routeKey,
          nome_rota: r.nome_rota || r.nome || "",
          motorista,
          __rota_motorista:motorista,
          __rota_nome:r.nome_rota || r.nome || "",
          entregue_por: ent.entregue_por || ent.operador_entrega || ent.operador || motorista || "",
          operador_entrega: ent.operador_entrega || ent.operador || motorista || "",
          finalizado_por: ent.finalizado_por || ent.entregue_por || ent.operador_entrega || motorista || "",
          pedido_numero: ent.pedido || stop.pedido || stop.numero || entKey,
          pedido_id: ent.pedido || stop.id || entKey,
          cliente_nome: stop.cliente || stop.cliente_nome || ent.cliente || "",
          endereco_completo: stop.endereco || stop.endereco_completo || "",
          status:"Entregue",
          status_logistica:"Entregue",
          tipo_finalizacao:"Entrega",
          is_delivered:true,
          data_entrega_realizada: ent.data_entrega_realizada || parseISO(ent.entregue_em) || parseISO(ent.updated_at) || state.date
        }));
      });
    });
    return normalizeExternalDeliveries(out);
  }
  async function loadDeliveredFromFirebaseRoutes(){
    try{
      const routesObj=await firebaseGet("vesco_rotas_motorista", 4500);
      const rows=deliveredFromFirebaseRoutesObj(routesObj||{});
      if(rows.length){
        const merged=dedup([...(state.deliveredExternal||[]), ...rows]);
        state.deliveredExternal=merged;
        return rows;
      }
    }catch(e){
      console.warn("V10.43: não puxou entregues diretos do Firebase.", e.message||e);
    }
    return [];
  }
  async function refreshEntreguesAgora(){
    showLoading(true);
    let rows=[];
    try{
      rows=await loadDeliveredFromFirebaseRoutes();
      const actions=[
        "listarComprovantesMotorista","comprovantesMotorista","listarEntreguesMotorista","entreguesMotorista",
        "listarEntregues","listarComprovantes","entregues"
      ];
      for(const action of actions){
        try{
          const ep=await jsonp(API_MAIN,{action,dataISO:state.date,mes:state.month},8000);
          const r=externalDeliveredFromPayload(ep);
          if(r.length){
            rows=dedup(rows.concat(r));
            state.deliveredExternal=dedup([...(state.deliveredExternal||[]),...r]);
            break;
          }
        }catch(e){}
      }
      saveLocalSnapshot(snapshotFromState());
      await saveFirebaseSnapshot(snapshotFromState());
    }finally{
      showLoading(false);
      render();
    }
    return rows;
  }
  function orderIdentifierSet(o){
    return [orderKey(o),number(o),ecom(o),o?.id,o?.id_tiny,o?.numero,o?.numero_ecommerce,o?.pedido_key,o?.pedido,o?.pedido_id]
      .map(txt).filter(Boolean);
  }
  function routeAssignedKeySet(){
    const set=new Set();
    (state.rotas||[]).forEach(r=>{
      routePedidos(r).forEach(k=>{ if(txt(k)) set.add(firebaseSafeId(k)); });
      routeStops(r).forEach(stop=>{
        [stop?.pedido,stop?.numero,stop?.id,stop?.pedido_id,stop?.ecom,stop?.numero_ecommerce]
          .map(txt).filter(Boolean).forEach(k=>set.add(firebaseSafeId(k)));
      });
    });
    return set;
  }
  function isOrderInAnyActiveRoute(o){
    if(isDelivered(o)) return false;
    const assigned=routeAssignedKeySet();
    return orderIdentifierSet(o).some(k=>assigned.has(firebaseSafeId(k)));
  }
  async function getOrderPatchesFirebase(force=false){
    const now=Date.now();
    if(!force && state.orderPatchesCache && now-Number(state.orderPatchesCacheAt||0)<VESCO_PATCH_CACHE_MS){
      return state.orderPatchesCache;
    }
    try{
      const rows=await firebaseGet("vesco_operacao/orders", 2200) || {};
      state.orderPatchesCache=rows;
      state.orderPatchesCacheAt=Date.now();
      return rows;
    }catch(e){
      return state.orderPatchesCache || {};
    }
  }
  async function applySnapshot(snap, source){
    if(!snap) return false;
    const patches=await getOrderPatchesFirebase();
    let orders=cleanOperationalOrders((snap.orders||snap.pedidos||snap.rows||snap.data||[]).map(o=>normalizeOrder(o,"erp")).filter(o=>!o.is_flex));
    orders=applyOrderPatchesFromFirebase(orders, patches);
    const snapFlexRaw = Array.isArray(snap.flex) ? snap.flex : [];
    let flex=snapFlexRaw.map(o=>normalizeOrder(o,"flex")).filter(o=>o.is_flex && isFlexProjeto(o) && !o.is_delivered);
    if(!snapFlexRaw.length && Array.isArray(state.flex) && state.flex.length){
      flex = state.flex;
    }
    let rotas=mergeRotas(Array.isArray(snap.rotas)?snap.rotas:[]);
    let deliveredExternal=normalizeExternalDeliveries(snap.deliveredExternal || snap.entregues || snap.comprovantes || snap.comprovantesMotorista || []);
    state.orders=cleanOperationalOrders(removeGhostFirebaseRows(dedup(orders)).filter(o=>!o.is_flex));
    state.hasSnapshotSeparadosHoje=Array.isArray(snap.separadosHoje) || Array.isArray(snap.historicoSeparacao);
    state.snapshotSeparadosHoje=(Array.isArray(snap.separadosHoje)?snap.separadosHoje:(Array.isArray(snap.historicoSeparacao)?snap.historicoSeparacao:[]))
      .map(o=>normalizeOrder(o,"erp"))
      .map(enrichSeparatedWithMaster);
    state.hasSnapshotEntreguesHoje=Array.isArray(snap.entregues);
    state.snapshotEntreguesHoje=(Array.isArray(snap.entregues)?snap.entregues:[]).map(o=>normalizeOrder(o,"erp"));
    state.flex=dedup(flex).filter(o=>o.is_flex && isFlexProjeto(o) && !o.is_delivered);
    state.rotas=rotas;
    state.deliveredExternal=deliveredExternal.length ? deliveredExternal : (state.deliveredExternal||[]);
    state.loaded=true;
    state.lastSnapshotSource=source||"snapshot";
    state.loading=false;
    showLoading(false);
    invalidatePerfCaches();
    updateBadges();
    return true;
  }
  async function loadFirebaseSnapshot(){
    // V10.43: primeiro lê o snapshot salvo pelo vesco-worker v2.1.x.
    // Caminho real salvo pelo worker: vesco_operacao_v2/months/YYYY-MM e vesco_operacao_v2/latest.
    const root = String(window.VESCO_FIREBASE_ROOT || "vesco_operacao_v2").replace(/^\/+|\/+$/g,"");

    const paths = [
      root + "/months/" + state.month,
      root + "/latest",
      "vesco_cache/painel_lite/months/" + state.month,
      "vesco_cache/painel/latest_lite",
      "vesco_cache/painel/latest"
    ];

    for (const p of paths) {
      try {
        const snap = await firebaseGet(p, 3500);
        if (snap && (Array.isArray(snap.orders) || Array.isArray(snap.pedidos) || Array.isArray(snap.rows) || Array.isArray(snap.data))) {
          return snap;
        }
      } catch(e) {}
    }

    return null;
  }
  async function saveFirebaseSnapshot(snap){
    if(!snap) return;
    saveLocalSnapshot(snap);
    const root = String(window.VESCO_FIREBASE_ROOT || "vesco_operacao_v2").replace(/^\/+|\/+$/g,"");
    try{ await firebasePut(root + "/months/" + state.month, snap, 6500); }catch(e){ console.warn("V10.43: não salvou snapshot root por mês.", e.message||e); }
    try{ await firebasePut(root + "/latest", snap, 6500); }catch(e){ console.warn("V10.43: não salvou snapshot root latest.", e.message||e); }
    try{ await firebasePut("vesco_cache/painel_lite/months/" + state.month, snap, 6500); }catch(e){}
    try{ await firebasePut("vesco_cache/painel/latest_lite", snap, 6500); }catch(e){}
  }
  async function fetchEasyPanelJson(path, timeout=12000){
    if(!EASYPANEL_URL) throw new Error("EasyPanel URL não configurada");
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(), timeout);
    try{
      const url = EASYPANEL_URL + path;
      const res=await fetch(url, {signal:ctrl.signal, cache:"no-store"});
      const len=Number(res.headers.get("content-length")||0);
      if(len && len>2200000) throw new Error("Resposta muito grande bloqueada no frontend ("+Math.round(len/1024)+" KB). Use /snapshot-lite.");
      const txtBody=await res.text();
      if(txtBody.length>2200000) throw new Error("Resposta muito grande bloqueada no frontend. Use /snapshot-lite.");
      let data=null;
      try{ data=txtBody ? JSON.parse(txtBody) : null; }
      catch(e){ throw new Error("EasyPanel retornou inválido: " + txtBody.slice(0,160)); }
      if(!res.ok) throw new Error((data && (data.error||data.message)) || ("EasyPanel HTTP " + res.status));
      return data;
    }finally{
      clearTimeout(timer);
    }
  }
  async function loadEasyPanelSnapshot(){
    try{
      const path = "/snapshot-lite?month=" + encodeURIComponent(state.month) + "&mes=" + encodeURIComponent(state.month) + "&_ts=" + Date.now();
      const data=await fetchEasyPanelJson(path, 9000);
      if(data && (Array.isArray(data.orders)||Array.isArray(data.pedidos)||Array.isArray(data.rows)||Array.isArray(data.data))){
        data.__easyPanelSnapshot=true;
        return data;
      }
    }catch(e){
      console.warn("V10.43: EasyPanel snapshot-lite indisponível; usando Firebase/local.", e.message||e);
    }
    return null;
  }
  async function triggerEasyPanelSync(){
    if(!EASYPANEL_SECRET){
      console.warn("V10.43: secret do EasyPanel vazio. Atualizar vai apenas reler worker/Firebase/cache.");
      return {success:false, skipped:true, reason:"secret_empty"};
    }
    const path="/sync?secret=" + encodeURIComponent(EASYPANEL_SECRET);
    try{
      return await fetchEasyPanelJson(path, 90000);
    }catch(e){
      console.warn("V10.43: sync EasyPanel falhou; mantendo cache.", e.message||e);
      return {success:false, error:e.message||String(e)};
    }
  }

  async function loadPlanilhaBridgeSnapshot(){
    // V10.43: primeiro endpoint do worker que lê a aba Pedidos via Apps Script Bridge.
    const workerPaths = [
      "/planilha-pedidos?month=" + encodeURIComponent(state.month) + "&mes=" + encodeURIComponent(state.month) + "&_ts=" + Date.now(),
      "/snapshot-lite?month=" + encodeURIComponent(state.month) + "&mes=" + encodeURIComponent(state.month) + "&_ts=" + Date.now()
    ];

    for(const path of workerPaths){
      try{
        const data = await fetchEasyPanelJson(path, 9000);
        const rows = extractArray(data,["pedidos","orders","rows","data"]);
        if(rows && rows.length){
          return {
            success:true,
            source:path.includes("planilha-pedidos") ? "worker_planilha_pedidos" : "worker_snapshot_lite",
            version:data.version || "V10.43-WORKER-PLANILHA",
            month: state.month,
            orders: rows,
            pedidos: rows,
            rows: rows,
            data: rows,
            counts: data.counts || {pedidos: rows.length},
            updated_at: data.updated_at || data.updatedAt || new Date().toISOString(),
            raw: data
          };
        }
        console.warn("V10.43: worker respondeu sem pedidos em", path, data);
      }catch(e){
        console.warn("V10.43: worker indisponível em", path, e.message||e);
      }
    }

    try{
      const fbSnap = await loadFirebaseSnapshot();
      const fbRows = extractArray(fbSnap,["pedidos","orders","rows","data"]);
      if(fbRows && fbRows.length){
        return {
          success:true,
          source:"firebase_worker_root",
          version:"V10.41-FIREBASE-WORKER",
          month: state.month,
          orders: fbRows,
          pedidos: fbRows,
          rows: fbRows,
          data: fbRows,
          counts: fbSnap.counts || {pedidos: fbRows.length},
          updated_at: fbSnap.updated_at || fbSnap.updatedAt || new Date().toISOString(),
          raw: fbSnap
        };
      }
    }catch(e){
      console.warn("V10.43: Firebase root ainda sem pedidos.", e.message||e);
    }

    return null;
  }

  function v1038PlanilhaHash(rows){
    // V10.43: hash estável. Não usa updated_at/ultima_sincronizacao,
    // porque esses campos mudam a cada sync e faziam o painel renderizar sem parar.
    rows = Array.isArray(rows) ? rows : [];
    return rows.length + "|" + rows.slice(0, 500).map(o=>[
      pick(o,["pedido_key","id","id_tiny"]),
      number(o),
      statusAll(o),
      pick(o,["tipo_entrega","transportadora","forma_envio_nome","forma_envio"]),
      pick(o,["cliente_nome","cliente","customer"]),
      pick(o,["data_pedido","data_prevista"]),
      pick(o,["valor","total_pedido"])
    ].map(txt).join(":")) .join("|");
  }

  let v1038PlanilhaLastHash = "";
  let v1038PlanilhaPollTimer = null;
  let v1038PlanilhaPollBusy = false;

  async function refreshPlanilhaInstantanea(renderAfter=true){
    if(v1038PlanilhaPollBusy) return false;
    v1038PlanilhaPollBusy = true;
    try{
      const snap = await loadPlanilhaBridgeSnapshot();
      if(!snap) return false;
      const rows = extractArray(snap,["pedidos","orders","rows","data"]);
      const h = v1038PlanilhaHash(rows);
      // Evita reaplicar, poucos segundos após o boot, o mesmo snapshot que já está na memória.
      const currentHash = state.loaded && state.orders?.length ? v1038PlanilhaHash(state.orders) : "";
      if(h && (h===v1038PlanilhaLastHash || h===currentHash)){
        v1038PlanilhaLastHash=h;
        return false;
      }
      const mustApply = !state.loaded || !state.orders.length || h !== v1038PlanilhaLastHash;
      if(!mustApply) return false;
      v1038PlanilhaLastHash = h;
      const ok = await applySnapshot(snap,"planilha_instantanea");
      if(ok && renderAfter){
        const doRender=()=>{
          const wait=Math.max(0,Number(state.userNavigatingUntil||0)-Date.now());
          if(wait>0) setTimeout(()=>scheduleRender(),wait+30);
          else scheduleRender();
        };
        if("requestIdleCallback" in window) requestIdleCallback(doRender,{timeout:700});
        else requestAnimationFrame(doRender);
      }
      return ok;
    }catch(e){
      console.warn("V10.43: leitura instantânea worker/planilha falhou.", e.message||e);
      return false;
    }finally{
      v1038PlanilhaPollBusy = false;
    }
  }

  function startPlanilhaInstantaneaPolling(){
    if(v1038PlanilhaPollTimer) return;
    const mobileRuntime=window.matchMedia && window.matchMedia("(max-width: 899px), (max-height: 640px) and (max-width: 1100px)").matches;
    const configured=Number(window.VESCO_PLANILHA_POLL_MS || (mobileRuntime?60000:8000));
    const normalMs=mobileRuntime?Math.max(45000,configured):Math.max(6000,configured);
    const fastMs=mobileRuntime?8000:2200;
    const scheduleNext=(ms)=>{ clearTimeout(v1038PlanilhaPollTimer); v1038PlanilhaPollTimer=setTimeout(tick,ms); };
    const tick=async()=>{
      const navigating=Date.now()<Number(state.userNavigatingUntil||0) || document.body.classList.contains("v1051-nav-busy");
      if(document.hidden || state.loading || navigating){ scheduleNext(normalMs); return; }
      try{ await refreshPlanilhaInstantanea(true); }
      finally{
        const next=(window.__vescoFastPollUntil && Date.now()<window.__vescoFastPollUntil)?fastMs:normalMs;
        scheduleNext(next);
      }
    };
    scheduleNext(normalMs);
    console.log("V10.56: polling adaptativo ativo —",mobileRuntime?"mobile leve":"desktop","normal",normalMs,"ms; rápido",fastMs,"ms.");
  }

  async function refreshFromEasyPanel(forceSync=false){
    let syncResult=null;
    if(forceSync){
      syncResult=await triggerEasyPanelSync();
    }

    let snap=await loadEasyPanelSnapshot();

    if(!snap){
      try{ snap=await firebaseGet("vesco_cache/painel/latest", 5000); }
      catch(e){}
    }

    if(snap){
      const ok=await applySnapshot(snap,"easypanel");
      if(ok){
        state.easyPanelStatus={
          updated_at:snap.updated_at || "",
          partial:!!snap.partial,
          blockedAccounts:snap.blockedAccounts||[],
          counts:snap.counts||{},
          syncResult
        };
        saveLocalSnapshot(snap);
        scheduleRender();
        return true;
      }
    }

    return false;
  }

  async function firebasePatchOrder(id, patch){
    const all=[...(state.orders||[]),...(state.flex||[])];
    const key=firebaseSafeId(id);
    const target=all.find(o=>{
      const vals=[orderKey(o),number(o),ecom(o),o.id,o.id_tiny,o.numero,o.numero_ecommerce,o.pedido_key].map(txt).filter(Boolean);
      return vals.some(v=>v===txt(id) || firebaseSafeId(v)===key);
    });
    const payload=Object.assign({}, patch||{}, {
      updated_at:new Date().toISOString(),
      id: target ? (target.id || txt(id)) : txt(id),
      numero: target ? (number(target) || txt(id)) : (patch && (patch.numero || patch.pedido || patch.pedido_numero)) || txt(id),
      pedido: target ? (number(target) || txt(id)) : (patch && (patch.pedido || patch.numero || patch.pedido_numero)) || txt(id),
      pedido_key: target ? (orderKey(target) || txt(id)) : txt(id),
      id_tiny: target ? (target.id_tiny || "") : "",
      numero_ecommerce: target ? (ecom(target) || "") : "",
      cliente_nome: target ? client(target) : (patch && (patch.cliente_nome || patch.cliente)) || ""
    });
    const keys=[txt(id)];
    if(target){
      keys.push(orderKey(target),number(target),ecom(target),target.id,target.id_tiny,target.numero,target.numero_ecommerce,target.pedido_key,target.pedido);
    }

    // V10.43: grava em todos os identificadores possíveis para todos os operadores receberem instantaneamente.
    const uniqueKeys=[...new Set(keys.map(txt).filter(Boolean).map(firebaseSafeId))];
    for(const k of uniqueKeys){
      try{ await firebasePatch("vesco_operacao/orders/" + k, payload, 6500); }
      catch(e){ console.warn("V10.43: patch Firebase falhou em", k, e.message||e); }
    }

    all.forEach(o=>{
      const vals=[orderKey(o),number(o),ecom(o),o.id,o.id_tiny,o.numero,o.numero_ecommerce,o.pedido_key].map(txt).filter(Boolean);
      if(vals.some(v=>uniqueKeys.includes(firebaseSafeId(v)))) Object.assign(o,payload);
    });
    invalidatePerfCaches();
    saveLocalSnapshot(snapshotFromState());
    return payload;
  }
  async function refreshFromAppsScriptBackground(){
    let orders=[];
    let flex=[];
    let rotas=[];
    let deliveredExternal=[];
    let gotAnything=false;

    try{
      const main=await jsonp(API_MAIN,{action:"loadVesco",dataISO:state.date,mes:state.month},15000);
      state.lastPayload=main;
      const apiOrders=extractArray(main,["pedidos","orders","rows","data"]).map(o=>normalizeOrder(o,"erp"));
      const apiDelivered=externalDeliveredFromPayload(main);
      if(apiDelivered.length){
        deliveredExternal=apiDelivered;
        gotAnything=true;
      }
      if(apiOrders.length){
        orders=apiOrders.filter(o=>!o.is_flex);
        gotAnything=true;
      }
    }catch(e){
      console.warn("V10.43: Apps Script ERP lento/indisponível; Firebase mantém UI.", e.message);
    }

    try{
      const fp=await jsonp(API_FLEX,{action:"enviosFlex",dataISO:state.date,mes:state.month,allFlex:"1"},20000);
      state.lastFlexPayload=fp;
      const apiFlex=extractArray(fp,["flex","flexOrders","enviosFlex","data","rows"]).map(o=>normalizeOrder(o,"flex"));
      state.lastFlexRawCount=apiFlex.length;
      const accepted=apiFlex.filter(o=>!o.is_delivered && o.is_flex && isFlexProjeto(o));
      state.lastFlexAcceptedCount=accepted.length;
      if(apiFlex.length){
        flex=accepted;
        gotAnything=true;
        saveStoredFlex(flex, state.month);
      }
    }catch(e){
      console.warn("V10.43: Apps Script Flex lento/indisponível; Firebase mantém UI.", e.message);
    }

    try{
      const rp=await jsonp(API_MAIN,{action:"listarRotasMotorista",dataISO:state.date},10000);
      rotas=extractArray(rp,["rotas","data","rows"]);
      if(rotas.length) gotAnything=true;
    }catch(e){
      console.warn("V10.43: rotas Apps Script lento/indisponível; Firebase/local mantém UI.", e.message);
    }

    if(!deliveredExternal.length){
      const fbDelivered=await loadDeliveredFromFirebaseRoutes();
      if(fbDelivered.length){
        deliveredExternal=fbDelivered;
        gotAnything=true;
      }
    }

    if(!deliveredExternal.length){
      const actions=["listarComprovantesMotorista","comprovantesMotorista","listarEntreguesMotorista","entreguesMotorista","listarEntregues","listarComprovantes","entregues"];
      for(const action of actions){
        try{
          const ep=await jsonp(API_MAIN,{action,dataISO:state.date,mes:state.month},8000);
          const rows=externalDeliveredFromPayload(ep);
          if(rows.length){
            deliveredExternal=rows;
            gotAnything=true;
            break;
          }
        }catch(e){}
      }
    }

    if(!gotAnything) return false;

    if(!orders.length && state.orders.length) orders=state.orders;
    if(!flex.length && state.flex.length) flex=state.flex;
    rotas=mergeRotas(rotas.length?rotas:state.rotas);

    const patches=await getOrderPatchesFirebase();
    orders=applyOrderPatchesFromFirebase(orders, patches);

    state.orders=removeGhostFirebaseRows(dedup(orders)).filter(o=>!o.is_flex);
    state.flex=dedup(flex).filter(o=>o.is_flex && isFlexProjeto(o) && !o.is_delivered);
    state.rotas=rotas;
    state.loaded=true;
    state.loading=false;
    showLoading(false);
    invalidatePerfCaches();
    updateBadges();

    const snap=snapshotFromState();
    await saveFirebaseSnapshot(snap);

    scheduleRender();
    return true;
  }

  async function refreshFlexFromWorker(showAlert=false){
    try{
      const url = EASYPANEL_URL + "/flex-pedidos?month=" + encodeURIComponent(state.month) + "&mes=" + encodeURIComponent(state.month) + "&_ts=" + Date.now();
      const data = await fetchEasyPanelJson(url.replace(EASYPANEL_URL,""), 45000);
      const apiFlex = extractArray(data,["flex","flexOrders","enviosFlex","data","rows"]).map(o=>normalizeOrder(o,"flex"));
      state.lastFlexPayload=data;
      state.lastFlexDiagnostics=data && data.diagnostics ? data.diagnostics : null;
      state.lastFlexRawCount=apiFlex.length;
      const accepted=apiFlex.filter(o=>!o.is_delivered && o.is_flex && isFlexProjeto(o));
      state.lastFlexAcceptedCount=accepted.length;
      if(accepted.length){ state.flex=dedup(accepted); invalidatePerfCaches(); saveStoredFlex(state.flex,state.month); if(showAlert) alert(`Flex atualizado pelo worker: ${accepted.length} pedido(s).`); return true; }
      return false;
    }catch(e){ console.warn("V10.47: worker /flex-pedidos indisponível; tentando API Flex antiga.", e.message||e); return false; }
  }

  async function refreshFlexFromAppsScriptOnly(showAlert=false){
    // V10.47: primeiro tenta o worker /flex-pedidos, que usa a regra da planilha sem gastar UrlFetch no Apps Script.
    if(await refreshFlexFromWorker(showAlert)) return true;
    try{
      const fp=await jsonp(API_FLEX,{action:"enviosFlex",dataISO:state.date,mes:state.month,allFlex:"1"},60000);
      state.lastFlexPayload=fp;
      const apiFlex=extractArray(fp,["flex","flexOrders","enviosFlex","data","rows"]).map(o=>normalizeOrder(o,"flex"));
      state.lastFlexRawCount=apiFlex.length;
      const accepted=apiFlex.filter(o=>!o.is_delivered && o.is_flex && isFlexProjeto(o));
      state.lastFlexAcceptedCount=accepted.length;
      if(accepted.length){
        state.flex=dedup(accepted);
        invalidatePerfCaches();
        saveStoredFlex(state.flex,state.month);
        saveLocalSnapshot(snapshotFromState());
        saveFirebaseSnapshot(snapshotFromState()).catch(()=>null);
      }
      if(showAlert){
        alert(accepted.length?`Flex atualizado: ${accepted.length} pedido(s).`:`Flex consultado, mas nenhum pedido validado para ${monthLabel(state.month)}.`);
      }
      updateBadges();
      return accepted;
    }catch(e){
      console.warn("V10.31: falha ao atualizar Flex direto pela API Flex.", e.message||e);
      if(showAlert) alert("Não consegui atualizar Flex agora: " + (e.message||e));
      return [];
    }
  }


async function loadData(force=false){
    if(state.loading) return false;
    state.loading=true;
    const firstBoot=!state.loaded;
    if(firstBoot) showLoading(true);
    document.body.classList.toggle("v1050-refreshing",!!force);

    try{
      if(force){
        // Atualização não bloqueante: dispara o sync e já relê ERP/Flex em paralelo.
        triggerEasyPanelSync().catch(()=>null);
        const [snapPlanilha] = await Promise.all([
          loadPlanilhaBridgeSnapshot().catch(()=>null),
          refreshFlexFromAppsScriptOnly(false).catch(()=>null)
        ]);
        if(snapPlanilha){
          await applySnapshot(snapPlanilha,"planilha_bridge_force");
          v1038PlanilhaLastHash=v1038PlanilhaHash(extractArray(snapPlanilha,["pedidos","orders","rows","data"]));
        }else{
          const snapEasy=await loadEasyPanelSnapshot().catch(()=>null);
          if(snapEasy) await applySnapshot(snapEasy,"easypanel_force");
        }
        const mobileRuntime=window.matchMedia && window.matchMedia("(max-width: 899px), (max-height: 640px) and (max-width: 1100px)").matches;
        const followUps=mobileRuntime?[6000,15000]:[1200,3200,7000];
        followUps.forEach(ms=>setTimeout(()=>refreshPlanilhaInstantanea(true),ms));
        return true;
      }

      let quickLoaded=false;
      const snapPlanilha=await loadPlanilhaBridgeSnapshot().catch(()=>null);
      if(snapPlanilha){
        quickLoaded=await applySnapshot(snapPlanilha,"planilha_bridge");
        if(quickLoaded){
          v1038PlanilhaLastHash=v1038PlanilhaHash(extractArray(snapPlanilha,["pedidos","orders","rows","data"]));
        }
      }

      if(!quickLoaded){
        const snapEasy=await loadEasyPanelSnapshot().catch(()=>null);
        if(snapEasy) quickLoaded=await applySnapshot(snapEasy,"easypanel");
      }
      if(!quickLoaded){
        const snapFb=await loadFirebaseSnapshot().catch(()=>null);
        if(snapFb) quickLoaded=await applySnapshot(snapFb,"firebase");
        else{ const snapLocal=loadLocalSnapshot(); if(snapLocal) quickLoaded=await applySnapshot(snapLocal,"localStorage"); }
      }

      if(quickLoaded){
        // Não segura o boot esperando gravações de rede.
        saveFirebaseSnapshot(snapshotFromState()).catch(()=>null);
        setTimeout(async()=>{
          try{ const ok=await refreshFlexFromAppsScriptOnly(false); if(ok) scheduleRender(); }
          catch(e){ console.warn("V10.51: carga paralela do Flex falhou.",e.message||e); }
        },80);
        return true;
      }

      state.orders=state.orders||[]; state.flex=state.flex||[]; state.rotas=mergeRotas(state.rotas||[]); state.loaded=true;
      setTimeout(()=>refreshFromAppsScriptBackground(),100);
      return false;
    }finally{
      state.loading=false;
      showLoading(false);
      document.body.classList.remove("v1050-refreshing");
      updateBadges();
    }
  }

  function showLoading(show){ let el=document.getElementById("v8Loading"); if(!el){el=document.createElement("div"); el.id="v8Loading"; el.className="v8-loading"; el.innerHTML="<div>Carregando dados...</div>"; document.body.appendChild(el);} el.style.display=show?"grid":"none"; }

  function untilDate(o){
    // Usa data operacional/data do pedido para decidir se entra na fila.
    // Previsão de entrega futura não pode esconder pedido que já entrou hoje.
    const d=pullDate(o);
    return !d || d<=state.date;
  }
  function inMonth(o){ return (pullDate(o)||dueDate(o)||"").slice(0,7)===state.month; }
  
  function isLojaIntegradaFront(o){
    const id=txt(pick(o,["id_ecommerce","idEcommerce","id_ecommerce_psq","idEcommercePsq"]));
    const nome=norm(pick(o,["nome_ecommerce","nomeEcommerce","ecommerce","canal_origem"]));
    return id==="9578" || nome.includes("loja integrada");
  }
  function isErpMarkerFront(o){
    const id=txt(pick(o,["id_marcador","idMarcacaoPsq","id_marcacao"]));
    const nome=norm(pick(o,["nome_marcador","marcador"]));
    return id==="181672" || id==="181687" || nome.includes("vendas erp") || nome.includes("vescoplast") || nome.includes("vesco plast");
  }
  function isMarketplaceFront(o){
    if(isLojaIntegradaFront(o)) return false;
    const markerOk=isErpMarkerFront(o);
    const numEcom=txt(pick(o,["numero_ecommerce","numeroEcommerce","codigo_ecommerce","ecommerce_numero"]));
    const idEcom=txt(pick(o,["id_ecommerce","idEcommerce","id_ecommerce_psq","idEcommercePsq"]));
    const raw=[pick(o,["canal_origem","source","origem"]),pick(o,["nome_ecommerce","ecommerce","nomeEcommerce"]),numEcom,formaText(o),pick(o,["nome_marcador","marcador"]),pick(o,["json_tiny_resumo","raw_pesquisa","raw_detalhe"])].map(txt).join(" | ");
    const s=norm(raw);
    if((numEcom || idEcom) && !markerOk) return true;
    return ["mercado livre","mercadolivre","mercado envios","mercadoenvios","flex","full","fulfillment","shopee","amazon","magalu","magazine luiza","tiktok"].some(w=>s.includes(w)) && !markerOk;
  }
  function cleanOperationalOrders(list){ return (list||[]).filter(o=>!isCancelledOrderFront(o)).filter(o=>!isMarketplaceFront(o)); }

function logisticaList(){ return removeGhostFirebaseRows(dedup(state.orders)).filter(o=>!isCancelledOrderFront(o) && !isDelivered(o) && !isRetirada(o) && hasAddress(o) && untilDate(o)); }
  function flexList(){
    // V10.31: Flex continua vindo da API Flex validada.
    // Se o snapshot EasyPanel não trouxe Flex, usa também o mês armazenado localmente pela própria API Flex.
    const month = state.month || state.date.slice(0,7);
    return dedup([...(state.flex||[]), ...readStoredFlex(month)])
      .filter(o=>o.is_flex)
      .filter(o=>isFlexProjeto(o))
      .filter(o=>!o.is_delivered)
      .filter(o=>{
        const m=flexMonthOf(o);
        return !month || !m || m===month;
      });
  }

  function retiradaList(){ return removeGhostFirebaseRows(dedup(state.orders)).filter(o=>!isCancelledOrderFront(o) && !isDelivered(o) && (isRetirada(o) || !hasAddress(o)) && untilDate(o)); }
  function isFinalizadoNoDia(o){
    if(!isDelivered(o)) return false;
    const d=deliveryDate(o);
    if(d) return d===state.date;
    const upd=parseISO(pick(o,["updated_at","status_atualizado_em","atualizado_em","ultima_atualizacao_status"]));
    return upd===state.date;
  }
  function entreguesList(){
    // Entregues do ERP + rotas/Firebase + aba ComprovantesMotorista.
    // V10.43: pendência de produto não entra aqui, mesmo com updated_at.
    const noPend=o=>!hasPendenciaProduto(o) && !planilhaStatusVetaEntregue(o) && !norm(statusAll(o)).includes("pendencia") && !norm(statusAll(o)).includes("pendência");

    const erp=removeGhostFirebaseRows(dedup(state.orders)).filter(o=>!o.is_flex).filter(noPend).filter(isFinalizadoNoDia);

    const rotas=routeOrdersRows()
      .map(row=>Object.assign({}, row.order, {
        __rota_id:row.rota_id,
        __rota_nome:row.nome_rota,
        __rota_motorista:row.motorista,
        motorista:row.motorista || row.order?.motorista || row.order?.transportador || "",
        finalizado_por:row.order?.finalizado_por || row.order?.entregue_por || row.order?.operador_entrega || row.motorista || ""
      }))
      .filter(noPend)
      .filter(isFinalizadoNoDia);

    const externos=normalizeExternalDeliveries(state.deliveredExternal||[]).filter(noPend).filter(isFinalizadoNoDia);

    return dedup(erp.concat(rotas, externos));
  }

  function finalizadoPor(o){
    return txt(pick(o,[
      "finalizado_por","entregue_por","operador_entrega","operador_retirada",
      "operador_finalizacao","recebido_por_operador","motorista","__rota_motorista",
      "transportador","operador_ultima_alteracao","operador"
    ])) || "—";
  }
  function rotaFinalizacao(o){
    const rota=txt(pick(o,["__rota_nome","nome_rota","rota_nome","nomeRota","rota","rota_id","__rota_id"]));
    const mot=txt(pick(o,["__rota_motorista","motorista","transportador"]));
    if(rota && mot) return `${rota} • Motorista: ${mot}`;
    if(rota) return rota;
    if(mot) return `Motorista: ${mot}`;
    return "—";
  }

  function separadosList(){
    // V10.43: se o EasyPanel/Firebase mandou separadosHoje, ele é a fonte oficial.
    // Se veio vazio, a tela deve ficar vazia; não usa localStorage antigo.
    if(state.hasSnapshotSeparadosHoje){
      return cleanOperationalOrders(dedup(state.snapshotSeparadosHoje||[])).filter(o=>{
        const d=sepDate(o) || parseISO(pick(o,["data","dataISO","date"]));
        return d===state.date;
      });
    }
    return cleanOperationalOrders(removeGhostFirebaseRows(dedup(state.orders))).filter(o=>{
      const s=norm(statusAll(o));
      const finalStatus=s.includes("separado") || s.includes("pronto") || s.includes("despachado") || !!sepEndTime(o);
      return finalStatus && sepDate(o)===state.date;
    });
  }

  

  const TAREFAS_STORE_KEY="vesco:v8:tarefasFrota";
  function loadTarefas(){
    try{
      const rows=JSON.parse(localStorage.getItem(TAREFAS_STORE_KEY)||"[]");
      return Array.isArray(rows)?rows:[];
    }catch(e){ return []; }
  }
  function saveTarefas(){
    try{ localStorage.setItem(TAREFAS_STORE_KEY, JSON.stringify(state.tarefas||[])); }catch(e){ console.warn("Falha ao salvar tarefas frota",e); }
  }
  function tarefasFrotaList(){
    const date=state.date;
    return (state.tarefas||[]).filter(t=>!t.dataISO || t.dataISO===date);
  }
  function registrarTarefaFrota(){
    const tipo=txt(document.getElementById("v8TfTipo")?.value);
    const local=txt(document.getElementById("v8TfLocal")?.value);
    const endereco=txt(document.getElementById("v8TfEndereco")?.value);
    const motoristaHora=txt(document.getElementById("v8TfMotorista")?.value);
    if(!local && !endereco){ alert("Informe pelo menos local/empresa ou endereço."); return; }
    const item={id:"TF"+Date.now(), dataISO:state.date, tipo, local, endereco, motoristaHora, status:"Em andamento", criadoEm:new Date().toISOString()};
    state.tarefas.unshift(item);
    saveTarefas();
    renderTarefasFrota();
  }
  function concluirTarefaFrota(id){
    const t=(state.tarefas||[]).find(x=>x.id===id);
    if(t){ t.status="Concluída"; t.concluidoEm=new Date().toISOString(); saveTarefas(); renderTarefasFrota(); }
  }
  function removerTarefaFrota(id){
    if(!confirm("Remover esta tarefa externa?")) return;
    state.tarefas=(state.tarefas||[]).filter(t=>t.id!==id);
    saveTarefas();
    renderTarefasFrota();
  }
  function routeFlexExtras(){
    return dedup((state.rotaFlexExtras||[]).map(o=>normalizeOrder(o,"flex")).map(o=>({...o,__rotaSource:"Flex"})));
  }

  function masterOrderIndex(){
    if(state.masterOrderIndex && state.masterOrderIndexRevision===state.perfRevision) return state.masterOrderIndex;
    const index=new Map();
    (state.orders||[]).forEach(m=>{
      orderIdentifierSet(m).forEach(k=>{
        const safe=firebaseSafeId(k);
        if(safe && !index.has(safe)) index.set(safe,m);
      });
    });
    state.masterOrderIndex=index;
    state.masterOrderIndexRevision=state.perfRevision;
    return index;
  }
  function masterOrderFor(o){
    const index=masterOrderIndex();
    for(const k of orderIdentifierSet(o)){
      const found=index.get(firebaseSafeId(k));
      if(found) return found;
    }
    return null;
  }

  function enrichSeparatedWithMaster(o){
    // V10.32: registro de separação pode vir só com operador/status.
    // Junta com o pedido ERP original para trazer endereço real, cliente, pagamento e valor.
    const master=masterOrderFor(o);
    if(!master) return normalizeOrder(o,"erp");

    const merged=Object.assign({}, master, o);

    if(hasAddress(master) && !hasAddress(merged)){
      const a=address(master);
      merged.endereco_completo=a;
      merged.endereco=a;
      merged.address=a;
    }
    if(client(master) && !client(merged)){
      merged.cliente_nome=client(master);
      merged.cliente=client(master);
    }
    if(pagamentoText(master) && !pagamentoText(merged)){
      merged.forma_pagamento=pagamentoText(master);
      merged.pagamento=pagamentoText(master);
    }
    if(formaText(master) && !formaText(merged)){
      merged.forma_envio=formaText(master);
      merged.forma_envio_nome=formaText(master);
    }
    if(value(master) && !value(merged)){
      merged.valor=value(master);
      merged.valor_num=value(master);
    }

    // Status/operador de separação vencem o status do pedido mestre.
    merged.status_logistica=pick(o,["status_logistica","status","situacao","situacao_nome"]) || merged.status_logistica;
    return normalizeOrder(merged,"erp");
  }
  function routeReadyList(){
    const extras=routeFlexExtras();
    const routeSignature=(state.rotas||[]).map(r=>`${routeId(r)}:${routePedidosCount(r)}`).join("|");
    const cacheKey=[state.perfRevision,state.date,state.orders.length,state.flex.length,extras.length,routeSignature].join("|");
    if(state.routeReadyCache && state.routeReadyCacheKey===cacheKey) return state.routeReadyCache;
    // V10.43: pedido que já entrou em alguma rota ativa não aparece de novo para gerar rota.
    const assigned=routeAssignedKeySet();
    const notAssigned=o=>!orderIdentifierSet(o).some(k=>assigned.has(firebaseSafeId(k)));
    const pronto=derivedLists().pronto;
    const erp=removeGhostFirebaseRows(pronto).filter(notAssigned).map(o=>({...o,__rotaSource:"ERP"}));
    const flex=extras.filter(notAssigned);
    state.routeReadyCache=dedup(erp.concat(flex));
    state.routeReadyCacheKey=cacheKey;
    return state.routeReadyCache;
  }
  function findFlexForRoute(code){
    const clean=txt(code).replace(/^#/,"").trim();
    const digits=clean.replace(/\D/g,"");
    if(!clean) return null;
    return flexList().find(o=>{
      const vals=keys(o).concat([number(o),ecom(o),orderKey(o)]).map(txt).filter(Boolean);
      return vals.some(v=>{
        const vv=v.replace(/^#/,"").trim();
        return vv===clean || (digits && vv.replace(/\D/g,"")===digits);
      });
    }) || null;
  }
  async function addFlexToRouteByCode(){
    const input=document.getElementById("v8FlexRotaBusca");
    const code=txt(input?.value);
    if(!code){ alert("Digite o número do pedido ou e-commerce Flex."); return false; }
    let found=findFlexForRoute(code);
    if(!found){
      await loadData(true);
      found=findFlexForRoute(code);
    }
    if(!found){
      alert("Flex não encontrado na API Flex validada. Confirme se ele aparece na aba Envios Flex e se o Apps Script Flex terminou a validação.");
      return false;
    }
    const withSource={...found,__rotaSource:"Flex"};
    state.rotaFlexExtras=dedup(routeFlexExtras().concat([withSource]));
    if(input) input.value="";
    renderProntoEnvio();
    return true;
  }
  function removeFlexFromRoute(id){
    const clean=txt(id).replace(/^#/,"");
    state.rotaFlexExtras=routeFlexExtras().filter(o=>!keys(o).map(v=>txt(v).replace(/^#/,"")).includes(clean));
    renderProntoEnvio();
  }

function layout(){
    document.body.classList.add("v8-ready","vesco-v9");
    if(document.getElementById("v8Shell")) return;

    const shell=document.createElement("div");
    shell.id="v8Shell";
    shell.innerHTML=`
      <aside id="v8Sidebar">
        <div class="v8-brand">
          <div class="v8-logo">V</div>
          <div class="v8-brand-text"><strong>Vesco Control</strong><small>Logística inteligente</small></div>
          <button id="v8Collapse" class="v8-collapse-btn" title="Menu"><i class="fas fa-bars"></i></button>
        </div>
        <nav class="v8-menu">
          <button data-tab="dashboard"><i class="fas fa-chart-pie"></i><span>Dashboard</span></button>
          <button data-tab="separacao"><i class="fas fa-box-open"></i><span>Separação</span></button>
          <button data-tab="separados"><i class="fas fa-boxes-stacked"></i><span>Separados Hoje</span></button>
          <button data-tab="saiu"><i class="fas fa-route"></i><span>Pronto para Envio</span></button>
          <button data-tab="logistica"><i class="fas fa-truck-fast"></i><span>Logística ERP</span></button>
          <button data-tab="retiradas"><i class="fas fa-store"></i><span>Retiradas</span><b id="v8RetBadge" class="v8-badge">0</b></button>
          <button data-tab="tarefas"><i class="fas fa-clipboard-list"></i><span>Tarefas Frota</span></button>
          <button data-tab="flex"><i class="fas fa-bolt"></i><span>Envios Flex</span></button>
          <button data-tab="entregues"><i class="fas fa-circle-check"></i><span>Entregues</span></button>
        </nav>
        <div class="v8-side-foot"><span></span>Operação conectada</div>
      </aside>
      <main id="v8Main">
        <div id="v8Topbar">
          <div class="v8-title">
            <button id="v8MobileMenuToggle" class="v8-mobile-menu-btn" title="Abrir menu"><i class="fas fa-bars"></i></button>
            <div><h1 id="v8Title">Dashboard</h1><small id="v8Sub">Visão operacional</small></div>
          </div>
          <div class="v8-top-actions">
            <input id="v8Date" type="date" class="v8-date" title="Data operacional">
            <input id="v8Month" type="month" class="v8-date v8-month" title="Mês do faturamento">
            <button id="v8Today" class="v8-btn secondary">Hoje</button>
            <input id="v8Search" class="v8-input" placeholder="Filtrar pedido...">
            <button id="v8Refresh" class="v8-btn">Atualizar</button>
            <div id="v8Clock" class="v8-clock">--:--:--</div>
          </div>
        </div>
        <div id="v8Content"></div>
      </main>`;

    const overlay=document.createElement("div");
    overlay.id="v8MobileOverlay";
    const mobile=document.createElement("nav");
    mobile.id="v8MobileBar";
    mobile.innerHTML=`
      <button data-tab="dashboard"><i class="fas fa-house"></i><span>Início</span></button>
      <button data-tab="separacao"><i class="fas fa-box-open"></i><span>Separar</span></button>
      <button data-tab="saiu"><i class="fas fa-route"></i><span>Rotas</span></button>
      <button data-tab="flex"><i class="fas fa-bolt"></i><span>Flex</span></button>
      <button data-tab="menu"><i class="fas fa-grid-2"></i><span>Mais</span></button>`;

    document.body.prepend(shell);
    document.body.appendChild(overlay);
    document.body.appendChild(mobile);

    const desktopMenuNow=!(window.matchMedia && window.matchMedia("(max-width: 899px), (max-width: 1100px) and (pointer: coarse)").matches);
    if(desktopMenuNow && localStorage.getItem("vesco:v10.56:desktopMenuRestored")!=="1"){
      state.sidebarCollapsed=false;
      localStorage.setItem("vesco:v8:sidebarCollapsed","0");
      localStorage.setItem("vesco:v10.56:desktopMenuRestored","1");
    }
    document.body.classList.toggle("v8-sidebar-collapsed", !!state.sidebarCollapsed);

    function isMobile(){ return window.matchMedia && window.matchMedia("(max-width: 899px), (max-width: 1100px) and (pointer: coarse)").matches; }
    function closeMobileMenu(){ document.body.classList.remove("v8-mobile-menu-open"); }
    function openMobileMenu(){ document.body.classList.add("v8-mobile-menu-open"); }

    const collapseBtn=document.getElementById("v8Collapse");
    if(collapseBtn) collapseBtn.addEventListener("click",()=>{
      if(isMobile()){ closeMobileMenu(); return; }
      state.sidebarCollapsed=!state.sidebarCollapsed;
      document.body.classList.toggle("v8-sidebar-collapsed", state.sidebarCollapsed);
      localStorage.setItem("vesco:v8:sidebarCollapsed", state.sidebarCollapsed ? "1" : "0");
      setTimeout(()=>{try{Object.values(state.maps||{}).forEach(m=>m.invalidateSize(true));}catch(e){}},220);
    });

    document.getElementById("v8MobileMenuToggle")?.addEventListener("click",openMobileMenu);
    overlay.addEventListener("click",closeMobileMenu);

    document.getElementById("v8Date").value=state.date;
    document.getElementById("v8Month").value=state.month;

    document.getElementById("v8Date").addEventListener("change",async e=>{
      state.date=e.target.value||todayISO();
      invalidatePerfCaches();
      await loadData(true);
      resetCurrentPage();
      scheduleRender(true);
    });
    document.getElementById("v8Month").addEventListener("change",async e=>{
      state.month=e.target.value||state.date.slice(0,7);
      state.flexMonthView=state.month;
      invalidatePerfCaches();
      await loadData(true);
      state.pageByTab={};
      scheduleRender(true);
    });
    document.getElementById("v8Today").addEventListener("click",async()=>{
      state.date=todayISO();
      invalidatePerfCaches();
      const d=document.getElementById("v8Date");
      if(d)d.value=state.date;
      await loadData(true);
      state.pageByTab={};
      scheduleRender(true);
    });
    document.getElementById("v8Refresh").addEventListener("click",async()=>{
      window.__vescoFastPollUntil = Date.now() + 45000;
      await loadData(true);
      scheduleRender(true);
    });
    {
      let v1035SearchTimer=null;
      document.getElementById("v8Search").addEventListener("input",()=>{
        clearTimeout(v1035SearchTimer);
        resetCurrentPage();
        v1035SearchTimer=setTimeout(()=>scheduleRender(),220);
      });
    }

    function bindNav(selector){
      document.querySelectorAll(selector).forEach(btn=>btn.addEventListener("click",()=>{
        const tab=btn.dataset.tab;
        if(tab==="menu"){ openMobileMenu(); return; }
        closeMobileMenu();
        go(tab);
      }));
    }
    bindNav("#v8Sidebar [data-tab]");
    bindNav("#v8MobileBar [data-tab]");

    setInterval(()=>{
      const c=document.getElementById("v8Clock");
      if(c) c.textContent=new Date().toLocaleTimeString("pt-BR",{hour12:false});
    },1000);
  }

  
  function setPage(title,sub){
    document.querySelectorAll("#v8Sidebar [data-tab], #v8MobileBar [data-tab]").forEach(b=>b.classList.toggle("active",b.dataset.tab===state.tab));
    const titleEl=document.getElementById("v8Title");
    const subEl=document.getElementById("v8Sub");
    if(titleEl) titleEl.textContent=title;
    if(subEl) subEl.textContent=sub||"";
  }
  function searchFilter(list){ const q=norm(document.getElementById("v8Search")?.value||""); if(!q) return list; return list.filter(o=>norm([orderKey(o),number(o),ecom(o),client(o),address(o),statusAll(o)].join("|")).includes(q)); }
  function kpis(items){ return `<div class="v8-kpis">${items.map(k=>`<div class="v8-kpi"><span>${esc(k.label)}</span><strong>${esc(k.value)}</strong><small>${esc(k.small||"")}</small></div>`).join("")}</div>`; }
  function orderCell(o){ return `<div class="v8-order"><b>#${esc(number(o)||orderKey(o))}</b>${ecom(o)?`<small>E-com: ${esc(ecom(o))}</small>`:""}</div>`; }
  function currentOperator(){
    return txt(localStorage.getItem("vesco:v9:operador_pendencia") || localStorage.getItem("vesco:v8:operador") || window.VESCO_OPERADOR || window.operadorAtual || "Painel");
  }
  function findOrderByAnyId(id){
    const clean=txt(id).replace(/^#/,"").trim();
    const digits=clean.replace(/\D/g,"");
    return dedup((state.orders||[]).concat(state.flex||[])).find(o=>{
      const vals=keys(o).concat([orderKey(o),number(o),ecom(o)]).map(txt).filter(Boolean);
      return vals.some(v=>{
        const vv=v.replace(/^#/,"").trim();
        return vv===clean || (digits && vv.replace(/\D/g,"")===digits);
      });
    }) || null;
  }
  function pedidoLinkHtml(o){
    const link=linkPedido(o);
    if(!link) return "";
    const href=/^https?:\/\//i.test(link) ? link : "https://" + link;
    return `<a class="v92-order-link" href="${esc(href)}" target="_blank" rel="noopener"><i class="fas fa-link"></i> Abrir link do pedido</a>`;
  }
  function avisoSeparadorHtml(o){
    const obs=obsPedido(o);
    const pend=pendenciaTexto(o);
    const parts=[];
    if(obs) parts.push(`<em class="v92-sep-alert"><i class="fas fa-circle-info"></i> ${esc(obs)}</em>`);
    if(pend && !norm(obs).includes(norm(pend))) parts.push(`<em class="v92-sep-alert red"><i class="fas fa-triangle-exclamation"></i> ${esc(pend)}</em>`);
    const link=pedidoLinkHtml(o);
    if(link) parts.push(link);
    return parts.join("");
  }
  function clientCell(o){
    return `<div class="v8-client"><b>${esc(client(o))}</b><small>${esc(address(o)||"Endereço não disponível")}</small>${pagamentoHtml(o)}${avisoSeparadorHtml(o)}</div>`;
  }
  function tablePage({title,sub,kpi,list,columns,empty}){
    setPage(title,sub);
    const fullList = Array.isArray(list) ? list : [];
    const page = paginationFor(fullList,state.tab);
    const visibleList = page.items;
    document.getElementById("v8Content").innerHTML=`
      ${kpis(kpi)}
      <div class="v8-card">
        <div class="v8-card-head">
          <div><h3>${esc(title)}</h3><small>${fullList.length} registro(s) na data ${br(state.date)}${fullList.length?` • exibindo ${page.start+1}-${page.end}`:""}</small></div>
        </div>
        ${pagerHtml(page)}
        <div class="v8-table-wrap">
          <table class="v8-table">
            <thead><tr>${columns.map(c=>`<th>${esc(c.h)}</th>`).join("")}</tr></thead>
            <tbody>${visibleList.length?visibleList.map(o=>`<tr>${columns.map(c=>`<td>${c.render(o)}</td>`).join("")}</tr>`).join(""):`<tr><td colspan="${columns.length}" class="v8-empty"><b>${esc(empty||"Nenhum registro encontrado.")}</b></td></tr>`}</tbody>
          </table>
        </div>
        ${pagerHtml(page)}
      </div>`;
  }

  function renderDashboard(){
    setPage("Dashboard","Resumo executivo da operação em tempo real");
    const erpM=state.orders.filter(inMonth);
    const flexM=state.flex.filter(inMonth);
    const allM=erpM.concat(flexM);
    const fatErp=erpM.reduce((s,o)=>s+value(o),0);
    const fatFlex=flexM.reduce((s,o)=>s+value(o),0);
    const fatTotal=fatErp+fatFlex;
    const clientes=new Set(allM.map(client).filter(Boolean));
    const total=allM.length;
    const dl=derivedLists();
    const sep=dl.separacao.length;
    const pronta=dl.pronto.length;
    const log=dl.logistica.length;
    const flex=dl.flex.length;
    const ret=dl.retiradas.length;
    const pend=dl.pendencias.length;
    const rotaStats=routeOrdersStats();
    const ent=dl.entregues.length;

    const daysInMonth=new Date(Number(state.month.slice(0,4)), Number(state.month.slice(5,7)), 0).getDate();
    const dayVals=Array.from({length:daysInMonth},(_,i)=>({day:i+1,value:0,count:0}));
    allM.forEach(o=>{
      const d=(dueDate(o)||pick(o,["data_pedido","data"])||"").slice(0,10);
      const m=d.match(/^\d{4}-\d{2}-(\d{2})$/);
      if(m){
        const idx=Number(m[1])-1;
        if(dayVals[idx]){
          dayVals[idx].value+=value(o);
          dayVals[idx].count++;
        }
      }
    });
    const maxDay=Math.max(1,...dayVals.map(d=>d.value));
    const bars=dayVals.map(d=>`<i title="Dia ${String(d.day).padStart(2,"0")}: ${money(d.value)}" style="height:${Math.max(5,Math.round((d.value/maxDay)*100))}%"><b>${String(d.day).padStart(2,"0")}</b></i>`).join("");

    const statusTotal=Math.max(1,sep+pronta+log+flex+ret+ent);
    const pEnt=Math.round((ent/statusTotal)*100);
    const pSep=Math.round((sep/statusTotal)*100);
    const pPronta=Math.round((pronta/statusTotal)*100);
    const pFlex=Math.round((flex/statusTotal)*100);
    const donutStyle=`--p1:${pEnt};--p2:${pEnt+pSep};--p3:${pEnt+pSep+pPronta};--p4:${pEnt+pSep+pPronta+pFlex};`;

    const priority=[
      {fila:"Pendências produto",total:pend,regra:"Produto/observação a resolver",nivel:pend?"Alta":"Ok",tab:"separacao"},
      {fila:"Separação",total:sep,regra:"ERP aguardando separação",nivel:sep?"Alta":"Ok",tab:"separacao"},
      {fila:"Pronto para Envio",total:pronta,regra:"Pedidos separados aguardando rota",nivel:pronta?"Média":"Ok",tab:"saiu"},
      {fila:"Pedidos em rota",total:rotaStats.pending,regra:"Aguardando confirmação de entrega",nivel:rotaStats.pending?"Média":"Ok",tab:"saiu"},
      {fila:"Logística ERP",total:log,regra:"ERP não entregue com endereço",nivel:log?"Média":"Ok",tab:"logistica"},
      {fila:"Envios Flex",total:flex,regra:"Planilha Flex validada",nivel:flex?"Média":"Ok",tab:"flex"},
      {fila:"Retiradas / sem rota",total:ret,regra:"Retirada ou sem endereço",nivel:ret?"Baixa":"Ok",tab:"retiradas"}
    ];
    const nivelClass=n=>n==="Alta"?"red":(n==="Média"?"orange":(n==="Baixa"?"green":"blue"));

    document.getElementById("v8Content").innerHTML=`
      <section class="v9-hero">
        <div>
          <span class="v9-eyebrow">Operação em tempo real</span>
          <h2>Controle logístico com visão clara do mês</h2>
          <p>ERP, Flex, separação, rotas e entregas em um painel único para decisão rápida.</p>
        </div>
        <div class="v9-hero-actions">
          <button class="v8-btn" onclick="VescoV8.go('separacao')">Abrir separação</button>
          <button class="v8-btn orange" onclick="VescoV8.go('saiu')">Criar rota</button>
        </div>
      </section>

      <div class="v9-kpi-grid">
        <div class="v9-kpi primary"><span>Faturamento total</span><strong>${money(fatTotal)}</strong><small>ERP ${money(fatErp)} • Flex ${money(fatFlex)}</small></div>
        <div class="v9-kpi"><span>Pedidos ERP</span><strong>${erpM.length}</strong><small>base ERP no mês</small></div>
        <div class="v9-kpi"><span>Pedidos Flex</span><strong>${flexM.length}</strong><small>base Flex no mês</small></div>
        <div class="v9-kpi"><span>Clientes únicos</span><strong>${clientes.size}</strong><small>ERP + Flex</small></div>
        <div class="v9-kpi"><span>Ticket médio</span><strong>${money(total?fatTotal/total:0)}</strong><small>pedidos com valor</small></div>
        <div class="v9-kpi"><span>Logística ERP</span><strong>${log}</strong><small>a entregar</small></div>
        <div class="v9-kpi"><span>Retiradas/Sem rota</span><strong>${ret}</strong><small>não entra no mapa</small></div>
        <div class="v9-kpi"><span>Em rota</span><strong>${rotaStats.pending}</strong><small>${rotaStats.delivered} entregue(s) na rota</small></div>
        <div class="v9-kpi"><span>Entregues hoje</span><strong>${ent}</strong><small>${br(state.date)}</small></div>
      </div>

      <div class="v9-dashboard-grid">
        <div class="v8-card v9-chart-card">
          <div class="v8-card-head"><div><h3>Faturamento por dia</h3><small>${monthLabel(state.month)}</small></div><b>${money(fatTotal)}</b></div>
          <div class="v9-bars-chart">${bars}</div>
          <div class="v9-chart-axis"><span>01</span><span>${String(Math.ceil(daysInMonth/2)).padStart(2,"0")}</span><span>${String(daysInMonth).padStart(2,"0")}</span></div>
        </div>

        <div class="v8-card v9-donut-card">
          <div class="v8-card-head"><div><h3>Status dos pedidos</h3><small>Visão operacional atual</small></div></div>
          <div class="v9-donut-wrap">
            <div class="v9-donut" style="${donutStyle}"><b>${statusTotal}</b><span>Total</span></div>
            <div class="v9-legend">
              <p><i class="blue"></i>Entregues <b>${ent}</b></p>
              <p><i class="orange"></i>Separação <b>${sep}</b></p>
              <p><i class="green"></i>Pronto rota <b>${pronta}</b></p>
              <p><i class="cyan"></i>Flex <b>${flex}</b></p>
              <p><i class="red"></i>Retirada/sem rota <b>${ret}</b></p>
            </div>
          </div>
        </div>

        <div class="v8-card v9-quick-card">
          <div class="v8-card-head"><div><h3>Resumo rápido</h3><small>Ações de hoje</small></div></div>
          <button onclick="VescoV8.go('separados')"><i class="fas fa-boxes-stacked"></i><span>Separados hoje</span><b>${dl.separados.length}</b></button>
          <button onclick="VescoV8.go('saiu')"><i class="fas fa-route"></i><span>Pedidos prontos para rota</span><b>${pronta}</b></button>
          <button onclick="VescoV8.go('tarefas')"><i class="fas fa-clipboard-list"></i><span>Tarefas frota</span><b>${tarefasFrotaList().length}</b></button>
          <button onclick="VescoV8.go('flex')"><i class="fas fa-bolt"></i><span>Flex do mês</span><b>${flex}</b></button>
        </div>
      </div>

      <div class="v9-bottom-grid">
        <div class="v8-card">
          <div class="v8-card-head"><div><h3>Prioridade operacional</h3><small>O que precisa de atenção agora</small></div></div>
          <div class="v8-table-wrap">
            <table class="v8-table v9-priority-table">
              <thead><tr><th>Fila</th><th>Total</th><th>Regra</th><th>Status</th><th>Ação</th></tr></thead>
              <tbody>${priority.map(p=>`<tr><td><b>${p.fila}</b></td><td>${p.total}</td><td>${p.regra}</td><td><span class="v8-chip ${nivelClass(p.nivel)}">${p.nivel}</span></td><td><button class="v8-btn secondary" onclick="VescoV8.go('${p.tab}')">Abrir</button></td></tr>`).join("")}</tbody>
            </table>
          </div>
        </div>
        <div class="v8-card">
          <div class="v8-card-head"><div><h3>Entregues hoje</h3><small>Somente data real de entrega</small></div></div>
          <div class="v8-table-wrap">
            <table class="v8-table"><thead><tr><th>Pedido</th><th>Cliente</th><th>Entrega</th></tr></thead><tbody>${dl.entregues.slice(0,8).map(o=>`<tr><td>#${esc(number(o)||orderKey(o))}</td><td>${esc(client(o))}</td><td>${br(deliveryDate(o))}</td></tr>`).join("")||`<tr><td colspan="3" class="v8-empty"><b>Nenhuma entrega hoje.</b></td></tr>`}</tbody></table>
          </div>
        </div>
      </div>`;
  }

  

  function safeDomId(v){ return txt(v).replace(/[^a-zA-Z0-9_-]/g,"_").slice(0,90) || ("id_" + Math.random().toString(36).slice(2)); }
  function obsPedido(o){
    return txt(pick(o,[
      "observacao_pedido","observacaoPedido","obs_pedido","obsPedido",
      "observacao_logistica","observacaoLogistica","observacao","obs",
      "comentario","comentário","nota_interna","notaInterna"
    ]));
  }
  function linkPedido(o){
    return txt(pick(o,[
      "link_pedido","linkPedido","url_pedido","urlPedido","link",
      "url","pedido_url","pedidoUrl","link_venda","linkVenda"
    ]));
  }
  function pendenciaTexto(o){
    return txt(pick(o,[
      "pendencia_produto","pendenciaProduto","produto_pendente","produtoPendente",
      "produtos_pendentes","produtosPendentes","item_pendente","itemPendente",
      "pendencia","pendência"
    ])) || (norm(obsPedido(o)).includes("pendencia") || norm(obsPedido(o)).includes("pendência") ? obsPedido(o) : "");
  }
  function hasPendenciaProduto(o){
    const s=norm([statusAll(o), obsPedido(o), pendenciaTexto(o)].join(" | "));
    return s.includes("pendencia") || s.includes("pendência") || s.includes("produto faltante") || s.includes("falta produto") || s.includes("item faltante") || s.includes("sem produto") || s.includes("ruptura");
  }

  function planilhaStatusVetaEntregue(o){
    // V10.29: se a fonte principal ainda diz A Separar/Pendência, não considerar entregue.
    // Isso evita que atualização de pendência no Firebase apareça na aba Entregues.
    const s=norm(statusAll(o));
    if(hasPendenciaProduto(o)) return true;
    return s.includes("a separar") ||
      s.includes("em separacao") ||
      s.includes("em separação") ||
      s.includes("pendencia") ||
      s.includes("pendência") ||
      s.includes("pendente") ||
      s.includes("produto faltante") ||
      s.includes("falta produto");
  }

  function hasComprovanteEntregaReal(o){
    // Só estes campos contam como entrega/retirada real.
    // updated_at/status_atualizado_em sozinhos NÃO contam.
    return !!txt(pick(o,[
      "entregue_em","retirado_em","retirada_em",
      "data_entregue_iso","data_entregue",
      "data_entrega_realizada","data_retirada",
      "confirmado_entregue_em","confirmado_retirado_em",
      "comprovante_id","comprovante_url","comprovante_motorista",
      "recebedor","nome_recebedor","recebido_por"
    ]));
  }
  function pendenciasProdutoList(){
    return dedup(state.orders)
      .filter(o=>!o.is_flex)
      .filter(o=>!o.is_delivered)
      .filter(hasPendenciaProduto);
  }

  function isSeparatedForQueue(o){
    const s=norm(statusAll(o));
    if(isDelivered(o)) return true;
    return s.includes("separado") ||
      s.includes("pronto para envio") ||
      s.includes("pronto para rota") ||
      s.includes("pronto") ||
      s.includes("despachado") ||
      s.includes("saiu para entrega") ||
      s.includes("em rota") ||
      !!sepEndTime(o);
  }
  function separacaoList(){
    return dedup(state.orders)
      .filter(o=>!o.is_flex)
      .filter(o=>!isDelivered(o))
      // V10.43: retirada também precisa passar pela separação antes da entrega/retirada.
      .filter(o=>!isSeparatedForQueue(o))
      .filter(untilDate)
      .filter(o=>{
        const s=norm(statusAll(o));
        return !s ||
          s.includes("a separar") ||
          s.includes("em separacao") ||
          s.includes("em separação") ||
          s.includes("pendente") ||
          s.includes("em aberto") ||
          s==="aberto" ||
          s.includes(" aberto");
      });
  }

  function renderSeparacao(){
    const dl=derivedLists();
    const allList=searchFilter(dl.separacao);
    const pendencias=searchFilter(dl.pendencias);
    const list=dedup(allList.concat(pendencias));
    const page=paginationFor(list,"separacao");
    const visibleList=page.items;
    setPage("Separação","Fila ativa de pedidos ERP ainda não separados.");
    const totalValue=list.reduce((s,o)=>s+value(o),0);
    document.getElementById("v8Content").innerHTML=`
      ${kpis([
        {label:"Na fila",value:String(list.length),small:"pedidos a separar"},
        {label:"Com endereço",value:String(list.filter(o=>hasAddress(o)).length),small:"podem ir para rota depois"},
        {label:"Pendências",value:String(pendencias.length),small:"produto/observação a resolver"},
        {label:"Valor",value:money(totalValue),small:"fila visível"}
      ])}

      ${pendencias.length?`
      <div class="v8-card v91-pendency-panel">
        <div class="v8-card-head">
          <div><h3>Pedidos com pendência a resolver</h3><small>Resolva antes de concluir a separação.</small></div>
          <span class="v8-chip red">${pendencias.length} pendência(s)</span>
        </div>
        <div class="v91-pendency-list">
          ${pendencias.slice(0,8).map(o=>{
            const id=esc(orderKey(o)||number(o));
            return `<div class="v91-pendency-item">
              <div><b>#${esc(number(o)||orderKey(o))} — ${esc(client(o))}</b><small>${esc(pendenciaTexto(o)||obsPedido(o)||"Pendência de produto registrada")}</small></div>
              <div class="v8-row-actions">
                ${pedidoLinkHtml(o)}
                <button class="v8-btn green" onclick="VescoV8.resolverPendenciaProduto('${id}')">Resolver</button>
              </div>
            </div>`;
          }).join("")}
        </div>
      </div>`:""}

      <div class="v8-card v9-flow-card">
        <div class="v8-card-head">
          <div><h3>Fluxo de separação</h3><small>Inicie, registre observações/pendências e conclua para liberar em Pronto para Envio.</small></div>
          <button class="v8-btn green" onclick="VescoV8.go('saiu')">Ver prontos para envio</button>
        </div>
        <div class="v9-flow">
          <span><b>1</b>Iniciar</span>
          <span><b>2</b>Separar itens</span>
          <span><b>3</b>Relatório de pendência</span>
          <span><b>4</b>Concluir separação</span>
        </div>
      </div>

      <div class="v8-card">
        <div class="v8-card-head">
          <div><h3>Pedidos aguardando separação</h3><small>${list.length} registro(s)${list.length?` • exibindo ${page.start+1}-${page.end}`:""}</small></div>
          <div class="v8-card-actions"><button class="v8-btn secondary" onclick="VescoV8.definirOperador()">Operador</button></div>
        </div>
        ${pagerHtml(page)}
        <div class="v8-table-wrap">
          <table class="v8-table v92-separacao-table">
            <thead><tr><th>Pedido</th><th>Cliente / endereço / aviso</th><th>Data</th><th>Forma</th><th>Pagamento</th><th>Status</th><th>Ação</th></tr></thead>
            <tbody>${visibleList.length?visibleList.map(o=>{
              const idRaw=orderKey(o)||number(o);
              const id=esc(idRaw);
              const st=norm(status(o)||statusAll(o));
              const emSep=st.includes("em separacao")||st.includes("em separação");
              const pend=hasPendenciaProduto(o);
              return `<tr class="${pend?"v91-row-pending":""}">
                <td>${orderCell(o)} ${pend?'<span class="v8-chip red">Pendência</span>':''}</td>
                <td>${clientCell(o)}</td>
                <td><span class="v8-chip gray">${br(dueDate(o))}</span></td>
                <td>${o.is_retirada?'<span class="v8-chip green">Retirada</span>':(!o.has_address?'<span class="v8-chip orange">Sem endereço</span>':'<span class="v8-chip blue">Entrega</span>')}</td>
                <td>${pagamentoText(o)?`<span class="v8-chip blue">${esc(pagamentoText(o))}</span>`:"—"}</td>
                <td><span class="v8-chip ${pend?"red":(emSep?"orange":"red")}">${esc(pend?"Pendência produto":(status(o)||"A Separar"))}</span></td>
                <td>
                  <div class="v8-row-actions v92-action-row">
                    ${emSep?"":`<button class="v8-btn" onclick="VescoV8.updateStatus('${id}','Em Separação')">Iniciar</button>`}
                    <button class="v8-btn orange" onclick="VescoV8.abrirRelatorioPendencia('${id}')">Pendência</button>
                    <button class="v8-btn secondary" onclick="VescoV8.abrirObsLinkPedido('${id}')">Obs/link</button>
                    <button class="v8-btn green" onclick="VescoV8.updateStatus('${id}','Separado')">Concluir</button>
                  </div>
                </td>
              </tr>`;
            }).join(""):`<tr><td colspan="7" class="v8-empty"><b>Nenhum pedido aguardando separação.</b></td></tr>`}</tbody>
          </table>
        </div>
        ${pagerHtml(page)}
      </div>`;
  }

  
  
  function prontoList(){
    // V10.32: Pronto para Envio é SOMENTE pedido separado na data selecionada.
    // Não entra "separado/pronto" antigo, nem pedido de outro dia.
    const bySeparated=typeof separadosList==="function" ? separadosList() : [];
    return dedup(bySeparated.map(enrichSeparatedWithMaster))
      .filter(o=>!o.is_flex)
      .filter(o=>!isDelivered(o))
      .filter(o=>!isRetirada(o))
      .filter(o=>!hasPendenciaProduto(o))
      .filter(o=>{
        const d=sepDate(o) || parseISO(pick(o,["data_separacao_iso","data","dataISO","date"]));
        return !d || d===state.date;
      });
  }

  
  function parseRouteArray(v){
    if(Array.isArray(v)) return v;
    if(!v) return [];
    try{
      const p=JSON.parse(String(v));
      if(Array.isArray(p)) return p;
      if(p && typeof p==="object") return [p];
    }catch(e){}
    return String(v).split(/[\s,;]+/).map(x=>x.trim()).filter(Boolean);
  }

  function orderByAnyKey(id){
    const clean=txt(id).replace(/^#/,"");
    const digits=clean.replace(/\D/g,"");
    return dedup(state.orders).find(o=>{
      const vals=[orderKey(o),number(o),o.id,o.id_tiny,o.numero,o.pedido,o.numero_ecommerce,o.ecom].map(txt).filter(Boolean);
      return vals.some(v=>{
        const vv=v.replace(/^#/,"");
        return vv===clean || (digits && vv.replace(/\D/g,"")===digits);
      });
    });
  }

  function routePedidos(r){
    return parseRouteArray(r.pedidos || r.pedidos_json || r.pedidos_ids || r.pedidosJson || []);
  }

  function routeStops(r){
    let stops=parseRouteArray(r.paradas || r.paradas_json || r.paradasJson || []);
    stops=stops.filter(s=>s && typeof s==="object" && !s.isOrigin && !s.isOrigem);

    if(!stops.length){
      stops=routePedidos(r).map(id=>{
        const o=orderByAnyKey(id);
        if(!o) return null;
        const c=coords(o);
        return {
          pedido:number(o)||orderKey(o),
          cliente:client(o),
          endereco:address(o),
          lat:c?c.lat:"",
          lon:c?c.lon:""
        };
      }).filter(Boolean);
    }

    return stops;
  }

  function mapsQuery(stop){
    if(!stop) return "";
    const lat=parseFloat(String(stop.lat||stop.latitude||"").replace(",","."));
    const lon=parseFloat(String(stop.lon||stop.lng||stop.longitude||"").replace(",","."));
    if(Number.isFinite(lat) && Number.isFinite(lon)) return lat + "," + lon;
    return txt(stop.endereco || stop.address || stop.cliente || stop.nome || "");
  }

  function routeGoogleMapsLink(r){
    const origin=txt(r.origem||"Rua São Leopoldo 92");
    const stops=routeStops(r).map(mapsQuery).filter(Boolean);
    const url=new URL("https://www.google.com/maps/dir/");
    if(!stops.length){
      url.searchParams.set("api","1");
      url.searchParams.set("origin",origin);
      return url.toString();
    }
    url.searchParams.set("api","1");
    url.searchParams.set("origin",origin);
    url.searchParams.set("destination",stops[stops.length-1]);
    if(stops.length>1) url.searchParams.set("waypoints",stops.slice(0,-1).join("|"));
    url.searchParams.set("travelmode","driving");
    return url.toString();
  }

  function routeWazeLink(r){
    const stops=routeStops(r);
    const last=stops[stops.length-1];
    const q=mapsQuery(last) || txt(r.origem||"Rua São Leopoldo 92");
    const url=new URL("https://waze.com/ul");
    const parts=q.split(",");
    if(parts.length===2 && !isNaN(parseFloat(parts[0])) && !isNaN(parseFloat(parts[1]))){
      url.searchParams.set("ll",q);
    }else{
      url.searchParams.set("q",q);
    }
    url.searchParams.set("navigate","yes");
    return url.toString();
  }


  const ROUTES_LOCAL_KEY="vesco:v95:rotas_motorista_local";
  function firebaseDbUrl(){
    const raw=txt(window.VESCO_FIREBASE_DATABASE_URL || window.VESCO_RTDB_URL || "https://dashlogistica-49689-default-rtdb.firebaseio.com");
    return raw.replace(/\/+$/,"");
  }
  function firebaseEnabled(){ return !!firebaseDbUrl(); }
  function firebaseSafeId(id){ return txt(id).replace(/[.#$/\\[\\]]/g,"_") || ("rota_" + Date.now()); }
  function firebaseRouteRestUrl(id){
    const db=firebaseDbUrl();
    if(!db) return "";
    return db + "/vesco_rotas_motorista/" + encodeURIComponent(firebaseSafeId(id)) + ".json";
  }
  function localRotas(){
    try{
      const arr=JSON.parse(localStorage.getItem(ROUTES_LOCAL_KEY)||"[]");
      return Array.isArray(arr)?arr:[];
    }catch(e){ return []; }
  }
  function saveLocalRota(rota){
    const rid=routeId(rota);
    if(!rid) return;
    const list=localRotas().filter(r=>routeId(r)!==rid);
    list.unshift(rota);
    localStorage.setItem(ROUTES_LOCAL_KEY, JSON.stringify(list.slice(0,80)));
  }
  function mergeRotas(apiRotas){
    const all=[...(Array.isArray(apiRotas)?apiRotas:[]),...localRotas()];
    const seen=new Set();
    const out=[];
    all.forEach(r=>{
      const id=routeId(r);
      if(!id || seen.has(id)) return;
      seen.add(id);
      out.push(r);
    });
    return out;
  }
  async function saveRouteFirebase(rota){
    const url=firebaseRouteRestUrl(routeId(rota));
    if(!url) return {success:false, skipped:true, reason:"firebase_not_configured"};
    const payload=Object.assign({}, rota, {
      rota_id:routeId(rota),
      token:routeToken(rota),
      atualizado_em:new Date().toISOString(),
      fonte:"vesco_v95"
    });
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),6500);
    try{
      const res=await fetch(url,{
        method:"PUT",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(payload),
        signal:ctrl.signal
      });
      clearTimeout(timer);
      if(!res.ok) throw new Error("Firebase HTTP " + res.status);
      return {success:true, backend:"firebase"};
    }catch(e){
      clearTimeout(timer);
      console.warn("V9.5: Firebase rota falhou; usando fallback.", e.message||e);
      return {success:false, error:e.message||String(e)};
    }
  }
  
  async function testFirebaseRoutes(){
    const id="teste-" + Date.now();
    const rota={
      rota_id:id,
      id,
      token:"teste",
      nome_rota:"Teste Firebase",
      motorista:"Teste",
      origem:"Rua São Leopoldo 92",
      pedidos:[],
      paradas:[],
      criado_em:new Date().toISOString()
    };
    const res=await saveRouteFirebase(rota);
    console.log("Teste Firebase rotas:", res, firebaseRouteRestUrl(id));
    return res;
  }

function fastRouteLink(rota, opts={}){
    const url=new URL("motorista.html", window.location.href);
    url.searchParams.set("rota", routeId(rota));
    url.searchParams.set("token", routeToken(rota));
    url.searchParams.set("api", API_MAIN);
    const db=firebaseDbUrl();
    if(db){
      url.searchParams.set("fb", db);
      url.searchParams.set("store","firebase");
    }

    // V10.43: SEMPRE leva data como fallback.
    // Mesmo com Firebase, se o banco estiver vazio ou a gravação falhar, o motorista abre a rota.
    const data=encodeRoutePayload(routeOfflinePayload(rota));
    if(data) url.searchParams.set("data", data);

    return url.toString();
  }

  function encodeRoutePayload(obj){
    try{
      const json=JSON.stringify(obj||{});
      return btoa(unescape(encodeURIComponent(json)))
        .replace(/\+/g,"-")
        .replace(/\//g,"_")
        .replace(/=+$/,"");
    }catch(e){ return ""; }
  }

  function routeOfflinePayload(r){
    const stops=routeStops(r);
    const ids=routePedidos(r);
    return {
      offline:true,
      id:txt(r.rota_id || r.id || r.rota || ""),
      token:txt(r.token || r.motorista_token || ""),
      nome:txt(r.nome_rota || r.nome || "Rota"),
      motorista:txt(r.motorista || ""),
      origem:txt(r.origem || "Rua São Leopoldo 92"),
      criado_em:txt(r.criado_em || r.criadoEm || ""),
      pedidos:ids,
      paradas:stops
    };
  }

  function routeMotoristaLink(r){
    return fastRouteLink(r, {firebase:!!(r && r.__firebaseSaved)});
  }

  function routePedidosCount(r){
    return routePedidos(r).length || routeStops(r).length || 0;
  }

  function routeId(r){ return txt(r.rota_id || r.id || r.rota || ""); }
  function routeToken(r){ return txt(r.token || r.motorista_token || ""); }
  function routeName(r){ return txt(r.nome_rota || r.nome || "Rota"); }

  function routeCreatedDate(r){
    // V10.30: Pronto para Envio mostra somente rotas criadas na data selecionada.
    // Não mexe em Flex, endereços ou pedidos disponíveis.
    return parseISO(pick(r,[
      "data_rota","data","date","criado_em","criadoEm","created_at","createdAt",
      "atualizado_em","updated_at","timestamp"
    ])) || "";
  }

  function rotaCriadaNaData(r, date=state.date){
    const d=routeCreatedDate(r);
    return !!d && d===date;
  }

  function rotasCriadasDaData(){
    return (Array.isArray(state.rotas)?state.rotas:[]).filter(r=>rotaCriadaNaData(r,state.date));
  }

  function orderByRouteStop(stop){
    if(!stop) return null;
    const key=txt(stop.pedido || stop.numero || stop.id || stop.pedido_id || stop.ecom || stop.numero_ecommerce || "");
    return orderByAnyKey(key) || null;
  }

  function fallbackOrderFromStop(stop,r){
    const key=txt(stop && (stop.pedido || stop.numero || stop.id || stop.pedido_id || stop.ecom || stop.numero_ecommerce)) || "";
    return {
      id:key,
      pedido_key:key,
      numero:key,
      cliente_nome:txt(stop && (stop.cliente || stop.cliente_nome || stop.destinatario)) || "Cliente",
      destinatario:txt(stop && (stop.cliente || stop.cliente_nome || stop.destinatario)) || "Cliente",
      endereco_completo:txt(stop && (stop.endereco || stop.endereco_completo || stop.address)),
      status_logistica:txt(stop && (stop.status_logistica || stop.status)) || "Em rota",
      data_prevista:state.date,
      lat:txt(stop && (stop.lat || stop.latitude)),
      lon:txt(stop && (stop.lon || stop.lng || stop.longitude)),
      __routeId:routeId(r),
      __routeName:routeName(r)
    };
  }

  function routeOrdersRows(){
    const rows=[];
    // V10.30: Pedidos em rota no Pronto para Envio acompanham somente rotas criadas na data selecionada.
    const rotas=rotasCriadasDaData();
    rotas.forEach(r=>{
      const rid=routeId(r);
      const token=routeToken(r);
      let stops=routeStops(r);
      const ids=routePedidos(r);

      if(!stops.length && ids.length){
        stops=ids.map(id=>({pedido:id}));
      }

      stops.forEach((stop,idx)=>{
        const key=txt(stop && (stop.pedido || stop.numero || stop.id || stop.pedido_id || stop.ecom || stop.numero_ecommerce)) || txt(ids[idx] || "");
        const found=orderByAnyKey(key) || orderByRouteStop(stop);
        let order=found || fallbackOrderFromStop(Object.assign({}, stop||{}, {pedido:key}), r);

        // V10.43: aplica entregas salvas no Firebase dentro da própria rota.
        const entregas=r.entregas || {};
        const possibleKeys=[key, number(order), orderKey(order), ecom(order), stop?.pedido, stop?.numero, stop?.id, stop?.ecom]
          .map(txt).filter(Boolean);
        const entregaKey=Object.keys(entregas).find(k=>possibleKeys.some(v=>k===v || k===firebaseSafeId(v) || firebaseSafeId(k)===firebaseSafeId(v)));
        if(entregaKey){
          const ent=entregas[entregaKey] || {};
          order=Object.assign({}, order, ent, {
            status_logistica:"Entregue",
            situacao_nome:"Entregue",
            is_delivered:true,
            data_entrega_realizada:ent.data_entrega_realizada || parseISO(ent.entregue_em) || state.date,
            entregue_em:ent.entregue_em || ent.updated_at || new Date().toISOString()
          });
        }

        rows.push({
          rota:r,
          rota_id:rid,
          token,
          nome_rota:routeName(r),
          motorista:txt(r.motorista || ""),
          origem:txt(r.origem || ""),
          parada:idx+1,
          key:key || orderKey(order) || number(order),
          order,
          stop:stop || {}
        });
      });
    });
    return rows;
  }

  function routeOrdersStats(){
    const rows=routeOrdersRows();
    const delivered=rows.filter(row=>isDelivered(row.order)).length;
    return { total:rows.length, delivered, pending:Math.max(0,rows.length-delivered) };
  }

  function trackingLocAtual(loc){
    if(!loc) return null;
    if(loc.atual && (loc.atual.lat || loc.atual.latitude)) return loc.atual;
    if(loc.lat || loc.latitude) return loc;
    return null;
  }
  function locLat(loc){ return Number(String(loc?.lat ?? loc?.latitude ?? "").replace(",",".")); }
  function locLon(loc){ return Number(String(loc?.lon ?? loc?.lng ?? loc?.longitude ?? "").replace(",",".")); }
  function locOk(loc){
    const la=locLat(loc), lo=locLon(loc);
    return Number.isFinite(la) && Number.isFinite(lo);
  }
  function locAgeText(ts){
    const t=Date.parse(ts||"");
    if(!Number.isFinite(t)) return "sem horário";
    const s=Math.max(0,Math.round((Date.now()-t)/1000));
    if(s<60) return `há ${s}s`;
    const m=Math.round(s/60);
    if(m<60) return `há ${m}min`;
    const h=Math.floor(m/60);
    return `há ${h}h ${m%60}min`;
  }
  function locStatusClass(loc){
    const t=Date.parse(loc?.updated_at || loc?.atualizado_em || "");
    if(!Number.isFinite(t)) return "red";
    const s=(Date.now()-t)/1000;
    if(s<45) return "green";
    if(s<180) return "orange";
    return "red";
  }
  async function refreshMotoristasLocalizacao(renderDom=true){
    try{
      const data=await firebaseGet("vesco_motoristas_localizacao", 3500);
      state.motoristasLocalizacao=data||{};
      if(renderDom && document.getElementById("v106MotoristasAoVivo")) renderMotoristasAoVivoIntoDom();
      if(renderDom && document.getElementById("v112-driver-map")) renderDriverLiveMap(false);
      return state.motoristasLocalizacao;
    }catch(e){
      console.warn("V10.43: localização motorista indisponível.", e.message||e);
      return state.motoristasLocalizacao||{};
    }
  }
  function startMotoristaTrackingPolling(){
    if(!state.driverTrackTimer){
      refreshMotoristasLocalizacao(false);
      // Fallback leve: se o listener realtime não estiver disponível, atualiza a cada 5s.
      state.driverTrackTimer=setInterval(()=>refreshMotoristasLocalizacao(true),5000);
    }
    attachDriverRealtimeListener();
  }

  async function attachDriverRealtimeListener(){
    if(state.driverRealtimeAttached) return;
    const cfg=window.VESCO_FIREBASE_CONFIG || window.firebaseConfig || null;
    if(!cfg || !cfg.databaseURL || !window.firebase || !window.firebase.database) return;
    try{
      const app=(window.firebase.apps && window.firebase.apps.length) ? window.firebase.app() : window.firebase.initializeApp(cfg);
      const db=window.firebase.database(app);
      state.driverRealtimeAttached=true;
      db.ref("vesco_motoristas_localizacao").on("value", snap=>{
        state.motoristasLocalizacao=snap.val()||{};
        renderMotoristasAoVivoIntoDom();
        renderDriverLiveMap(false);
      });
      console.log("V10.43: listener realtime de motoristas ativo.");
    }catch(e){
      console.warn("V10.43: listener realtime não iniciou; usando polling.", e.message||e);
    }
  }

  function stopMotoristaTrackingPolling(){
    if(state.driverTrackTimer){
      clearInterval(state.driverTrackTimer);
      state.driverTrackTimer=null;
    }
  }
  function mapsDriverUrl(loc){
    const la=locLat(loc), lo=locLon(loc);
    const url=new URL("https://www.google.com/maps/search/");
    url.searchParams.set("api","1");
    url.searchParams.set("query",`${la},${lo}`);
    return url.toString();
  }
  function routeDriverRows(){
    // V10.32: motoristas ao vivo acompanha somente rotas da data selecionada.
    // Evita renderizar histórico inteiro e travar a tela.
    const rotas=rotasCriadasDaData();
    const locs=state.motoristasLocalizacao||{};
    return rotas.map(r=>{
      const id=routeId(r);
      const raw=locs[id] || locs[firebaseSafeId(id)] || {};
      const atual=trackingLocAtual(raw);
      return {rota:r,rota_id:id,locRaw:raw,loc:atual};
    });
  }
  function renderMotoristasAoVivo(){
    const rows=routeDriverRows();
    if(!rows.length) return `<div class="v8-empty"><b>Nenhuma rota criada para acompanhar.</b></div>`;
    return `<div class="v106-driver-grid">${rows.map(row=>{
      try{
        const r=row.rota||{}, loc=row.loc||{}, ok=locOk(loc);
        const cls=ok?locStatusClass(loc):"red";
        const age=ok?locAgeText((loc&&loc.updated_at)||(loc&&loc.atualizado_em)||""):"sem localização";
        const speed=txt((loc&&loc.velocidade_kmh) || (loc&&loc.speed_kmh) || "");
        const acc=txt((loc&&loc.precisao_m) || (loc&&loc.accuracy) || "");
        const trailCount=row.locRaw && row.locRaw.percurso ? Object.keys(row.locRaw.percurso).length : 0;
        return `<div class="v106-driver-card ${ok?"":"missing"}">
          <div class="v106-driver-top">
            <div><b>${esc(routeName(r))}</b><small>${esc(r.motorista||"Motorista não informado")}</small></div>
            <span class="v8-chip ${cls}">${ok?age:"sem sinal"}</span>
          </div>
          <div class="v106-driver-info">
            ${ok?`<span>Lat/Lon: ${locLat(loc).toFixed(5)}, ${locLon(loc).toFixed(5)}</span>`:`<span>Motorista ainda não permitiu localização.</span>`}
            ${speed?`<span>Velocidade: ${esc(speed)} km/h</span>`:""}
            ${acc?`<span>Precisão: ${esc(acc)}m</span>`:""}
            <span>Pontos do percurso: ${trailCount}</span>
          </div>
          <div class="v8-row-actions">
            ${ok?`<a class="v8-btn secondary" target="_blank" rel="noopener" href="${esc(mapsDriverUrl(loc))}">Abrir posição</a>`:`<button class="v8-btn secondary" disabled>Sem posição</button>`}
            <button class="v8-btn" onclick="VescoV8.mostrarMotoristaNoMapa('${esc(row.rota_id||"")}')">Ver no mapa</button>
          </div>
        </div>`;
      }catch(e){
        console.warn("V10.43: falha ao renderizar card do motorista; card ignorado.", e);
        return "";
      }
    }).join("")}</div>`;
  }

  function safeRenderMotoristasAoVivo(){
    try{
      return renderMotoristasAoVivo();
    }catch(e){
      console.warn("V10.43: Motoristas ao vivo não bloqueou o painel.", e);
      return `<div class="v8-empty"><b>Rastreamento aguardando localização.</b><br><small>O painel continua funcionando normalmente.</small></div>`;
    }
  }
  function renderMotoristasAoVivoIntoDom(){
    const box=document.getElementById("v106MotoristasAoVivo");
    if(box) box.innerHTML=renderMotoristasAoVivo();
  }
  function focarMotoristaRota(rotaId){
    state.motoristaTrackingFocus=txt(rotaId);
    const row=routeDriverRows().find(r=>r.rota_id===state.motoristaTrackingFocus);
    if(row && locOk(row.loc)){
      window.open(mapsDriverUrl(row.loc),"_blank","noopener");
    }else{
      alert("Ainda não há localização para esta rota. Peça para o motorista tocar em Iniciar localização no app.");
    }
  }

  function percursoPoints(raw){
    const p=raw && raw.percurso;
    if(!p || typeof p!=="object") return [];
    return Object.keys(p)
      .sort((a,b)=>Number(a)-Number(b))
      .map(k=>p[k])
      .filter(locOk)
      .map(loc=>[locLat(loc),locLon(loc),loc]);
  }
  function driverMarkerIcon(label){
    return L.divIcon({
      className:"",
      html:`<div class="v112-driver-marker"><i class="fas fa-motorcycle"></i><span>${esc(label||"M")}</span></div>`,
      iconSize:[42,42],
      iconAnchor:[21,21]
    });
  }
  function stopMarkerIcon(label){
    return L.divIcon({
      className:"",
      html:`<div class="v112-stop-marker">${esc(label)}</div>`,
      iconSize:[26,26],
      iconAnchor:[13,13]
    });
  }
  function ensureDriverLiveMap(){
    if(typeof L==="undefined") return null;
    const el=document.getElementById("v112-driver-map");
    if(!el) return null;
    if(state.maps.driverlive) return state.maps.driverlive;
    const map=L.map(el,{preferCanvas:true,zoomControl:true}).setView([-23.5505,-46.6333],12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap"}).addTo(map);
    state.maps.driverlive=map;
    state.layers.driverlive=L.layerGroup().addTo(map);
    setTimeout(()=>map.invalidateSize(true),120);
    return map;
  }
  
  function routeOriginCoords(r){
    const candidates=[
      {lat:r?.origem_lat, lon:r?.origem_lon},
      {lat:r?.lat_origem, lon:r?.lon_origem},
      {lat:r?.latitude_origem, lon:r?.longitude_origem},
      {lat:r?.origin_lat, lon:r?.origin_lon}
    ];
    for(const c of candidates){
      if(locOk(c)) return [locLat(c),locLon(c)];
    }
    const origem=norm(r?.origem||"");
    // Origem operacional padrão VESCO: Rua São Leopoldo 92 / Belenzinho.
    if(origem.includes("sao leopoldo") || origem.includes("são leopoldo") || origem.includes("rua sao leopoldo") || origem.includes("rua são leopoldo")){
      return [-23.541652,-46.604720];
    }
    return null;
  }
  function routeStopKey(stop){
    return txt(stop?.pedido || stop?.numero || stop?.id || stop?.pedido_id || stop?.ecom || stop?.numero_ecommerce);
  }
  function routeStopDelivered(r, stop){
    const entregas=r?.entregas || {};
    const keys=[
      routeStopKey(stop), stop?.pedido, stop?.numero, stop?.id, stop?.ecom, stop?.numero_ecommerce
    ].map(txt).filter(Boolean);
    const found=Object.keys(entregas).find(k=>keys.some(v=>k===v || k===firebaseSafeId(v) || firebaseSafeId(k)===firebaseSafeId(v)));
    return !!found || !!(stop && (stop.entregue || stop.status_logistica==="Entregue" || stop.entregue_em || stop.data_entrega_realizada));
  }
  function routeDeliveryPoints(r){
    return routeStops(r).map((stop,i)=>{
      const c={lat:stop.lat||stop.latitude,lon:stop.lon||stop.lng||stop.longitude};
      if(!locOk(c)) return null;
      return {
        index:i+1,
        lat:locLat(c),
        lon:locLon(c),
        stop,
        delivered:routeStopDelivered(r,stop)
      };
    }).filter(Boolean);
  }
  function originMarkerIcon(){
    return L.divIcon({
      className:"",
      html:`<div class="v114-origin-marker"><i class="fas fa-warehouse"></i></div>`,
      iconSize:[34,34],
      iconAnchor:[17,17]
    });
  }
  function livePolyline(points, options){
    const clean=(points||[]).filter(p=>Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if(clean.length<2) return null;
    return L.polyline(clean, options||{});
  }

function renderDriverLiveMap(forceFit=false){
    const map=ensureDriverLiveMap();
    if(!map) return false;
    if(!state.layers.driverlive) state.layers.driverlive=L.layerGroup().addTo(map);
    state.layers.driverlive.clearLayers();

    const rows=routeDriverRows();
    const allPts=[];
    let activeDrivers=0;
    let totalTrail=0;
    let deliveredStops=0;
    let totalStops=0;

    rows.forEach((row,idx)=>{
      const r=row.rota||{};
      const current=row.loc||{};
      const currentOk=locOk(current);
      const currentPt=currentOk ? [locLat(current),locLon(current)] : null;
      const originPt=routeOriginCoords(r);
      const trail=percursoPoints(row.locRaw||{});
      const trailPts=trail.map(p=>[p[0],p[1]]);
      totalTrail += trail.length;

      const deliveryPts=routeDeliveryPoints(r);
      totalStops += deliveryPts.length;
      deliveredStops += deliveryPts.filter(p=>p.delivered).length;

      // 1) Origem / ponto de coleta
      if(originPt){
        const origin=L.marker(originPt,{icon:originMarkerIcon(),title:"Ponto de saída"});
        origin.bindPopup(`<b>Ponto de saída</b><br>${esc(r.origem||"Origem da rota")}`);
        origin.addTo(state.layers.driverlive);
        allPts.push(originPt);
      }

      // 2) Todos os pontos de entrega, numerados
      deliveryPts.forEach(p=>{
        const marker=L.marker([p.lat,p.lon],{
          icon:stopMarkerIcon(p.delivered?"✓":String(p.index)),
          title:`Entrega ${p.index}`
        });
        marker.bindPopup(`<b>${p.delivered?"Entregue":"Ponto de entrega"} ${p.index}</b><br>${esc(p.stop.cliente||p.stop.cliente_nome||"Cliente")}<br><small>${esc(p.stop.endereco||p.stop.endereco_completo||"")}</small>`);
        marker.addTo(state.layers.driverlive);
        allPts.push([p.lat,p.lon]);
      });

      // 3) Linha planejada completa: saída -> todos os endereços
      const plannedFull=[
        ...(originPt?[originPt]:[]),
        ...deliveryPts.map(p=>[p.lat,p.lon])
      ];
      const planned=livePolyline(plannedFull,{
        weight:4,
        opacity:.55,
        dashArray:"8 10",
        className:"v112-planned-line"
      });
      if(planned){
        planned.bindPopup(`<b>Rota planejada</b><br>Saída até ${deliveryPts.length} entrega(s).`);
        planned.addTo(state.layers.driverlive);
      }

      // 4) Linha real: saída -> pontos reais enviados -> posição atual
      const realFull=[
        ...(originPt?[originPt]:[]),
        ...trailPts,
        ...(currentPt && (!trailPts.length || String(trailPts[trailPts.length-1])!==String(currentPt))?[currentPt]:[])
      ];
      const realLine=livePolyline(realFull,{
        weight:7,
        opacity:.95,
        className:"v112-live-line"
      });
      if(realLine){
        realLine.bindPopup(`<b>Percurso real ao vivo</b><br>${esc(routeName(r))}<br><small>${trail.length} pontos enviados pelo celular</small>`);
        realLine.addTo(state.layers.driverlive);
        realFull.forEach(pt=>allPts.push(pt));
      }

      // 5) Linha restante: motorista atual -> próximas entregas não concluídas
      const remainingPts=deliveryPts.filter(p=>!p.delivered).map(p=>[p.lat,p.lon]);
      const remainingFull=[
        ...(currentPt?[currentPt]:(realFull.length?[realFull[realFull.length-1]]:[])),
        ...remainingPts
      ];
      const remaining=livePolyline(remainingFull,{
        weight:5,
        opacity:.8,
        dashArray:"5 8",
        className:"v114-remaining-line"
      });
      if(remaining){
        remaining.bindPopup(`<b>Próximas entregas</b><br>${remainingPts.length} ponto(s) restante(s).`);
        remaining.addTo(state.layers.driverlive);
      }

      // 6) Marcador do motorista por cima de tudo
      if(currentOk){
        activeDrivers++;
        const label=txt(r.motorista||"M").slice(0,1).toUpperCase();
        const marker=L.marker(currentPt,{icon:driverMarkerIcon(label),title:`${r.motorista||"Motorista"} ao vivo`});
        marker.bindPopup(`<b>${esc(r.motorista||"Motorista")}</b><br>${esc(routeName(r))}<br><small>${esc(locAgeText(current.updated_at||current.atualizado_em))}</small>`);
        marker.addTo(state.layers.driverlive);

        L.circleMarker(currentPt,{
          radius:18,
          weight:3,
          opacity:.75,
          fillOpacity:.14,
          className:"v112-driver-pulse"
        }).addTo(state.layers.driverlive);

        allPts.push(currentPt);
      }
    });

    const stats=document.getElementById("v112-driver-map-stats");
    if(stats){
      stats.innerHTML=`<span class="${activeDrivers?'ok':'warn'}">${activeDrivers} motorista(s) ao vivo</span><span>${totalTrail} ponto(s) enviados</span><span>${deliveredStops}/${totalStops} entrega(s)</span><span>linha verde = percorrido</span><span>linha laranja = restante</span>`;
    }

    setTimeout(()=>{
      try{
        map.invalidateSize(true);
        if(allPts.length && (forceFit || !state.driverLiveMapFitDone)){
          state.driverLiveMapFitDone=true;
          if(allPts.length===1) map.setView(allPts[0],15);
          else map.fitBounds(L.latLngBounds(allPts).pad(.18),{maxZoom:15});
        }
      }catch(e){}
    },80);
    return true;
  }

  function mostrarMotoristaNoMapa(rotaId){
    state.motoristaTrackingFocus=txt(rotaId);
    const row=routeDriverRows().find(r=>r.rota_id===state.motoristaTrackingFocus);
    renderDriverLiveMap(true);
    const map=state.maps.driverlive;
    if(row && row.loc && locOk(row.loc) && map){
      setTimeout(()=>map.setView([locLat(row.loc),locLon(row.loc)],16),120);
      document.getElementById("v112-driver-map")?.scrollIntoView({behavior:"smooth",block:"center"});
    }else{
      alert("Ainda não há percurso/localização para esta rota. O motorista precisa permitir localização no app.");
    }
  }


  function renderPedidosEmRota(){
    const rows=routeOrdersRows();
    if(!rows.length) return '<div class="v8-empty"><b>Nenhum pedido em rota nesta data.</b><br><small>Ao gerar uma rota, os pedidos aparecem aqui para acompanhamento e confirmação.</small></div>';

    return `<div class="v8-table-wrap"><table class="v8-table v94-route-orders-table">
      <thead><tr><th>Rota</th><th>Parada</th><th>Pedido</th><th>Cliente / endereço</th><th>Status</th><th>Entrega</th><th>Ação</th></tr></thead>
      <tbody>${rows.map(row=>{
        const o=row.order||{};
        const delivered=isDelivered(o);
        const id=esc(row.key || orderKey(o) || number(o));
        const rid=esc(row.rota_id);
        const token=esc(row.token);
        return `<tr class="${delivered?"v94-row-delivered":"v94-row-route"}">
          <td><b>${esc(row.nome_rota)}</b><small>${esc(row.motorista||"—")}</small></td>
          <td><span class="v8-chip blue">${row.parada}</span></td>
          <td>${orderCell(o)}</td>
          <td>${clientCell(o)}</td>
          <td><span class="v8-chip ${delivered?"green":"orange"}">${delivered?"Entregue":"Em rota"}</span></td>
          <td>${delivered?`<span class="v8-chip green">${br(deliveryDate(o)) || "Confirmada"}</span>`:`<span class="v8-chip orange">Pendente</span>`}</td>
          <td>
            <div class="v8-row-actions v94-route-actions">
              <button class="v8-btn secondary" onclick="VescoV8.openMapForRouteOrder('${id}')">Mapa</button>
              ${delivered?`<button class="v8-btn secondary" disabled>Confirmado</button>`:`<button class="v8-btn green" onclick="VescoV8.confirmarEntregaRotaSite('${rid}','${token}','${id}')">Confirmar entrega</button>`}
            </div>
          </td>
        </tr>`;
      }).join("")}</tbody>
    </table></div>`;
  }

  function openMapForRouteOrder(id){
    const row=routeOrdersRows().find(r=>txt(r.key)===txt(id) || txt(number(r.order))===txt(id) || txt(orderKey(r.order))===txt(id));
    const o=row && row.order;
    if(!o){ alert("Pedido não encontrado na rota."); return; }
    const q=(coords(o)?`${coords(o).lat},${coords(o).lon}`:address(o));
    if(!q){ alert("Endereço não disponível."); return; }
    const url=new URL("https://www.google.com/maps/search/");
    url.searchParams.set("api","1");
    url.searchParams.set("query",q);
    window.open(url.toString(),"_blank","noopener");
  }

  async function confirmarEntregaRotaSite(rotaId,token,pedido){
    const row=routeOrdersRows().find(r=>txt(r.rota_id)===txt(rotaId) && (
      txt(r.key)===txt(pedido) || txt(number(r.order))===txt(pedido) || txt(orderKey(r.order))===txt(pedido) || txt(ecom(r.order))===txt(pedido)
    ));
    const o=row && row.order;
    const numero=number(o)||pedido;
    const recebedor=prompt(`Quem recebeu o pedido #${numero}?`);
    if(!txt(recebedor)) return null;
    const documento=prompt("Documento/observação de quem recebeu:") || "";
    const observacao=prompt("Observação da entrega:", "Confirmado pelo painel Vesco") || "Confirmado pelo painel Vesco";

    const nowISO=new Date().toISOString();
    const dataBR=new Date().toLocaleDateString("pt-BR");
    const patch={
      pedido:pedido,
      recebedor,
      documento,
      transportador:"Painel Vesco",
      observacao,
      status_logistica:"Retirado",
      situacao_nome:"Retirado",
      is_delivered:true,
      data_entrega_realizada:dataBR,
      entregue_em:nowISO,
      updated_at:nowISO
    };

    try{
      showLoading(true);

      const rota=(state.rotas||[]).find(r=>routeId(r)===txt(rotaId));
      const keysEntrega=[pedido, numero, orderKey(o), number(o), ecom(o), row?.key]
        .map(txt).filter(Boolean);
      const mainKey=keysEntrega[0] || ("pedido-" + Date.now());

      // Salva entrega na rota no Firebase.
      if(firebaseEnabled()){
        await firebasePut(`vesco_rotas_motorista/${firebaseSafeId(rotaId)}/entregas/${firebaseSafeId(mainKey)}`, patch, 6500);

        // Salva patch em todos os identificadores possíveis do pedido.
        for(const k of [...new Set(keysEntrega)]){
          await firebasePatch(`vesco_operacao/orders/${firebaseSafeId(k)}`, patch, 6500).catch(()=>{});
        }
      }

      // Atualiza estado local imediatamente.
      if(rota){
        rota.entregas=rota.entregas||{};
        rota.entregas[firebaseSafeId(mainKey)]=patch;
        saveLocalRota(rota);
      }
      const all=[...(state.orders||[]),...(state.flex||[])];
      all.forEach(item=>{
        const vals=[orderKey(item),number(item),ecom(item),item.id,item.id_tiny,item.numero,item.numero_ecommerce,item.pedido_key].map(txt).filter(Boolean);
        if(vals.some(v=>keysEntrega.includes(v) || keysEntrega.map(firebaseSafeId).includes(firebaseSafeId(v)))) Object.assign(item,patch);
      });

      showLoading(false);
      renderProntoEnvio();

      // Apps Script em segundo plano, sem travar e sem alertar pedido_nao_encontrado.
      jsonp(API_MAIN,{
        action:"confirmarEntregaMotorista",
        rota:rotaId,
        rota_id:rotaId,
        token,
        pedido:mainKey,
        recebedor,
        documento,
        transportador:"Painel Vesco",
        observacao
      },12000).then(resp=>{
        if(resp && resp.success===false) console.warn("Apps Script não confirmou entrega, mas Firebase confirmou.", resp);
      }).catch(e=>console.warn("Apps Script entrega indisponível; Firebase manteve confirmação.", e.message||e));

      alert("Entrega confirmada no Firebase.");
      return {success:true,firebase:true,patch};
    }catch(e){
      showLoading(false);
      alert("Erro ao confirmar entrega no Firebase: " + (e.message || e));
      return null;
    }
  }

  function renderRotasCriadas(){
    // V10.30: aqui NÃO mostra rotas antigas. Só a data selecionada.
    const rotas=rotasCriadasDaData();
    if(!rotas.length) return '<div class="v8-empty"><b>Nenhuma rota criada nesta data.</b></div>';
    const collapsed=!!state.rotasCriadasCollapsed;
    const visible=collapsed ? rotas.slice(0,3) : rotas;
    const header=rotas.length>3 ? `<div class="v1021-routes-toggle"><span>${collapsed?`Mostrando 3 de ${rotas.length} rota(s)`:`Mostrando ${rotas.length} rota(s)`}</span><button class="v8-btn secondary" onclick="VescoV8.toggleRotasCriadas()">${collapsed?"Ver todas":"Recolher rotas"}</button></div>` : "";
    const rows=visible.map(r=>{
      const app=routeMotoristaLink(r), maps=routeGoogleMapsLink(r), waze=routeWazeLink(r), wa=whatsappRouteLink(r,app);
      if(firebaseEnabled() && !r.__firebaseSaved){ saveRouteFirebase(r).then(res=>{if(res&&res.success){r.__firebaseSaved=true; saveLocalRota(r);}}).catch(()=>{}); }
      return `<div class="v8-route-item"><div><b>${esc(r.nome_rota||r.nome||"Rota")}</b><span>Motorista: ${esc(r.motorista||"—")} • Pedidos: ${routePedidosCount(r)} • ${esc(r.criado_em||r.criadoEm||"")}</span></div><div class="v8-route-actions"><a class="v8-btn" href="${esc(app)}" target="_blank" rel="noopener">App motorista</a><a class="v8-btn secondary" href="${esc(maps)}" target="_blank" rel="noopener">Google Maps</a><a class="v8-btn orange" href="${esc(waze)}" target="_blank" rel="noopener">Waze</a><button type="button" class="v8-btn secondary" data-link="${esc(app)}" onclick="VescoV8.copyRouteLinkDirect(this.dataset.link)">Copiar link</button><a class="v8-btn green" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a></div></div>`;
    }).join("");
    return header + rows + (collapsed && rotas.length>3 ? `<div class="v1021-routes-fade">Rotas da data recolhidas para deixar a tela mais limpa.</div>` : "");
  }
  function toggleRotasCriadas(){
    state.rotasCriadasCollapsed=!state.rotasCriadasCollapsed;
    try{localStorage.setItem("vesco:v1021:rotasCollapsed",state.rotasCriadasCollapsed?"1":"0");}catch(e){}
    renderProntoEnvio();
  }

  async function copyRouteLink(link){
    link=String(link||"").replace(/&amp;/g,"&");
    try{
      if(navigator.clipboard && window.isSecureContext){
        await navigator.clipboard.writeText(link);
        return true;
      }
    }catch(e){}

    try{
      const ta=document.createElement("textarea");
      ta.value=link;
      ta.setAttribute("readonly","");
      ta.style.position="fixed";
      ta.style.top="0";
      ta.style.left="-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const ok=document.execCommand("copy");
      ta.remove();
      if(ok) return true;
    }catch(e){}

    return false;
  }

  async function copyRouteLinkDirect(link){
    link=String(link||"").replace(/&amp;/g,"&");
    const ok=await copyRouteLink(link);
    if(ok){
      alert("Link copiado.");
      return true;
    }
    prompt("Copie o link da rota:", link);
    return false;
  }

  function routeShareText(rota, link){
    return `Rota Vesco - ${routeName(rota)}\nMotorista: ${txt(rota.motorista||"—")}\nPedidos: ${routePedidosCount(rota)}\n${link}`;
  }

  function whatsappRouteLink(rota, link){
    return "https://wa.me/?text=" + encodeURIComponent(routeShareText(rota, link));
  }

  function getRouteById(id){
    return (state.rotas||[]).find(r=>routeId(r)===txt(id)) || null;
  }

  async function ensureRouteFirebaseSaved(rota){
    if(!rota) return false;
    if(!firebaseEnabled()) return false;
    if(rota.__firebaseSaved) return true;
    const res=await saveRouteFirebase(rota);
    if(res && res.success){
      rota.__firebaseSaved=true;
      saveLocalRota(rota);
      return true;
    }
    return false;
  }

  async function linkForRoute(rota){
    await ensureRouteFirebaseSaved(rota);
    return fastRouteLink(rota,{firebase:!!rota.__firebaseSaved});
  }

  async function copyRouteLinkById(id){
    const rota=getRouteById(id);
    if(!rota){ alert("Rota não encontrada. Atualize o painel."); return false; }
    const link=fastRouteLink(rota,{firebase:!!rota.__firebaseSaved});
    saveRouteFirebase(rota).then(res=>{
      if(res && res.success){ rota.__firebaseSaved=true; saveLocalRota(rota); }
    }).catch(()=>{});
    return copyRouteLinkDirect(link);
  }

  async function openWhatsAppRouteById(id){
    const rota=getRouteById(id);
    if(!rota){ alert("Rota não encontrada. Atualize o painel."); return; }
    const link=fastRouteLink(rota,{firebase:!!rota.__firebaseSaved});
    const wa=whatsappRouteLink(rota, link);
    saveRouteFirebase(rota).then(res=>{
      if(res && res.success){ rota.__firebaseSaved=true; saveLocalRota(rota); }
    }).catch(()=>{});
    window.open(wa, "_blank", "noopener");
  }

  function ensureShareModal(){
    let modal=document.getElementById("v95ShareModal");
    if(!modal){
      modal=document.createElement("div");
      modal.id="v95ShareModal";
      document.body.appendChild(modal);
    }
    return modal;
  }

  function closeShareModal(){
    const modal=document.getElementById("v95ShareModal");
    if(modal) modal.classList.remove("open");
  }

  async function openShareRouteModal(rota, link){
    const modal=ensureShareModal();
    const wa=whatsappRouteLink(rota, link);
    modal.innerHTML=`
      <div class="v95-share-backdrop" onclick="VescoV8.closeShareModal()"></div>
      <section class="v95-share-card">
        <header><div><h3>Compartilhar rota</h3><small>${esc(routeName(rota))} • ${esc(routeId(rota))}</small></div><button onclick="VescoV8.closeShareModal()">×</button></header>
        <div class="v95-share-body">
          <label>Link do motorista<input id="v95ShareInput" class="v8-input" value="${esc(link)}" readonly></label>
          <div class="v95-share-actions">
            <button class="v8-btn" onclick="VescoV8.copyShareInput()">Copiar link</button>
            <a class="v8-btn green" target="_blank" rel="noopener" href="${esc(wa)}">Abrir WhatsApp</a>
            <a class="v8-btn secondary" target="_blank" rel="noopener" href="${esc(link)}">Abrir app</a>
          </div>
          <small class="v95-share-note">O link agora leva Firebase + data fallback. Se o Firebase falhar, o motorista ainda abre a rota.</small>
        </div>
      </section>`;
    modal.classList.add("open");
    setTimeout(()=>{ const inp=document.getElementById("v95ShareInput"); if(inp){inp.focus();inp.select();}},60);
  }

  async function copyShareInput(){
    const inp=document.getElementById("v95ShareInput");
    if(!inp) return;
    inp.focus();
    inp.select();
    inp.setSelectionRange(0, inp.value.length);
    const ok=await copyRouteLink(inp.value);
    if(ok) alert("Link copiado.");
    else prompt("Copie o link:", inp.value);
  }

  async function shareRouteById(id){
    const rota=getRouteById(id);
    if(!rota){ alert("Rota não encontrada. Atualize o painel."); return; }
    const link=await linkForRoute(rota);
    await openShareRouteModal(rota,link);
    const ok=await copyRouteLink(link);
    if(ok) console.log("V10.43: link copiado automaticamente.");
  }


  function renderProntoEnvio(){
    const addedFlex=routeFlexExtras();
    const list=searchFilter(routeReadyList());
    const page=paginationFor(list,"saiu");
    const visibleList=page.items;
    const erpCount=list.filter(o=>txt(o.__rotaSource)==="ERP").length;
    const flexCount=addedFlex.length;
    const sepSource=derivedLists().pronto;
    setPage("Pronto para Envio","Pedidos separados disponíveis para montar rota.");
    const content=document.getElementById("v8Content");
    content.innerHTML=`
      ${(()=>{
        const rs=routeOrdersStats();
        return kpis([
          {label:"Disponíveis",value:String(list.length),small:`${erpCount} ERP + ${flexCount} Flex adicionado(s)`},
          {label:"Separados ERP",value:String(sepSource.length),small:"carregados da separação"},
          {label:"Em rota",value:String(rs.pending),small:`${rs.total} em rotas / ${rs.delivered} entregue(s)`},
          {label:"Valor",value:money(list.reduce((s,o)=>s+value(o),0)),small:"pedidos selecionáveis"}
        ]);
      })()}

      <div class="v8-grid v9-route-grid">
        <div class="v8-card">
          <div class="v8-card-head">
            <div><h3>Criar rota e carregar pedidos separados</h3><small>ERP separado aparece automaticamente; Flex entra somente por número/e-commerce.</small></div>
            <button class="v8-btn secondary" onclick="VescoV8.refresh()">Atualizar</button>
          </div>

          <div class="v8-route-form v9-route-form">
            <input id="v8RotaMotorista" class="v8-input wide" placeholder="Motorista">
            <input id="v8RotaOrigem" class="v8-input wide" placeholder="Ponto de partida" value="Rua São Leopoldo 92">
            <input id="v8RotaNome" class="v8-input wide" placeholder="Nome da rota. Ex: Rota Leste 10:00">
            <button class="v8-btn orange" id="v8SalvarRota">Gerar rota selecionada</button>
          </div>

          <div class="v8-flex-route-add">
            <div>
              <b>Adicionar Flex na rota</b>
              <small>Digite o número do pedido ou e-commerce. O pedido precisa existir na aba Envios Flex validada.</small>
            </div>
            <input id="v8FlexRotaBusca" class="v8-input" placeholder="Ex: 353880 ou 200001...">
            <button class="v8-btn" onclick="VescoV8.addFlexToRouteByCode()">Adicionar Flex</button>
          </div>

          ${addedFlex.length?`<div class="v8-added-flex"><b>Flex adicionados:</b> ${addedFlex.map(o=>`<span class="v8-route-tag">#${esc(number(o))} — ${esc(client(o))} <button onclick="VescoV8.removeFlexFromRoute('${esc(orderKey(o)||number(o)||ecom(o))}')">×</button></span>`).join("")}</div>`:""}

          ${pagerHtml(page)}
          <div class="v8-table-wrap">
            <table class="v8-table">
              <thead><tr><th>Sel</th><th>Tipo</th><th>Pedido</th><th>Cliente / endereço</th><th>Data</th><th>Pagamento</th><th>Status</th><th>Mapa</th></tr></thead>
              <tbody>
                ${visibleList.length?visibleList.map(o=>{
                  const src=txt(o.__rotaSource)==="Flex"?"Flex":"ERP";
                  const id=orderKey(o)||number(o)||ecom(o);
                  const checked=(src==="Flex" || state.routeSelection?.[firebaseSafeId(id)])?"checked":"";
                  return `<tr>
                    <td><input type="checkbox" class="v8-route-check" value="${esc(id)}" ${checked}></td>
                    <td><span class="v8-chip ${src==="Flex"?"orange":"blue"}">${src}</span></td>
                    <td>${orderCell(o)}</td>
                    <td>${clientCell(o)}</td>
                    <td><span class="v8-chip gray">${br(dueDate(o))}</span></td>
                    <td>${pagamentoText(o)?`<span class="v8-chip blue">${esc(pagamentoText(o))}</span>`:"—"}</td>
                    <td><span class="v8-chip ${src==="Flex"?"orange":"green"}">${src==="Flex"?"Flex adicionado":"Pronto para rota"}</span></td>
                    <td><button class="v8-btn" onclick="VescoV8.openMapForOrder('logistica','${esc(number(o)||orderKey(o)||ecom(o))}')">${coords(o)?"Mapa":"Maps"}</button></td>
                  </tr>`;
                }).join(""):`<tr><td colspan="8" class="v8-empty"><b>Nenhum pedido separado disponível.</b><br><small>Conclua a separação para o pedido aparecer aqui. Para Flex, use o campo acima.</small></td></tr>`}
              </tbody>
            </table>
          </div>
          ${pagerHtml(page)}

          <div class="v8-card-head v9-routes-created"><div><h3>Rotas criadas</h3><small>${rotasCriadasDaData().length} rota(s) na data</small></div></div>
          <div class="v8-routes-list">${renderRotasCriadas()}</div>

          <div class="v8-card-head v94-route-orders-head">
            <div><h3>Pedidos em rota / confirmação de entrega</h3><small>Acompanhe o que saiu em rota e confirme pelo site quando necessário.</small></div>
            <button class="v8-btn secondary" onclick="VescoV8.refresh()">Atualizar status</button>
          </div>
          <div class="v94-route-orders">${renderPedidosEmRota()}</div>

          <div class="v8-card-head v106-driver-head">
            <div><h3>Motoristas ao vivo</h3><small>Acompanhe localização e percurso quando o motorista permitir.</small></div>
            <button class="v8-btn secondary" onclick="VescoV8.refreshMotoristasLocalizacao()">Atualizar localização</button>
          </div>
          <div id="v106MotoristasAoVivo" class="v106-driver-live">${safeRenderMotoristasAoVivo()}</div>

          <div class="v112-live-map-card">
            <div class="v112-map-head">
              <div><h3>Acompanhamento ao vivo multipontos</h3><small>Linha ao vivo: saída, motorista, percurso real e todos os pontos de entrega.</small></div>
              <button class="v8-btn secondary" onclick="VescoV8.renderDriverLiveMap(true)">Ajustar mapa</button>
            </div>
            <div id="v112-driver-map" class="v112-driver-map"></div>
            <div id="v112-driver-map-stats" class="v8-map-stats"><span>Aguardando localização</span></div>
          </div>
        </div>

        <div class="v8-card v8-map-card">
          <div class="v8-map-toolbar">
            <div><h3>Mapa da rota</h3><small>Pedidos separados + Flex adicionados</small></div>
            <div class="v8-row-actions"><button class="v8-btn secondary" onclick="VescoV8.openGoogleMapsForList('logistica')">Maps por endereço</button><button class="v8-btn secondary" onclick="VescoV8.renderMap('logistica', true, VescoV8.routeReadyList())">Ajustar</button></div>
          </div>
          <div id="v8-map-logistica" class="v8-map"></div>
          <div id="v8-map-logistica-stats" class="v8-map-stats"></div>
        </div>
      </div>`;
    document.getElementById("v8SalvarRota")?.addEventListener("click",()=>salvarRotaSelecionada());
    document.querySelectorAll(".v8-route-check").forEach(ch=>ch.addEventListener("change",()=>{
      state.routeSelection[firebaseSafeId(ch.value)]=!!ch.checked;
    }));
    document.getElementById("v8FlexRotaBusca")?.addEventListener("keydown",e=>{ if(e.key==="Enter") addFlexToRouteByCode(); });
    scheduleMapAfterIdle("logistica",list,true);

    // V10.32: não liga acompanhamento ao vivo se não houver rota criada nesta data.
    // Isso evita renderizar histórico antigo e melhora a fluidez.
    const dayRoutes=rotasCriadasDaData();
    if(dayRoutes.length && !VESCO_IS_MOBILE_RUNTIME){
      startMotoristaTrackingPolling();
      setTimeout(()=>renderDriverLiveMap(true),250);
    }else if(dayRoutes.length){
      stopMotoristaTrackingPolling();
      const stats=document.getElementById("v112-driver-map-stats");
      if(stats) stats.innerHTML='<span class="warn">Toque em Ajustar mapa para acompanhar ao vivo.</span>';
    }else{
      stopMotoristaTrackingPolling();
      if(document.getElementById("v106MotoristasAoVivo")){
        document.getElementById("v106MotoristasAoVivo").innerHTML='<div class="v8-empty"><b>Nenhuma rota criada hoje para acompanhar.</b></div>';
      }
    }
  }

  
  async function salvarRotaSelecionada(){
    const domPedidos=Array.from(document.querySelectorAll(".v8-route-check:checked")).map(i=>i.value).filter(Boolean);
    const memoryPedidos=routeReadyList().filter(o=>state.routeSelection?.[firebaseSafeId(orderKey(o)||number(o)||ecom(o))]).map(o=>orderKey(o)||number(o)||ecom(o));
    const pedidos=[...new Set(domPedidos.concat(memoryPedidos).map(txt).filter(Boolean))];
    if(!pedidos.length){ alert("Selecione ao menos 1 pedido."); return; }
    const pedidosSet=new Set(pedidos.map(x=>String(x).replace(/^#/,"")));
    const selecionados=routeReadyList().filter(o=>{
      const vals=[orderKey(o),number(o),ecom(o),o.id,o.id_tiny,o.numero,o.numero_ecommerce].map(txt).filter(Boolean).map(v=>v.replace(/^#/,""));
      return vals.some(v=>pedidosSet.has(v));
    });
    const paradas=selecionados.map(o=>{
      const c=coords(o);
      const src=txt(o.__rotaSource)==="Flex"?"Flex":"ERP";
      return {
        pedido:number(o)||orderKey(o)||ecom(o),
        id:orderKey(o)||number(o)||ecom(o),
        ecom:ecom(o),
        cliente:client(o),
        endereco:address(o),
        lat:c?c.lat:"",
        lon:c?c.lon:"",
        tipo:src,
        is_flex:src==="Flex",
        valor:value(o),
        conta:txt(pick(o,["conta","loja","store_name"]))
      };
    });
    const motorista=txt(document.getElementById("v8RotaMotorista")?.value);
    const origem=txt(document.getElementById("v8RotaOrigem")?.value)||"Rua São Leopoldo 92";
    const nome=txt(document.getElementById("v8RotaNome")?.value)||("Rota " + br(state.date));
    const rotaId="rota-" + Date.now();
    const token=(crypto && crypto.randomUUID ? crypto.randomUUID().replace(/-/g,"").slice(0,24) : (Math.random().toString(36).slice(2)+Date.now().toString(36))).slice(0,24);
    const rotaLocal={
      rota_id:rotaId,
      id:rotaId,
      token,
      motorista,
      origem,
      nome_rota:nome,
      nome:nome,
      pedidos,
      pedidos_json:JSON.stringify(pedidos),
      paradas,
      paradas_json:JSON.stringify(paradas),
      status:"ativa",
      dataISO:state.date,
      criado_em:new Date().toISOString(),
      __local:true
    };

    try{
      showLoading(true);

      saveLocalRota(rotaLocal);
      state.rotas=mergeRotas([rotaLocal].concat(state.rotas||[]));
      pedidos.forEach(id=>delete state.routeSelection[firebaseSafeId(id)]);
      invalidatePerfCaches();

      const fb=await saveRouteFirebase(rotaLocal);
      if(fb.success){
        rotaLocal.__firebaseSaved=true;
        saveLocalRota(rotaLocal);
        state.rotas=mergeRotas([rotaLocal].concat(state.rotas||[]));
      }

      const link=fastRouteLink(rotaLocal,{firebase:!!rotaLocal.__firebaseSaved});
      showLoading(false);
      renderProntoEnvio();
      await openShareRouteModal(rotaLocal, link);

      jsonp(API_MAIN,{
        action:"criarRotaMotorista",
        dataISO:state.date,
        rota:rotaId,
        rota_id:rotaId,
        token,
        motorista,
        origem,
        nome_rota:nome,
        pedidos_json:JSON.stringify(pedidos),
        pedidos:JSON.stringify(pedidos),
        paradas_json:JSON.stringify(paradas),
        paradas:JSON.stringify(paradas)
      },18000).then(resp=>{
        if(resp && resp.success!==false) console.log("V9.5: rota também registrada no Apps Script.", resp);
        else console.warn("V9.5: Apps Script não confirmou rota; Firebase/local mantêm o link.", resp);
      }).catch(e=>console.warn("V9.5: Apps Script lento/indisponível; rota salva por Firebase/local.", e.message||e));

    }catch(e){
      showLoading(false);
      alert("Erro ao gerar rota: " + (e.message||e));
    }
  }
  async function updateStatus(id,statusNovo){
    // V10.43: status instantâneo no Firebase com operador e horário real de separação.
    try{
      const op=operadorAtual(true);
      const nowISO=new Date().toISOString();
      const st=norm(statusNovo);
      const o=findOrderByAnyId(id)||{};
      const patch={
        status_logistica:statusNovo,
        operador_ultima_alteracao:op,
        operador:op,
        status_atualizado_em:nowISO,
        atualizado_em:nowISO
      };

      if(st.includes("em separacao") || st.includes("em separação")){
        patch.separacao_inicio_em=nowISO;
        patch.inicio_separacao_em=nowISO;
        patch.hora_inicio=nowISO;
        patch.operador_inicio_separacao=op;
        patch.operador_inicio=op;
      }

      if(st.includes("separado") || st.includes("pronto")){
        const inicio=sepStartTime(o);
        patch.separacao_fim_em=nowISO;
        patch.fim_separacao_em=nowISO;
        patch.conclusao_separacao_em=nowISO;
        patch.hora_conclusao=nowISO;
        patch.separado_em=nowISO;
        patch.operador_conclusao_separacao=op;
        patch.operador_separado=op;
        patch.operador_fim=op;
        if(inicio){
          const a=Date.parse(inicio), b=Date.parse(nowISO);
          if(Number.isFinite(a)&&Number.isFinite(b)&&b>=a){
            patch.tempo_separacao_minutos=Math.round((b-a)/60000);
            patch.tempo_separacao=patch.tempo_separacao_minutos<60?`${patch.tempo_separacao_minutos} min`:`${Math.floor(patch.tempo_separacao_minutos/60)}h ${patch.tempo_separacao_minutos%60}min`;
          }
        }
      }

      if(st.includes("retirado") || st.includes("retirada")){
        patch.status_logistica="Retirado";
        patch.situacao_nome="Retirado";
        patch.tipo_finalizacao="Retirada";
        patch.retirada_confirmada=true;
        patch.is_delivered=true;
        patch.data_entrega_realizada=new Date().toLocaleDateString("pt-BR");
        patch.retirado_em=nowISO;
        patch.entregue_em=nowISO;
        patch.operador_retirada=op;
        patch.operador_entrega=op;
        patch.finalizado_por=op;
        patch.entregue_por=op;
      }else if(st.includes("entregue")){
        patch.status_logistica="Entregue";
        patch.situacao_nome="Entregue";
        patch.tipo_finalizacao="Entrega";
        patch.is_delivered=true;
        patch.data_entrega_realizada=new Date().toLocaleDateString("pt-BR");
        patch.entregue_em=nowISO;
        patch.operador_entrega=op;
        patch.finalizado_por=op;
        patch.entregue_por=op;
      }

      await firebasePatchOrder(id,patch);
      render();

      jsonp(API_MAIN,Object.assign({action:"updateStatus",id,status:statusNovo,operador:op},patch),12000)
        .then(resp=>{
          if(resp && resp.success===false) console.warn("Apps Script updateStatus retornou erro, Firebase manteve alteração.", resp);
        })
        .catch(e=>console.warn("Apps Script updateStatus indisponível; Firebase manteve alteração.", e.message||e));

      return {success:true,firebase:true,patch};
    }catch(e){
      alert("Erro ao atualizar status no Firebase: " + (e.message||e));
      return {success:false,error:e.message||String(e)};
    }
  }


  function mergeTextUniqueV1027(){
    const parts=[...arguments].map(txt).filter(Boolean);
    const seen=new Set();
    const out=[];
    parts.forEach(p=>{
      const k=norm(p);
      if(!k || seen.has(k)) return;
      seen.add(k);
      out.push(p);
    });
    return out.join(" | ");
  }
  function updateLocalOrderPatchV1027(id,patch){
    const all=[...(state.orders||[]),...(state.flex||[])];
    const key=firebaseSafeId(id);
    all.forEach(o=>{
      const vals=[orderKey(o),number(o),ecom(o),o.id,o.id_tiny,o.numero,o.numero_ecommerce,o.pedido_key,o.pedido].map(txt).filter(Boolean);
      if(vals.some(v=>v===txt(id)||firebaseSafeId(v)===key)) Object.assign(o,patch||{});
    });
    saveLocalSnapshot(snapshotFromState());
  }
  function setModalOpenV1027(open){
    document.body.classList.toggle("v1027-modal-open", !!open);
  }
  async function persistPedidoPatchV1027(id,patch,opts={}){
    const finalPatch=Object.assign({},patch||{}, {updated_at:new Date().toISOString()});
    try{ await firebasePatchOrder(id,finalPatch); }
    catch(e){ console.warn("V10.43: Firebase patch falhou", e.message||e); updateLocalOrderPatchV1027(id,finalPatch); }

    // Não bloqueia a UI aguardando Apps Script/EasyPanel. O operador vê a mudança na hora.
    setTimeout(()=>{
      try{
        if(opts.appsScriptExtras){
          jsonp(API_MAIN,Object.assign({action:"updatePedidoExtras", id}, opts.appsScriptExtras),16000)
            .catch(e=>console.warn("V10.43: extras Apps Script em segundo plano falhou", e.message||e));
        }
        if(opts.appsScriptStatus){
          jsonp(API_MAIN,Object.assign({action:"updateStatus", id}, opts.appsScriptStatus),16000)
            .catch(e=>console.warn("V10.43: status Apps Script em segundo plano falhou", e.message||e));
        }
      }catch(e){}
    },80);
    return finalPatch;
  }

  function ensureV92Modal(){
    let modal=document.getElementById("v92PedidoModal");
    if(!modal){
      modal=document.createElement("div");
      modal.id="v92PedidoModal";
      document.body.appendChild(modal);
    }
    return modal;
  }
  function fecharPedidoModal(){
    const modal=document.getElementById("v92PedidoModal");
    if(modal) modal.classList.remove("open");
    setModalOpenV1027(false);
  }
  function abrirRelatorioPendencia(id){
    const o=findOrderByAnyId(id)||{};
    const modal=ensureV92Modal();
    const operador=currentOperator();
    const link=linkPedido(o);
    const obs=obsPedido(o);
    const pend=pendenciaTexto(o);
    modal.innerHTML=`
      <div class="v92-modal-backdrop" onclick="VescoV8.fecharPedidoModal()"></div>
      <section class="v92-modal-card" role="dialog" aria-modal="true">
        <header>
          <div><h3>Relatório de pendência</h3><small>#${esc(number(o)||id)} — ${esc(client(o)||"Pedido")}</small></div>
          <button onclick="VescoV8.fecharPedidoModal()">×</button>
        </header>
        <div class="v92-modal-body">
          <label>Operador que registrou<input id="v92_modal_operador" class="v8-input" value="${esc(operador)}" placeholder="Nome do operador"></label>
          <label>Tipo da pendência
            <select id="v92_modal_tipo" class="v8-input">
              <option>Produto faltante</option>
              <option>Produto avariado</option>
              <option>Divergência de quantidade</option>
              <option>Sem estoque</option>
              <option>Produto errado</option>
              <option>Outro</option>
            </select>
          </label>
          <label>Qual é a pendência?<textarea id="v92_modal_pendencia" class="v8-input v92-textarea" placeholder="Ex: faltou 1 Sanlimp 5L">${esc(pend)}</textarea></label>
          <label>Observação para o separador<textarea id="v92_modal_obs" class="v8-input v92-textarea" placeholder="Aparece como aviso abaixo do endereço">${esc(obs)}</textarea></label>
          <label>Link do pedido<input id="v92_modal_link" class="v8-input" value="${esc(link)}" placeholder="Cole o link do pedido"></label>
        </div>
        <footer>
          <button class="v8-btn secondary" onclick="VescoV8.fecharPedidoModal()">Cancelar</button>
          <button class="v8-btn orange" onclick="VescoV8.salvarRelatorioPendencia('${esc(id)}')">Salvar pendência</button>
        </footer>
      </section>`;
    modal.classList.add("open");
    setModalOpenV1027(true);
    setTimeout(()=>document.getElementById("v92_modal_pendencia")?.focus(),120);
  }

  function abrirObsLinkPedido(id){
    const o=findOrderByAnyId(id)||{};
    const modal=ensureV92Modal();
    modal.innerHTML=`
      <div class="v92-modal-backdrop" onclick="VescoV8.fecharPedidoModal()"></div>
      <section class="v92-modal-card" role="dialog" aria-modal="true">
        <header>
          <div><h3>Observação e link do pedido</h3><small>#${esc(number(o)||id)} — ${esc(client(o)||"Pedido")}</small></div>
          <button onclick="VescoV8.fecharPedidoModal()">×</button>
        </header>
        <div class="v92-modal-body">
          <label>Observação para o separador<textarea id="v92_modal_obs" class="v8-input v92-textarea" placeholder="Aparece abaixo do endereço como aviso">${esc(obsPedido(o))}</textarea></label>
          <label>Link do pedido<input id="v92_modal_link" class="v8-input" value="${esc(linkPedido(o))}" placeholder="Cole o link do pedido"></label>
        </div>
        <footer>
          <button class="v8-btn secondary" onclick="VescoV8.fecharPedidoModal()">Cancelar</button>
          <button class="v8-btn" onclick="VescoV8.salvarObsLinkPedido('${esc(id)}')">Salvar obs/link</button>
        </footer>
      </section>`;
    modal.classList.add("open");
    setModalOpenV1027(true);
    setTimeout(()=>document.getElementById("v92_modal_obs")?.focus(),120);
  }

  async function salvarObsLinkPedido(id){
    const obs=txt(document.getElementById("v92_modal_obs")?.value);
    const link=txt(document.getElementById("v92_modal_link")?.value);
    const o=findOrderByAnyId(id)||{};
    const patch={
      observacao_pedido:obs,
      observacao_logistica:mergeTextUniqueV1027(o.observacao_logistica, obs ? "[Obs pedido] " + obs : ""),
      link_pedido:link
    };
    try{
      showLoading(true);
      await persistPedidoPatchV1027(id,patch,{appsScriptExtras:{observacao_pedido:obs,observacao:obs,link_pedido:link,link}});
      showLoading(false);
      fecharPedidoModal();
      renderSeparacao();
      updateBadges();
      return {success:true,firebase:true,patch};
    }catch(e){
      showLoading(false);
      alert("Erro ao salvar observação/link: " + (e.message||e));
      return null;
    }
  }

  async function salvarRelatorioPendencia(id){
    const operador=txt(document.getElementById("v92_modal_operador")?.value);
    const tipo=txt(document.getElementById("v92_modal_tipo")?.value);
    const pend=txt(document.getElementById("v92_modal_pendencia")?.value);
    const obs=txt(document.getElementById("v92_modal_obs")?.value);
    const link=txt(document.getElementById("v92_modal_link")?.value);
    if(!operador){ alert("Informe o operador que está registrando a pendência."); return null; }
    if(!pend){ alert("Informe qual é a pendência."); return null; }
    localStorage.setItem("vesco:v9:operador_pendencia", operador);
    const o=findOrderByAnyId(id)||{};
    const relatorio=`[Pendência de produto] Operador: ${operador} | Tipo: ${tipo} | Pendência: ${pend}${obs ? " | Obs: " + obs : ""}`;
    const patch={
      status_logistica:"Pendência de produto",
      situacao_nome:"Pendência de produto",
      pendencia_produto:pend,
      produto_pendente:true,
      tipo_pendencia:tipo,
      operador_pendencia:operador,
      pendencia_em:new Date().toISOString(),
      observacao_pedido:relatorio,
      observacao_logistica:mergeTextUniqueV1027(o.observacao_logistica, relatorio),
      link_pedido:link
    };
    try{
      showLoading(true);
      await persistPedidoPatchV1027(id,patch,{
        appsScriptExtras:{observacao_pedido:relatorio,observacao:relatorio,link_pedido:link,link,pendencia_produto:pend,operador_pendencia:operador,tipo_pendencia:tipo},
        appsScriptStatus:{status:"Pendência de produto",operador}
      });
      showLoading(false);
      fecharPedidoModal();
      renderSeparacao();
      updateBadges();
      return {success:true,firebase:true,patch};
    }catch(e){
      showLoading(false);
      alert("Erro ao registrar pendência: " + (e.message||e));
      return null;
    }
  }

  async function salvarDetalhesPedido(id,did){
    return abrirObsLinkPedido(id);
  }

  async function marcarPendenciaProduto(id,did){
    return abrirRelatorioPendencia(id);
  }

  async function resolverPendenciaProduto(id){
    const operador=prompt("Operador que resolveu a pendência:", currentOperator()) || currentOperator();
    const obs=prompt("Descreva rapidamente como a pendência foi resolvida:", "Pendência resolvida") || "Pendência resolvida";
    localStorage.setItem("vesco:v9:operador_pendencia", operador);
    const o=findOrderByAnyId(id)||{};
    const texto=`[Pendência resolvida] Operador: ${operador} | ${obs}`;
    const patch={
      status_logistica:"A Separar",
      situacao_nome:"A Separar",
      pendencia_produto:"",
      produto_pendente:false,
      tipo_pendencia:"",
      operador_pendencia:operador,
      pendencia_resolvida_em:new Date().toISOString(),
      observacao_pedido:texto,
      observacao_logistica:mergeTextUniqueV1027(o.observacao_logistica, texto)
    };
    try{
      showLoading(true);
      await persistPedidoPatchV1027(id,patch,{
        appsScriptExtras:{observacao_pedido:texto,observacao:texto,pendencia_produto:"",operador_pendencia:operador},
        appsScriptStatus:{status:"A Separar",operador}
      });
      showLoading(false);
      renderSeparacao();
      updateBadges();
      return {success:true,firebase:true,patch};
    }catch(e){
      showLoading(false);
      alert("Erro ao resolver pendência: " + (e.message||e));
      return null;
    }
  }

  function renderRetiradas(){ const list=searchFilter(derivedLists().retiradas); tablePage({title:"Retiradas / sem rota",sub:"Se não houver pedidos nesta regra, o contador fica zerado.",kpi:[{label:"Total",value:String(list.length),small:"retirada ou sem endereço"},{label:"Retirada",value:String(list.filter(o=>o.is_retirada).length),small:"forma retirada"},{label:"Sem endereço",value:String(list.filter(o=>!o.has_address).length),small:"precisa corrigir"},{label:"Valor",value:money(list.reduce((s,o)=>s+value(o),0)),small:"pedidos sem rota"}],list,empty:"Nenhum pedido para retirada ou sem rota.",columns:[{h:"Pedido",render:orderCell},{h:"Cliente",render:clientCell},{h:"Motivo",render:o=>`${o.is_retirada?'<span class="v8-chip green">Retirada</span>':''} ${!o.has_address?'<span class="v8-chip orange">Sem endereço</span>':''}`},{h:"Data",render:o=>`<span class="v8-chip gray">${br(dueDate(o))}</span>`},{h:"Status",render:o=>esc(status(o)||"Pendente")},{h:"Ação",render:o=>`<div class="v1021-action-stack"><button class="v8-btn green" onclick="VescoV8.marcarRetirada('${esc(orderKey(o)||number(o))}')">Registrar</button></div>`}]}); updateBadges(); }
  function renderEntregues(){
    if(!state.__loadingEntreguesDirect){
      state.__loadingEntreguesDirect=true;
      setTimeout(()=>loadDeliveredFromFirebaseRoutes().then(rows=>{
        if(rows && rows.length) renderEntregues();
      }).catch(()=>{}).finally(()=>{state.__loadingEntreguesDirect=false;}),250);
    }
    const list=searchFilter(derivedLists().entregues);
    tablePage({
      title:"Entregues / Retirados",
      sub:"Pedidos finalizados com data real na data selecionada.",
      kpi:[
        {label:"Finalizados hoje",value:String(list.length),small:br(state.date)},
        {label:"Retirados",value:String(list.filter(o=>o.retirada_confirmada || pick(o,["tipo_finalizacao"])==="Retirada" || o.is_retirada).length),small:"cliente retirou"},
        {label:"Valor",value:money(list.reduce((s,o)=>s+value(o),0)),small:"entregas/retiradas"},
        {label:"Com recebedor",value:String(list.filter(o=>txt(pick(o,["recebedor","nome_recebedor","recebido_por"]))).length),small:"documentado"}
      ],
      list,
      empty:"Nenhuma entrega ou retirada finalizada nessa data.",
      columns:[
        {h:"Pedido",render:orderCell},
        {h:"Cliente / endereço",render:clientCell},
        {h:"Tipo",render:o=>`<span class="v8-chip ${o.retirada_confirmada || pick(o,["tipo_finalizacao"])==="Retirada" || o.is_retirada?"orange":"green"}">${o.retirada_confirmada || pick(o,["tipo_finalizacao"])==="Retirada" || o.is_retirada?"Retirada":"Entrega"}</span>`},
        {h:"Data",render:o=>`<span class="v8-chip green">${br(deliveryDate(o))}</span>`},
        {h:"Recebedor",render:o=>`${esc(pick(o,["recebedor","nome_recebedor","recebido_por"])||"—")}<br><small>Por: ${esc(finalizadoPor(o))}</small>`},
        {h:"Rota / motorista",render:o=>`<small>${esc(rotaFinalizacao(o))}</small>`},
        {h:"Status",render:o=>`<span class="v8-chip ${isRetirada(o) || isRetiradaFinalizada(o)?"orange":"green"}">${esc(isRetirada(o) || isRetiradaFinalizada(o)?"Retirado":(status(o)||"Entregue"))}</span>`},
        {h:"Valor",render:o=>money(value(o))}
      ]
    });
  }

  function scheduleMapAfterIdle(type,listOverride=null,forceFit=true){
    const expectedTab=state.tab;
    const run=()=>{
      if(document.hidden || state.tab!==expectedTab) return;
      try{ renderMap(type,forceFit,listOverride); }
      catch(e){ console.warn("V10.56: mapa não bloqueou a tela",e.message||e); }
    };
    if(VESCO_IS_MOBILE_RUNTIME){
      // No celular o mapa é carregado pelo botão Ajustar/Mapa. Isso evita Leaflet e geocode
      // competindo com o primeiro toque da troca de tela.
      const stats=document.getElementById(`v8-map-${type}-stats`);
      if(stats) stats.innerHTML='<span class="ok">Mapa pronto para abrir</span><span>Toque em Ajustar ou no botão Mapa de um pedido.</span>';
      return;
    }
    run();
  }

  function renderLogistica(){
    const list=searchFilter(derivedLists().logistica);
    const page=paginationFor(list,"logistica",responsiveMapPageSize());
    const tableList=page.items;
    const plotted=list.filter(coords);
    setPage("Logística ERP","Apenas ERP não entregue, com endereço e fora de retirada/Flex.");
    document.getElementById("v8Content").innerHTML=`
      <div class="v8-page-head">
        <div><h3 class="v8-section-title">Entregas ERP pendentes</h3><p>Pedido entregue sai daqui. Pedido atrasado continua até concluir.</p></div>
        <button class="v8-btn" onclick="VescoV8.renderMap('logistica', true)">Ajustar mapa</button>
      </div>
      ${kpis([
        {label:"A entregar",value:String(list.length),small:"ERP pendente"},
        {label:"No mapa",value:String(plotted.length),small:"com lat/lon"},
        {label:"Atrasados",value:String(list.filter(o=>dueDate(o)&&dueDate(o)<state.date).length),small:"data anterior não entregue"},
        {label:"Valor aberto",value:money(list.reduce((s,o)=>s+value(o),0)),small:"pedidos visíveis"}
      ])}
      <div class="v8-grid">
        <div class="v8-card">
          <div class="v8-card-head"><div><h3>Pedidos ERP para entrega</h3><small>${list.length} pedido(s)${list.length?` • exibindo ${page.start+1}-${page.end}`:""}</small></div></div>${pagerHtml(page)}
          <div class="v8-table-wrap"><table class="v8-table"><thead><tr><th>Pedido</th><th>Cliente / endereço</th><th>Data</th><th>Status</th><th>Valor</th><th>Ação</th></tr></thead><tbody>${tableList.length?tableList.map(o=>{const id=esc(orderKey(o)||number(o)); return `<tr><td>${orderCell(o)} ${dueDate(o)&&dueDate(o)<state.date?'<span class="v8-chip red">Atrasado</span>':'<span class="v8-chip green">Do dia</span>'}</td><td>${clientCell(o)}</td><td><span class="v8-chip gray">${br(dueDate(o))}</span></td><td>${esc(status(o)||"Pendente")}</td><td>${money(value(o))}</td><td><div class="v1021-action-stack"><button class="v8-btn secondary" onclick="VescoV8.abrirPedidoNoMapa('${id}','logistica')">Mapa</button><button class="v8-btn orange" onclick="VescoV8.marcarComoRetirada('${id}')">É retirada</button><button class="v8-btn green" onclick="VescoV8.updateStatus('${id}','Entregue')">Entregue</button></div></td></tr>`;}).join(""):`<tr><td colspan="6" class="v8-empty"><b>Nenhum ERP pendente para entrega.</b></td></tr>`}</tbody></table></div>${pagerHtml(page)}
        </div>
        <div class="v8-card v8-map-card">
          <div class="v8-map-toolbar"><div><h3>Mapa ERP</h3><small>Somente pedidos da lista</small></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="v8-btn secondary" onclick="VescoV8.gerarPingsMapa('logistica')">Localizar endereços</button><button class="v8-btn secondary" onclick="VescoV8.renderMap('logistica', true)">Ajustar</button></div></div>
          <div id="v8-map-logistica" class="v8-map"></div><div id="v8-map-logistica-stats" class="v8-map-stats"></div>
        </div>
      </div>`;
    scheduleMapAfterIdle("logistica",list,true);
  }

  
  function renderFlexMonthBars(){
    const months=groupByMonth(flexArchiveAll());
    const max=Math.max(1,...months.map(m=>m.count));
    const current=state.month || state.date.slice(0,7);
    if(!months.length) return `<div class="v8-card v8-flex-chart"><div class="v8-card-head"><div><h3>Gráfico mensal Flex</h3><small>Sem histórico salvo ainda</small></div></div><div class="v8-empty">Clique em Atualizar Flex para armazenar o mês atual.</div></div>`;
    return `<div class="v8-card v8-flex-chart"><div class="v8-card-head"><div><h3>Gráfico mensal Flex</h3><small>Quantidade e valor por mês armazenado</small></div><button class="v8-btn secondary" onclick="VescoV8.saveFlexMonthNow()">Armazenar mês atual</button></div><div class="v8-bars">${months.map(m=>{
      const pct=Math.max(4,Math.round((m.count/max)*100));
      return `<button class="v8-bar-row ${m.month===current?"active":""}" onclick="VescoV8.openFlexMonth('${esc(m.month)}')"><span>${esc(monthLabel(m.month))}</span><div><i style="width:${pct}%"></i></div><b>${m.count}</b><small>${money(m.value)}</small></button>`;
    }).join("")}</div></div>`;
  }
  function renderFlexContas(list){
    const contas={};
    list.forEach(o=>{
      const c=txt(pick(o,["conta","loja","store_name"]))||"Sem conta";
      if(!contas[c]) contas[c]={count:0,value:0,coords:0,semCoords:0};
      contas[c].count++;
      contas[c].value+=value(o);
      if(coords(o)) contas[c].coords++; else contas[c].semCoords++;
    });
    const rows=Object.entries(contas).sort((a,b)=>b[1].count-a[1].count);
    if(!rows.length) return "";
    return `<div class="v8-card v8-flex-contas"><div class="v8-card-head"><div><h3>Flex por conta</h3><small>${rows.length} conta(s)</small></div></div><div class="v8-mini-grid">${rows.map(([nome,d])=>`<div class="v8-mini"><span>${esc(nome)}</span><b>${d.count}</b><small>${money(d.value)} • ${d.coords} no mapa • ${d.semCoords} sem coord.</small></div>`).join("")}</div></div>`;
  }
  
  async function runFlexGeocode(){
    if(!confirm("Rodar coordenadas dos Flex agora? Isso processa em lote no Apps Script e pode demorar.")) return null;
    try{
      showLoading(true);
      const res=await jsonp(API_FLEX,{action:"geocodificar"},120000);
      showLoading(false);
      const sem = res?.resumo?.sem_coordenada ?? res?.status?.sem_coordenada ?? res?.sem_coordenada ?? "?";
      const com = res?.resumo?.com_coordenada ?? res?.status?.com_coordenada ?? res?.com_coordenada ?? "?";
      alert(`Geocode Flex: ${res?.ok||0} OK, ${res?.falha||0} falha(s). Com coordenada: ${com}. Sem coordenada: ${sem}.`);
      await loadData(true);
      renderFlex();
      return res;
    }catch(e){
      showLoading(false);
      alert("Não consegui rodar o geocode agora: " + e.message + ". Rode geocodificarFlexV859() direto no Apps Script.");
      return null;
    }
  }

  async function statusFlexGeocode(){
    try{
      const res=await jsonp(API_FLEX,{action:"statusGeocode"},60000);
      alert(`Coordenadas Flex\\nTotal validado: ${res?.total_validado||0}\\nCom coordenada: ${res?.com_coordenada||0}\\nSem coordenada: ${res?.sem_coordenada||0}`);
      return res;
    }catch(e){
      alert("Erro ao consultar status de coordenadas: " + e.message);
      return null;
    }
  }

  function renderFlex(){
    const list=searchFilter(derivedLists().flex);
    const page=paginationFor(list,"flex",responsiveMapPageSize());
    const tableList=page.items;
    const plotted=list.filter(coords);
    const month=state.month || state.date.slice(0,7);
    const storedCount=readStoredFlex(month).length;
    setPage("Envios Flex","");
    document.getElementById("v8Content").innerHTML=
      `<div class="v8-page-head"><div><h3 class="v8-section-title">Controle Flex mensal</h3></div><div class="v8-flex-actions"><button class="v8-btn secondary" onclick="VescoV8.saveFlexMonthNow()">Armazenar mês</button><button class="v8-btn secondary" onclick="VescoV8.clearFlexStorage()">Limpar armazenamento</button><button class="v8-btn" onclick="VescoV8.refreshFlexOnly()">Atualizar Flex</button><button class="v8-btn secondary" onclick="VescoV8.runFlexGeocode()">Rodar coordenadas</button><button class="v8-btn secondary" onclick="VescoV8.statusFlexGeocode()">Status coordenadas</button><button class="v8-btn secondary" onclick="VescoV8.openGoogleMapsForList('flex')">Maps por endereço</button><button class="v8-btn orange" onclick="VescoV8.renderMap('flex', true)">Ajustar mapa</button></div></div>`+
      kpis([
        {label:"Flex do mês",value:String(list.length),small:monthLabel(month)},
        {label:"No mapa",value:String(plotted.length),small:"com lat/lon"},
        {label:"Sem coordenada",value:String(list.length-plotted.length),small:"rodar enriquecimento"},
        {label:"Valor Flex",value:money(list.reduce((s,o)=>s+value(o),0)),small:"pedidos visíveis"},
        {label:"Armazenados",value:String(storedCount),small:"local deste mês"}
      ])+
      `<div class="v8-flex-layout">${renderFlexMonthBars()}${renderFlexContas(list)}</div>`+
      `<div class="v8-grid"><div class="v8-card"><div class="v8-card-head"><div><h3>Pedidos Flex</h3><small>${list.length} pedido(s)${list.length?` • exibindo ${page.start+1}-${page.end}`:""}</small></div><div class="v8-card-actions"><button class="v8-btn secondary" onclick="VescoV8.openFlexMonth('${esc(month)}')">Recarregar mês</button></div></div>${pagerHtml(page)}<div class="v8-table-wrap"><table class="v8-table"><thead><tr><th>Pedido/E-com</th><th>Destinatário</th><th>Produtos</th><th>Data</th><th>Valor</th><th>Conta</th><th>Status</th><th>Ação</th></tr></thead><tbody>${tableList.length?tableList.map(o=>`<tr><td>${orderCell(o)}</td><td>${clientCell(o)}</td><td>${produtoHtml(o)}</td><td><span class="v8-chip gray">${br(dueDate(o))}</span></td><td>${money(value(o))}</td><td><span class="v8-chip blue">${esc(pick(o,["conta","loja","store_name"])||"Flex")}</span></td><td><span class="v8-chip orange">Flex pendente</span></td><td><button class="v8-btn orange" onclick="VescoV8.openMapForOrder('flex','${esc(number(o)||orderKey(o)||ecom(o))}')">${coords(o)?"Mapa":"Maps"}</button></td></tr>`).join(""):`<tr><td colspan="8" class="v8-empty"><b>Nenhum Flex neste mês.</b></td></tr>`}</tbody></table></div>${pagerHtml(page)}</div><div class="v8-card v8-map-card"><div class="v8-map-toolbar"><div><h3>Radar Flex</h3><small>Localização progressiva com cache</small></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="v8-btn secondary" onclick="VescoV8.gerarPingsMapa('flex')">Localizar endereços</button><button class="v8-btn secondary" onclick="VescoV8.renderMap('flex', true)">Ajustar</button></div></div><div id="v8-map-flex" class="v8-map"></div><div id="v8-map-flex-stats" class="v8-map-stats"></div></div></div>`;
    scheduleMapAfterIdle("flex",list,true);
  }
  function showLegacy(tab){
    if(tab==="separacao") return renderSeparacao();
    if(tab==="saiu") return renderProntoEnvio();
  }
  

  function renderTarefasFrota(){
    const list=tarefasFrotaList();
    const abertas=list.filter(t=>t.status!=="Concluída");
    const concluidas=list.filter(t=>t.status==="Concluída");
    setPage("Tarefas Frota","Registre tarefas externas da frota fora dos pedidos.");
    document.getElementById("v8Content").innerHTML=`
      <div class="v8-page-head">
        <div><h3 class="v8-section-title">Controle de tarefas externas</h3><p>Campo restaurado para registrar retirada, compra, banco, manutenção ou tarefa externa.</p></div>
        <button class="v8-btn secondary" onclick="VescoV8.renderTarefasFrota()">Atualizar</button>
      </div>
      ${kpis([
        {label:"Em aberto",value:String(abertas.length),small:br(state.date)},
        {label:"Concluídas",value:String(concluidas.length),small:"na data"},
        {label:"Total",value:String(list.length),small:"tarefas do dia"},
        {label:"Fonte",value:"Local",small:"navegador/painel"}
      ])}
      <div class="v8-card">
        <div class="v8-card-head"><div><h3>Registrar nova tarefa externa</h3><small>Não depende de pedido</small></div></div>
        <div class="v8-tarefa-form">
          <label><span>Tipo</span><select id="v8TfTipo" class="v8-input"><option>Retirada (Fornecedor)</option><option>Entrega externa</option><option>Compra</option><option>Manutenção</option><option>Banco / Correios</option><option>Outro</option></select></label>
          <label><span>Local / Empresa</span><input id="v8TfLocal" class="v8-input" placeholder="Ex: Gráfica Brás"></label>
          <label><span>Endereço</span><input id="v8TfEndereco" class="v8-input" placeholder="Rua, número, bairro..."></label>
          <label><span>Motorista & Hora</span><input id="v8TfMotorista" class="v8-input" placeholder="Ex: Carlos - 14:30"></label>
          <button class="v8-btn green" onclick="VescoV8.registrarTarefaFrota()">Registrar saída</button>
        </div>
      </div>
      <div class="v8-card">
        <div class="v8-card-head"><div><h3>Tarefas do dia</h3><small>${list.length} registro(s)</small></div></div>
        <div class="v8-table-wrap">
          <table class="v8-table">
            <thead><tr><th>Tarefa & local</th><th>Endereço</th><th>Motorista & hora</th><th>Status</th><th>Ação</th></tr></thead>
            <tbody>
              ${list.length?list.map(t=>`<tr>
                <td><b>${esc(t.tipo||"Tarefa")}</b><br><small>${esc(t.local||"—")}</small></td>
                <td>${esc(t.endereco||"—")}</td>
                <td>${esc(t.motoristaHora||"—")}</td>
                <td><span class="v8-chip ${t.status==="Concluída"?"green":"orange"}">${esc(t.status||"Em andamento")}</span></td>
                <td><div class="v8-row-actions">${t.status==="Concluída"?"":`<button class="v8-btn green" onclick="VescoV8.concluirTarefaFrota('${esc(t.id)}')">Concluir</button>`}<button class="v8-btn secondary" onclick="VescoV8.removerTarefaFrota('${esc(t.id)}')">Remover</button></div></td>
              </tr>`).join(""):`<tr><td colspan="5" class="v8-empty"><b>Nenhuma tarefa externa em andamento.</b></td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }


  
  function googleMapsSearchUrl(q){
    const url=new URL("https://www.google.com/maps/search/");
    url.searchParams.set("api","1");
    url.searchParams.set("query",txt(q));
    return url.toString();
  }
  function googleMapsDirectionsUrlFromOrders(list, origin="Rua São Leopoldo 92, São Paulo - SP"){
    const stops=(list||[]).map(o=>{
      const c=coords(o);
      if(c) return `${c.lat},${c.lon}`;
      return address(o);
    }).map(txt).filter(Boolean);
    if(!stops.length) return googleMapsSearchUrl(origin);
    if(stops.length===1) return googleMapsSearchUrl(stops[0]);
    const url=new URL("https://www.google.com/maps/dir/");
    url.searchParams.set("api","1");
    url.searchParams.set("origin",origin);
    url.searchParams.set("destination",stops[stops.length-1]);
    if(stops.length>1) url.searchParams.set("waypoints",stops.slice(0,-1).join("|"));
    url.searchParams.set("travelmode","driving");
    return url.toString();
  }
  function listForExternalMaps(type){
    if(type==="flex") return flexList();
    if(type==="logistica") return routeReadyList();
    if(type==="erp"||type==="logistica-erp") return logisticaList();
    return listForMap(type);
  }
  function openGoogleMapsForList(type){
    const list=listForExternalMaps(type).filter(o=>coords(o)||hasAddress(o));
    if(!list.length){ alert("Nenhum endereço disponível para abrir no Google Maps."); return false; }
    window.open(googleMapsDirectionsUrlFromOrders(list), "_blank");
    return true;
  }
  function findOrderForMap(type,id){
    const clean=txt(id).replace(/^#/,"").trim();
    const digits=clean.replace(/\D/g,"");
    const list=listForExternalMaps(type);
    return list.find(o=>{
      const vals=keys(o).concat([number(o),ecom(o),orderKey(o)]).map(txt).filter(Boolean);
      return vals.some(v=>{
        const vv=v.replace(/^#/,"").trim();
        return vv===clean || (digits && vv.replace(/\D/g,"")===digits);
      });
    }) || null;
  }
  function abrirPedidoNoMapa(id,type="logistica"){ return openMapForOrder(type,id); }
  function abrirCorrecaoEndereco(id){
    const o=findOrderByAnyId(id)||findOrderForMap("logistica",id)||findOrderForMap("retiradas",id);
    if(!o){alert("Pedido não encontrado.");return false;}
    const link=linkPedido(o);
    if(link){const href=/^https?:\/\//i.test(link)?link:"https://"+link; window.open(href,"_blank","noopener"); return true;}
    const oid=txt(o.id||o.id_tiny||orderKey(o)||number(o)).replace(/^.*__/,"");
    if(oid){window.open("https://erp.olist.com/vendas#edit/"+encodeURIComponent(oid),"_blank","noopener"); return true;}
    alert("Pedido sem link cadastrado para correção."); return false;
  }
  async function marcarComoRetirada(id){
    const o=findOrderByAnyId(id);
    if(!o){alert("Pedido não encontrado.");return null;}
    if(!confirm("Marcar este pedido como RETIRADA e remover da fila de entrega?")) return null;
    Object.assign(o,{is_retirada:true,tipo_finalizacao:"Retirada",forma_envio_nome:o.forma_envio_nome||"Retirar pessoalmente"});
    await firebasePatchOrder(id,{tipo_finalizacao:"Retirada",forma_envio_nome:"Retirar pessoalmente",is_retirada:true,status_atualizado_em:new Date().toISOString()});
    render();
    return {success:true};
  }
  function openMapForOrder(type,id){
    const o=findOrderForMap(type,id);
    if(!o){ alert("Pedido não encontrado na lista atual."); return false; }
    const c=coords(o);
    if(c){
      return focus(type,id);
    }
    const a=address(o);
    if(a){
      window.open(googleMapsSearchUrl(a), "_blank");
      return true;
    }
    alert("Pedido sem coordenada e sem endereço.");
    return false;
  }

  async function viaCepLookup(cep){
    cep=String(cep||"").replace(/\D/g,"");
    if(cep.length!==8) return null;
    const cached=state.cepCache?.[cep];
    if(cached && Date.now()-Number(cached.ts||0)<2592000000) return cached.erro?null:cached;
    const ctrl=new AbortController(); const timer=setTimeout(()=>ctrl.abort(),5000);
    try{
      const res=await fetch(`https://viacep.com.br/ws/${cep}/json/`,{signal:ctrl.signal,cache:"force-cache"});
      if(!res.ok) return null;
      const data=await res.json();
      state.cepCache[cep]={...data,ts:Date.now()};
      saveLocalJson("vesco:v1050:cepCache",state.cepCache);
      return data && !data.erro ? data : null;
    }catch(e){ return null; }finally{ clearTimeout(timer); }
  }
  function houseNumberFromAddress(a){
    const parts=cleanDisplayAddress(a).split(",").map(x=>x.trim());
    for(let i=1;i<Math.min(parts.length,4);i++){ const m=parts[i].match(/^\d+[A-Za-z\-\/]{0,5}/); if(m) return m[0]; }
    const m=cleanDisplayAddress(a).match(/\b(?:n[ºo.]?\s*)?(\d+[A-Za-z\-\/]{0,5})\b/i);
    return m?m[1]:"";
  }
  async function geocodeAddressViaFlexApi(endereco){
    const a=cleanDisplayAddress(endereco);
    if(!a || a==="—" || a==="-") return null;
    const local=cachedGeoForAddress(a);
    if(local && coordCompatibleWithAddress(a,parseFloat(local.lat),parseFloat(local.lon??local.lng))) return local;

    let candidates=geocodeCandidates(a);
    const cep=extractCep(a);
    if(cep){
      const via=await viaCepLookup(cep);
      if(via){
        const number=houseNumberFromAddress(a);
        const byCep=[via.logradouro,number,via.bairro,via.localidade,via.uf,cep,"Brasil"].filter(Boolean).join(", ");
        candidates=[byCep,...candidates.filter(x=>addressKey(x)!==addressKey(byCep))];
      }
    }
    const cacheKey="v1050:"+candidates.join("||");
    const cached=state.geoCache[cacheKey];
    if(cached && cached.status==="OK" && coordCompatibleWithAddress(a,parseFloat(cached.lat),parseFloat(cached.lon??cached.lng))) return cached;

    for(const q of candidates){
      try{
        const res=await jsonp(API_FLEX,{action:"geocodeEndereco",endereco:q,address:q,original:a,forcar_sp:explicitSaoPauloCity(a)?1:0},12000);
        const out=(res && res.status==="OK")?res:(res?.resultado?.status==="OK"?res.resultado:res);
        const lat=parseFloat(String(out?.lat).replace(",","."));
        const lon=parseFloat(String(out?.lon??out?.lng).replace(",","."));
        if(out && out.status==="OK" && coordCompatibleWithAddress(a,lat,lon)){
          const good={...out,lat,lon,lng:lon,source:out.source||out.provider||"apps_script",query:q,status:"OK"};
          state.geoCache[cacheKey]=good; rememberGeoForAddress(a,good); return good;
        }
      }catch(e){}
    }

    for(const q of candidates.slice(0,2)){
      try{
        const out=await geocodeNominatim(q,a);
        if(out && out.status==="OK"){ state.geoCache[cacheKey]=out; rememberGeoForAddress(a,out); return out; }
      }catch(e){}
    }
    return {status:"ZERO_RESULTS",query:candidates[0]||a,ts:Date.now()};
  }
  function applyGeoToOrder(o, ge){
    if(!o || !ge || ge.status!=="OK") return false;
    const lat=parseFloat(String(ge.lat).replace(",","."));
    const lon=parseFloat(String(ge.lon ?? ge.lng).replace(",","."));
    if(!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    if(!coordCompatibleWithAddress(o,lat,lon)) return false;
    o.lat=lat;
    o.lon=lon;
    o.latitude=lat;
    o.longitude=lon;
    o.geocode_status="OK_AUTO_MAP_V1051";
    o.geocode_source=ge.source||"auto";
    rememberGeoForAddress(address(o),{...ge,lat,lon,status:"OK"});
    return true;
  }
  async function persistGeoPatch(o){
    const id=orderKey(o)||number(o)||o?.id||o?.id_tiny;
    if(!id) return false;
    const patch={
      lat:o.lat,lon:o.lon,latitude:o.lat,longitude:o.lon,
      geocode_status:o.geocode_status||"OK_AUTO_MAP_V1051",
      geocode_source:o.geocode_source||"auto",
      geocode_at:new Date().toISOString()
    };
    try{
      await firebasePatch("vesco_operacao/orders/"+firebaseSafeId(id),patch,6500);
      return true;
    }catch(e){
      console.warn("V10.51: não persistiu coordenada no Firebase",id,e.message||e);
      return false;
    }
  }
  async function gerarPingsMapa(type="logistica"){
    const list=listForMap(type);
    const stats=document.getElementById(`v8-map-${type}-stats`);
    if(stats) stats.innerHTML+=`<span class="warn">Localizando endereços...</span>`;
    const ok=await autoGeocodeMap(type,list,true);
    if(!ok && !list.some(coords)) alert("Ainda não consegui gerar os pings. Confira se os endereços possuem rua, número, cidade e CEP.");
    return ok;
  }

  async function autoGeocodeMap(type,list,force=false){
    const key=`${type}:${state.tab}:${state.date}:${state.month}`;
    if(state.geoAutoRunning[key]) return false;
    const candidates=(list||[]).filter(o=>hasAddress(o) && (force || !coords(o)));
    if(!candidates.length) return false;

    const groups=new Map();
    for(const o of candidates){
      const k=addressKey(address(o));
      if(!k) continue;
      if(!groups.has(k)) groups.set(k,[]);
      groups.get(k).push(o);
    }
    const jobs=[...groups.values()].slice(0,VESCO_GEO_BATCH_LIMIT);
    if(!jobs.length) return false;
    state.geoAutoRunning[key]=true;
    let updated=0,fail=0,done=0;
    const stats=document.getElementById(`v8-map-${type}-stats`);
    const setProgress=()=>{
      const el=document.getElementById(`v8-map-${type}-geo-progress`);
      if(el) el.textContent=`Localizando ${done}/${jobs.length} endereço(s)`;
    };
    if(stats) stats.insertAdjacentHTML("beforeend",`<span id="v8-map-${type}-geo-progress" class="warn">Localizando 0/${jobs.length} endereço(s)</span>`);

    async function runGroup(group){
      const ge=await geocodeAddressViaFlexApi(address(group[0]));
      if(ge && ge.status==="OK"){
        for(const o of group){ if(applyGeoToOrder(o,ge)){ updated++; persistGeoPatch(o).catch(()=>null); } }
      }else fail+=group.length;
      done++; setProgress();
      if(done===jobs.length || done%VESCO_GEO_CONCURRENCY===0){
        renderMap(type,false,list);
        await sleep(0);
      }
    }

    try{
      for(let i=0;i<jobs.length;i+=VESCO_GEO_CONCURRENCY){
        await Promise.allSettled(jobs.slice(i,i+VESCO_GEO_CONCURRENCY).map(runGroup));
      }
      if(updated){
        saveLocalSnapshot(snapshotFromState());
        if(stats) stats.insertAdjacentHTML("beforeend",`<span class="ok">${updated} pedido(s) localizado(s) e salvo(s)</span>`);
      }else if(fail && stats){
        stats.insertAdjacentHTML("beforeend",`<span class="warn">${fail} sem resultado; revise rua, número ou CEP</span>`);
      }
      renderMap(type,false,list);
      return updated>0;
    }finally{
      state.geoAutoRunning[key]=false;
      document.getElementById(`v8-map-${type}-geo-progress`)?.remove();
    }
  }


  function renderSeparados(){
    const list=searchFilter(derivedLists().separados);
    const page=paginationFor(list,"separados");
    const iniciados=list.filter(o=>txt(sepStartTime(o))).length;
    const finalizados=list.filter(o=>txt(sepEndTime(o)) || txt(sepDate(o))).length;
    const comTempo=list.filter(o=>sepTempo(o)!=="—").length;
    const valorTotal=list.reduce((s,o)=>s+value(o),0);

    setPage("Separados Hoje","Somente pedidos com separação finalizada na data real selecionada.");

    const rows=page.items.map(o=>{
      const id=esc(orderKey(o)||number(o));
      const st=esc(status(o)||"Separado");
      return `<tr>
        <td>${orderCell(o)}</td>
        <td>${clientCell(o)}</td>
        <td>${esc(sepStartOperator(o)||"—")}</td>
        <td>${brDateTime(sepStartTime(o))}</td>
        <td>${esc(sepEndOperator(o)||"—")}</td>
        <td>${brDateTime(sepEndTime(o) || sepDate(o))}</td>
        <td>${esc(sepTempo(o))}</td>
        <td><span class="v8-chip green">${st}</span></td>
        <td>
          <div class="v1021-action-stack">
            <button class="v8-btn secondary" onclick="VescoV8.openPedidoDetalhe('${id}')">Ver</button>
            <button class="v8-btn green" onclick="VescoV8.gotoTab('saiu')">Pronto envio</button>
          </div>
        </td>
      </tr>`;
    }).join("");

    const el=document.getElementById("v8Content");
    if(!el) return;

    el.innerHTML=`
      ${kpis([
        {label:"Separados",value:String(list.length),small:"na data"},
        {label:"Iniciados por",value:String(iniciados),small:"com operador início"},
        {label:"Finalizados por",value:String(finalizados),small:"com operador conclusão"},
        {label:"Com tempo",value:String(comTempo),small:"duração calculada"},
        {label:"Valor",value:money(valorTotal),small:"pedidos separados"}
      ])}

      <div class="v8-card">
        <div class="v8-card-head">
          <div>
            <h3>Separados Hoje</h3>
            <small>${list.length} registro(s)</small>
          </div>
          <button class="v8-btn secondary" onclick="VescoV8.gotoTab('saiu')">Ver prontos para envio</button>
        </div>

        ${pagerHtml(page)}
        <div class="v8-table-wrap v1027-separados-table">
          <table class="v8-table">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Cliente / endereço / aviso</th>
                <th>Iniciado por</th>
                <th>Início</th>
                <th>Finalizado por</th>
                <th>Separado</th>
                <th>Tempo</th>
                <th>Status</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              ${rows || `<tr><td colspan="9" class="v8-empty"><b>Nenhum pedido separado nesta data real.</b><br><small>Se o EasyPanel retornar separadosHoje: 0, esta tela fica zerada mesmo que existam separados em dias anteriores.</small></td></tr>`}
            </tbody>
          </table>
        </div>
        ${pagerHtml(page)}
      </div>`;
  }

  let v1050RenderScheduled=false;
  let v1053RenderForce=false;
  function scheduleRender(force=false){
    v1053RenderForce=v1053RenderForce||!!force;
    if(v1050RenderScheduled) return;
    v1050RenderScheduled=true;
    const run=()=>{
      const forceNow=v1053RenderForce;
      const wait=Math.max(0,Number(state.userNavigatingUntil||0)-Date.now());
      if(wait>0 && !forceNow){ setTimeout(run,Math.min(wait+16,220)); return; }
      requestAnimationFrame(()=>{
        const scroller=getPageScroller();
        const top=scroller?scroller.scrollTop:0;
        v1053RenderForce=false;
        try{ render(); }
        catch(e){ console.error("V10.58: fila de render capturou erro",e); }
        finally{
          v1050RenderScheduled=false;
          markNavigationBusy(false);
          if(state.__resetMobileScrollAfterRender){
            state.__resetMobileScrollAfterRender=false;
            requestAnimationFrame(()=>{
              resetMobileDocumentScroll();
              setTimeout(resetMobileDocumentScroll,80);
            });
          }else if(scroller && top>0 && !forceNow){
            requestAnimationFrame(()=>{ try{scroller.scrollTop=top;}catch(e){} });
          }
          // Se alguma atualização chegou durante o render, executa somente mais um quadro.
          if(v1053RenderForce) scheduleRender(true);
        }
      });
    };
    setTimeout(run,0);
  }

  function render(){
    const tab=state.tab||"dashboard";
    try{
      const mapTabs=new Set(["logistica","flex","saiu"]);
      if(Object.keys(state.maps||{}).length && (state.lastRenderedTab!==tab || mapTabs.has(tab))) closeMaps();
      updateBadges();
      if(tab==="dashboard") renderDashboard();
      else if(tab==="separacao") renderSeparacao();
      else if(tab==="separados") renderSeparados();
      else if(tab==="logistica") renderLogistica();
      else if(tab==="flex") renderFlex();
      else if(tab==="retiradas") renderRetiradas();
      else if(tab==="tarefas") renderTarefasFrota();
      else if(tab==="entregues") renderEntregues();
      else if(tab==="saiu") renderProntoEnvio();
      else renderDashboard();
      state.lastRenderedTab=tab;
      markNavigationBusy(false);
      const c=document.getElementById("v8Content");
      if(c){
        c.classList.remove("v1051-page-ready");
        requestAnimationFrame(()=>c.classList.add("v1051-page-ready"));
      }
    }catch(e){
      console.error("V10.58: render seguro capturou erro.", e);
      markNavigationBusy(false);
      showLoading(false);
      const el=document.getElementById("v8Content");
      if(el) el.innerHTML=`<div class="v8-card"><h3>Erro de tela contornado</h3><p>O painel não travou. Clique em Atualizar ou mude de aba.</p><small>${esc(e.message||e)}</small></div>`;
    }
  }

  function updateBadges(force=false){
    function setTabBadge(tab,count){
      document.querySelectorAll(`[data-tab="${tab}"]`).forEach(btn=>{
        if(tab==="menu") return;
        let b=btn.querySelector(".v8-badge");
        if(!b){ b=document.createElement("b"); b.className="v8-badge v110-menu-ping"; btn.appendChild(b); }
        else b.classList.add("v110-menu-ping");
        b.textContent=String(count);
        b.setAttribute("aria-label", `${count} pendente(s)`);
        b.title=`${count} pendente(s)`;
        b.style.display=count>0?"grid":"none";
        btn.classList.toggle("has-v105-badge", count>0);
        btn.classList.toggle("has-v110-ping", count>0);
      });
    }
    let counts=null;
    if(!force && state.badgeCache && state.badgeCacheRevision===state.perfRevision){
      counts=state.badgeCache;
    }else{
      const dl=derivedLists();
      counts={
        separacao:dl.separacao.length + dl.pendencias.length,
        saiu:dl.pronto.length + routeFlexExtras().length,
        logistica:dl.logistica.length,
        retiradas:dl.retiradas.length,
        tarefas:dl.tarefas.filter(t=>t.status!=="Concluída").length,
        flex:dl.flex.length,
        separados:dl.separados.length,
        entregues:dl.entregues.length
      };
      state.badgeCache=counts;
      state.badgeCacheRevision=state.perfRevision;
    }
    Object.entries(counts).forEach(([tab,count])=>setTabBadge(tab,count));
    const b=document.getElementById("v8RetBadge"); if(b) b.textContent=String(counts.retiradas||0);
  }

  function closeMaps(){
    Object.keys(state.maps).forEach(k=>{
      try{ const m=state.maps[k]; const c=m.getCenter(); state.mapViews[k]={lat:c.lat,lon:c.lng,zoom:m.getZoom()}; m.remove(); }catch(e){}
    });
    state.maps={}; state.layers={}; state.markers={logistica:{},flex:{}};
  }
  function mapIcon(type,label){ return L.divIcon({className:"",html:`<div class="v8-marker ${type==="flex"?"flex":""}">${label}</div>`,iconSize:[31,31],iconAnchor:[15,15]}); }
  function ensureMap(type){
    if(typeof L==="undefined")return null;
    const el=document.getElementById(`v8-map-${type}`); if(!el)return null; if(state.maps[type])return state.maps[type];
    const view=state.mapViews[type]||{lat:-23.5505,lon:-46.6333,zoom:11};
    const map=L.map(el,{preferCanvas:true,zoomControl:true,fadeAnimation:false,markerZoomAnimation:false,zoomAnimation:true}).setView([view.lat,view.lon],view.zoom);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap",updateWhenIdle:true,updateWhenZooming:false,keepBuffer:4,crossOrigin:true}).addTo(map);
    map.on("moveend zoomend",()=>{ try{const c=map.getCenter();state.mapViews[type]={lat:c.lat,lon:c.lng,zoom:map.getZoom()};}catch(e){} });
    state.maps[type]=map; state.layers[type]=L.layerGroup().addTo(map);
    requestAnimationFrame(()=>{try{map.invalidateSize(false);}catch(e){}});
    setTimeout(()=>{try{map.invalidateSize(false);}catch(e){}},220);
    return map;
  }
  function listForMap(type){ return type==="flex"?searchFilter(flexList()):searchFilter(logisticaList()); }
  
  function routeOriginLatLon(){
    return [-23.541652,-46.604720]; // Rua São Leopoldo 92
  }
  function routeDirectionKey(points){
    return points.map(p=>`${p[0].toFixed(5)},${p[1].toFixed(5)}`).join("|");
  }
  function formatDistance(m){
    const n=Number(m||0);
    return n>=1000 ? `${(n/1000).toFixed(1).replace(".",",")} km` : `${Math.round(n)} m`;
  }
  function formatDuration(sec){
    const m=Math.round(Number(sec||0)/60);
    if(m<60) return `${m} min`;
    return `${Math.floor(m/60)}h ${String(m%60).padStart(2,"0")}min`;
  }
  function straightDistanceMeters(points){
    let total=0;
    for(let i=1;i<points.length;i++){
      const [aLat,aLon]=points[i-1], [bLat,bLon]=points[i];
      const R=6371000, toRad=x=>x*Math.PI/180;
      const dLat=toRad(bLat-aLat), dLon=toRad(bLon-aLon);
      const s=Math.sin(dLat/2)**2 + Math.cos(toRad(aLat))*Math.cos(toRad(bLat))*Math.sin(dLon/2)**2;
      total += 2*R*Math.asin(Math.sqrt(s));
    }
    return total;
  }
  async function drawRouteDirections(type,map,layer,orders){
    if(type!=="logistica" || !orders || !orders.length || typeof L==="undefined") return;
    const plotted=orders.filter(coords);
    if(!plotted.length) return;
    const points=[routeOriginLatLon()].concat(plotted.map(o=>{const c=coords(o); return [c.lat,c.lon];}));
    if(points.length<2) return;

    const key=routeDirectionKey(points);
    const stats=document.getElementById(`v8-map-${type}-stats`);
    try{
      if(state.routeDirections[key]){
        const cached=state.routeDirections[key];
        if(cached.geometry){
          L.polyline(cached.geometry,{weight:6,opacity:.9,className:"v117-route-line"}).addTo(layer);
        }
        if(stats) stats.innerHTML += `<span class="ok">Rota: ${formatDistance(cached.distance)} • ${formatDuration(cached.duration)}</span>`;
        return;
      }

      if(stats) stats.innerHTML += `<span class="warn">Calculando rota...</span>`;
      const coordStr=points.map(p=>`${p[1]},${p[0]}`).join(";");
      const url=`https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson&steps=false`;
      const resp=await fetch(url);
      const data=await resp.json();
      const route=data && data.routes && data.routes[0];
      if(route && route.geometry && route.geometry.coordinates){
        const geometry=route.geometry.coordinates.map(c=>[c[1],c[0]]);
        state.routeDirections[key]={geometry,distance:route.distance,duration:route.duration};
        L.polyline(geometry,{weight:6,opacity:.9,className:"v117-route-line"}).addTo(layer);
        if(stats){
          const base=stats.innerHTML.replace('<span class="warn">Calculando rota...</span>',"");
          stats.innerHTML=base + `<span class="ok">Rota: ${formatDistance(route.distance)} • ${formatDuration(route.duration)}</span>`;
        }
      }else{
        throw new Error("OSRM sem rota");
      }
    }catch(e){
      const dist=straightDistanceMeters(points);
      L.polyline(points,{weight:5,opacity:.7,dashArray:"8 8",className:"v117-route-fallback"}).addTo(layer);
      if(stats){
        const base=stats.innerHTML.replace('<span class="warn">Calculando rota...</span>',"");
        stats.innerHTML=base + `<span class="warn">Rota aproximada: ${formatDistance(dist)} • ${formatDuration(dist/9)}</span>`;
      }
    }
  }

function renderMap(type,forceFit=false,listOverride=null){
    const map=ensureMap(type);
    if(!map) return false;
    const listFull=Array.isArray(listOverride)?listOverride:listForMap(type);
    const plottedFull=listFull.filter(coords);
    const plotted=plottedFull.slice(0, Math.max(1, VESCO_MAP_LIMIT));
    const pts=[];
    state.markers[type]={};
    state.layers[type].clearLayers();
    plotted.forEach((o,i)=>{
      const c=coords(o);
      const n=number(o)||orderKey(o)||ecom(o);
      const m=L.marker([c.lat,c.lon],{icon:mapIcon(type,type==="flex"?"F":String(i+1)),title:`#${n} ${client(o)}`});
      m.bindPopup(`<div style="font-size:12px;line-height:1.35;min-width:220px"><b>#${esc(n)} — ${esc(client(o))}</b><br>${esc(address(o)||"Coordenada informada")}<br><small>${esc(status(o)||"Pendente")}</small></div>`);
      m.addTo(state.layers[type]);
      keys(o).forEach(k=>state.markers[type][k]=m);
      pts.push([c.lat,c.lon]);
    });
    const stats=document.getElementById(`v8-map-${type}-stats`);
    if(stats){
      const missingAddress=listFull.filter(o=>!coords(o)&&hasAddress(o)).length;
      const rejected=listFull.filter(o=>txt(o.geocode_status).includes("FORA_DE_SP")).length;
      const limited = plottedFull.length > plotted.length;
      const noCoord=listFull.length-plottedFull.length;
      stats.innerHTML=`<span class="ok">${plotted.length}/${listFull.length} no mapa</span>${noCoord?`<span class="warn">${noCoord} aguardando localização automática</span>`:""}${limited?`<span class="warn">exibindo ${plotted.length} pins no modo rápido</span>`:""}${rejected?`<span class="warn">${rejected} coordenada incompatível descartada</span>`:""}${missingAddress?`<button class="v8-mini-btn" onclick="VescoV8.gerarPingsMapa('${type}')">Localizar agora</button>`:""}`;
    }
    const fitKey=`${type}|${plotted.map(o=>number(o)||orderKey(o)||ecom(o)).join(",")}`;
    const shouldFit=!!forceFit && state.mapFitKeys[type]!==fitKey;
    if(shouldFit) state.mapFitKeys[type]=fitKey;
    requestAnimationFrame(()=>{try{map.invalidateSize(false); if(pts.length&&shouldFit){ if(pts.length===1) map.setView(pts[0],15,{animate:false}); else map.fitBounds(L.latLngBounds(pts).pad(.16),{maxZoom:14,animate:false}); }}catch(e){}});

    // V10.35: não calcula rota OSRM automaticamente e não roda geocode em cada troca de módulo.
    if(type==="logistica" && plotted.length && VESCO_ROUTE_LINE){
      setTimeout(()=>drawRouteDirections(type,map,state.layers[type],plotted),180);
    }
    if(VESCO_AUTO_GEOCODE && (listFull.length-plottedFull.length)>0){
      setTimeout(()=>autoGeocodeMap(type,listFull),350);
    }
    return true;
  }

  function focus(type,id){ if(type==="flex"&&state.tab!=="flex"){state.tab="flex"; renderFlex();} if(type==="logistica"&&state.tab!=="logistica"){state.tab="logistica"; renderLogistica();} renderMap(type,false); const clean=txt(id).replace(/^#/,""); let marker=state.markers[type][clean]; if(!marker){const d=clean.replace(/\D/g,""); if(d)marker=state.markers[type][d];} if(!marker){alert("Pedido sem coordenada ainda. O painel vai tentar localizar pelo endereço; se não entrar no mapa, rode Rodar coordenadas ou confira o endereço."); autoGeocodeMap(type,listForMap(type)); return false;} const map=state.maps[type]; setTimeout(()=>{map.setView(marker.getLatLng(),17); marker.openPopup(); map.invalidateSize(true);},120); return true; }
  async function marcarRetirada(id){
    const o=findOrderByAnyId(id)||{};
    const numero=number(o)||id;
    const recebedor=prompt(`Quem recebeu/retirou o pedido #${numero}?`);
    if(!txt(recebedor)) return null;
    const documento=prompt("Documento ou identificação de quem retirou:", "") || "";
    const observacao=prompt("Observação da retirada:", "Retirada registrada pelo painel") || "Retirada registrada pelo painel";
    const op=operadorAtual(false);
    const nowISO=new Date().toISOString();
    const dataBR=new Date().toLocaleDateString("pt-BR");
    const patch={
      status_logistica:"Entregue",
      situacao_nome:"Entregue",
      is_delivered:true,
      tipo_finalizacao:"Retirada",
      retirada_confirmada:true,
      recebedor,
      nome_recebedor:recebedor,
      recebido_por:recebedor,
      documento_retirada:documento,
      doc_recebedor:documento,
      observacao_retirada:observacao,
      data_entrega_realizada:dataBR,
      entregue_em:nowISO,
      retirado_em:nowISO,
      updated_at:nowISO,
      operador_retirada:op,
      operador_entrega:op,
      finalizado_por:op,
      entregue_por:op,
      operador_ultima_alteracao:op
    };

    try{
      await firebasePatchOrder(id,patch);

      jsonp(API_MAIN,Object.assign({
        action:"updateStatus",
        id,
        status:"Retirado",
        operador:op,
        observacao
      },patch),12000).catch(e=>console.warn("Apps Script retirada indisponível; Firebase manteve retirada.", e.message||e));

      alert("Retirada registrada. O pedido foi para Entregues / Retirados.");
      state.tab="entregues";
      render();
      return {success:true,firebase:true,patch};
    }catch(e){
      alert("Erro ao registrar retirada: " + (e.message||e));
      return {success:false,error:e.message||String(e)};
    }
  }
  async function ensureData(){ if(!state.loaded) await loadData(true); }
  function isMobileNavigationViewport(){
    return !!(window.matchMedia && window.matchMedia("(max-width: 899px), (max-width: 1100px) and (pointer: coarse)").matches);
  }
  function resetMobileDocumentScroll(){
    if(!isMobileNavigationViewport()) return false;
    const scrolling=getPageScroller();
    try{ if(scrolling) scrolling.scrollTop=0; }catch(_e){}
    const content=document.getElementById("v8Content");
    try{ if(content) content.scrollTop=0; }catch(_e){}
    return true;
  }
  function go(tab){
    const next=txt(tab)||"dashboard";
    if(next===state.tab && state.lastRenderedTab===next){ markNavigationBusy(false); return true; }
    const changed=next!==state.tab;
    if(changed && isMobileNavigationViewport()){
      state.pageByTab[next]=1;
      state.__resetMobileScrollAfterRender=true;
      resetMobileDocumentScroll();
    }
    state.tab=next;
    state.userNavigatingUntil=Date.now()+90;
    const meta=tabMeta(next);
    setPage(meta[0],meta[1]);
    markNavigationBusy(true);
    if(!state.loaded){
      ensureData().then(()=>scheduleRender(true)).catch(()=>scheduleRender(true));
      return true;
    }
    // Entrega o feedback visual do botão antes de montar a próxima tela.
    requestAnimationFrame(()=>scheduleRender(true));
    return true;
  }
  function interceptOldClicks(){ document.addEventListener("click",e=>{ const btn=e.target.closest?.("[data-v7tab], [data-v8tab], #v7Sidebar button, .tab-nav button"); if(!btn)return; const label=norm(btn.dataset.v7tab||btn.dataset.v8tab||btn.textContent||""); const map={"dashboard":"dashboard","separacao":"separacao","separados hoje":"separados","separados":"separados","logistica":"logistica","logistica erp":"logistica","logística":"logistica","pronto para envio":"saiu","retiradas":"retiradas","tarefas frota":"tarefas","tarefas":"tarefas","frota":"tarefas","envios flex":"flex","flex":"flex","entregues":"entregues"}; const tab=map[label]||(label.includes("separados")?"separados":label.includes("log")?"logistica":label.includes("flex")?"flex":""); if(tab){e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); go(tab);}},true); }
  async function init(){
    loadPersistentCaches();
    state.tarefas=loadTarefas();
    autoCleanFlexStorageV87();
    layout();
    bindPagerNavigation();
    bindResponsivePaginationResize();
    interceptOldClicks();
    window.focusOrderOnMap=id=>focus("logistica",id);
    window.focusFlexOnMap=id=>focus("flex",id);
    // V10.43: no boot, não força /sync nem rota pesada.
    // Primeiro lê /snapshot-lite do worker e Firebase root; Apps Script direto só se URL nova for configurada.
    await loadData(false);
    // V10.49: garante uma leitura Flex no primeiro boot, sem depender do
    // conteúdo do snapshot ERP nem do cache local do navegador.
    try{ await refreshFlexFromAppsScriptOnly(false); }catch(e){}
    render();
    startPlanilhaInstantaneaPolling();
    const mobileRuntime=window.matchMedia && window.matchMedia("(max-width: 899px), (max-height: 640px) and (max-width: 1100px)").matches;
    // No mobile a carga inicial já trouxe o snapshot; não repete a mesma leitura segundos depois.
    if(!mobileRuntime) setTimeout(()=>refreshPlanilhaInstantanea(true),2500);
  }
  window.VescoV8={__v82:true,__v821:true,__v84:true,__v86:true,__v861:true,__v87:true,__v871:true,__v872:true,__v873:true,__v874:true,__v875:true,__v876:true,__v90:true,__v91:true,__v92:true,__v921:true,__v922:true,__v93:true,__v94:true,__v95:true,__v100:true,__v101:true,__v102:true,__v103:true,__v104:true,__v105:true,__v106:true,__v107:true,__v108:true,__v109:true,__v1010:true,__v1011:true,__v1012:true,__v1013:true,__v1014:true,__v1015:true,__v1016:true,__v1017:true,__v1018:true,__v1019:true,__v1020:true,__v1021:true,__v1022:true,__v1023:true,__v1024:true,__v1027:true,__v1028:true,__v1029:true,__v1030:true,__v1031:true,__v1032:true,__v1035:true,__v1036:true,__v1037:true,__v1038:true,__v1039:true,__v1040:true,__v1041:true,__v1042:true,__v1043:true,__v1048:true,__v1049:true,__v1050:true,__v1051:true,__v1052:true,__v1053:true,__v1054:true,__v1055:true,__v1056:true,__v1057:true,__v1058:true,__v1059:true,state,init,go,scheduleRender,setListPage,
    openFlexMonth:async(month)=>{state.month=month||state.month; const m=document.getElementById("v8Month"); if(m)m.value=state.month; await loadData(true); if(!flexList().length) await refreshFlexFromAppsScriptOnly(false); renderFlex();},
    saveFlexMonthNow:()=>{const saved=saveStoredFlex(flexList(),state.month); alert(saved.saved?`Mês armazenado: ${monthLabel(saved.month)} — ${saved.total} pedido(s).`:`Nada novo para armazenar em ${monthLabel(saved.month)}.`); renderFlex(); return saved;},
    refreshFlexOnly:async()=>{showLoading(true); await refreshFlexFromAppsScriptOnly(true); showLoading(false); renderFlex();},
    refreshPlanilhaInstantanea:async()=>{showLoading(true); const ok=await refreshPlanilhaInstantanea(true); showLoading(false); return ok;},
    clearFlexStorage:()=>{const removed=clearFlexStorage(); alert(`Armazenamento Flex limpo: ${removed.length} item(ns). Clique em Atualizar Flex.`); renderFlex(); return removed;},
    autoCleanFlexStorageV87,
    sleep,
    routeReadyList,routeFlexExtras,addFlexToRouteByCode,removeFlexFromRoute,routeMotoristaLink,routeOfflinePayload,encodeRoutePayload,routeOrdersRows,routeOrdersStats,renderPedidosEmRota,confirmarEntregaRotaSite,openMapForRouteOrder,shareRouteById,openShareRouteModal,copyShareInput,closeShareModal,copyRouteLinkById,copyRouteLinkDirect,openWhatsAppRouteById,toggleRotasCriadas,abrirPedidoNoMapa,abrirCorrecaoEndereco,marcarComoRetirada,whatsappRouteLink,saveRouteFirebase,testFirebaseRoutes,fastRouteLink,localRotas,firebasePatchOrder,refreshFromAppsScriptBackground,loadFirebaseSnapshot,saveFirebaseSnapshot,refreshEntreguesAgora,loadDeliveredFromFirebaseRoutes,refreshMotoristasLocalizacao,renderMotoristasAoVivo,safeRenderMotoristasAoVivo,renderDriverLiveMap,mostrarMotoristaNoMapa,focarMotoristaRota,startMotoristaTrackingPolling,stopMotoristaTrackingPolling,
    salvarDetalhesPedido,marcarPendenciaProduto,resolverPendenciaProduto,pendenciasProdutoList,abrirRelatorioPendencia,abrirObsLinkPedido,salvarObsLinkPedido,salvarRelatorioPendencia,fecharPedidoModal,
    runFlexGeocode,statusFlexGeocode,autoGeocodeMap,gerarPingsMapa,geocodeAddressViaFlexApi,cleanDisplayAddress,extractCep,address,openMapForOrder,openGoogleMapsForList,googleMapsDirectionsUrlFromOrders,
    renderTarefasFrota,registrarTarefaFrota,concluirTarefaFrota,removerTarefaFrota,tarefasFrotaList,
    sidebar:()=>{state.sidebarCollapsed=!state.sidebarCollapsed; document.body.classList.toggle("v8-sidebar-collapsed",state.sidebarCollapsed); localStorage.setItem("vesco:v8:sidebarCollapsed",state.sidebarCollapsed?"1":"0");},
    today:async()=>{state.date=todayISO(); invalidatePerfCaches(); const d=document.getElementById("v8Date"); if(d)d.value=state.date; state.pageByTab={}; await loadData(true); scheduleRender(true);},refresh:async()=>{await loadData(true); scheduleRender(true);},render,renderDashboard,renderLogistica,renderFlex,renderRetiradas,renderEntregues,renderSeparados,renderMap,logisticaList,flexList,retiradaList,entreguesList,separadosList,marcarRetirada,updateStatus,definirOperador,operadorAtual,produtosText,pagamentoText,renderSeparacao,renderProntoEnvio,copyRouteLink,routeMotoristaLink,routeGoogleMapsLink,routeWazeLink,parseMoney,debug(){return{linhaAoVivoMultipontos:true,statusRealtimeFix:true,retiradaRecebedorFix:true,rotaCalculadaFix:true,entreguesComprovantesFix:true,entreguesFirebaseDireto:true,leituraInteligenteV1019:true,realtimeInstantaneo:true,retiradaInteligente:true,firebaseLimpoV1020:true,semPedidoFantasma:true,realtimeLimitado:true,retiradaOlistV1021:true,rotasRecolhiveis:true,botaoMapaPedido:true,retiradaCodigoRD:true,separacaoSemRetirada:true,mapaSpV1023:true,geocodeSaoPaulo:true,semBotaoCorrigirEndereco:true,easyPanelFirstV1024:true,appsScriptEmergencia:true,atualizarViaEasyPanel:true,mobilePendenciaV1027:true,pendenciaFirebaseFirst:true,mobileCardsV1027:true,renderSeparadosFixV1027:true,separadosHojeDataRealV1027:true,mobileFullV1027:true,frontendMarketplaceCleanV1027:true,pendenciaNaoEntregaV1028:true,operadorRotaEntreguesV1028:true,planilhaStatusVetoV1029:true,rotasSomenteDataV1030:true,prontoIncluiSeparadosHojeV1031:true,flexApiFallbackV1031:true,enderecoLeituraAmpliadaV1031:true,prontoSomenteSeparadosDiaV1032:true,motoristasSomenteRotasDiaV1032:true,enderecoMestrePreservadoV1032:true,renderLeveV1032:true,performanceV1035:true,mapaLeveV1035:true,tabelasLimitadasV1035:true,planilhaFirstV1037:true,planilhaInstantV1038:true,pollingPlanilhaV1038:true,separacaoIncluiRetiradaV1038:true,workerFirstV1039:true,snapshotLiteFirstV1039:true,semAppsScriptAntigoV1039:true,workerPlanilhaV1040:true,planilhaPedidosEndpointV1040:true,entregaTransportadoraV1041:true,modoLeveV1042:true,hashEstavelV1042:true,pollingInteligenteV1042:true,firebaseRealtimeOffV1042:true,canceladosForaV1043:true,flexMantidoV1043:true,entregaRetiradaCorrigidaV1043:true,hotfixRetiradaFinalizadaV1044:true,semReferenceErrorV1044:true,hotfixIsDeliveredV1045:true,semBootErrorV1045:true,hotfixIsFlexIndicatorV1046:true,semBootErrorV1046:true,flexWorkerV1047:true,regraFlexPlanilhaV1047:true,mapaPingsV1047:true,erpValorNumeroFixV1048:true,pingsPersistentesV1048:true,flexAutorecoveryV1049:true,flexSempreCarregadoV1049:true,fluidezV1050:true,cacheGeocodePersistenteV1050:true,viaCepV1050:true,geocodeConcorrenteV1050:true,pollingAdaptativoV1050:true,navegacaoInstantaneaV1051:true,paginacaoLeveV1051:true,badgesCacheV1051:true,listasDerivadasCacheV1051:true,pollingSemConflitoV1051:true,mobileCompletoV1052:true,tabelasCardsAcessiveisV1052:true,filtrosMoveisV1052:true,mapaResponsivoV1052:true,modaisTelaCheiaV1052:true,paginacaoAdaptativaV1052:true,mobileDestravadoV1053:true,scrollMobileSeguroV1054:true,responsivoUniversalV1055:true,layoutSemScrollTravadoV1055:true,paginacaoDinamicaV1055:true,mobileNavegavelV1056:true,desktopSidebarPreservadoV1056:true,scrollTopoAoNavegarV1056:true,paginacaoMobileDiretaV1057:true,pagerPointerV1057:true,pageSizeRealV1057:true,mobileScrollerV1058:true,paginacaoViewportRealV1058:true,resizeRecalculaPaginaV1058:true,menuMobileExpandidoV1059:true,pedidosEmpilhadosV1059:true,planilhaTodasContasV1054:true,navegacaoWatchdogV1053:true,pollingMobileLeveV1053:true,renderFilaUnicaV1053:true,version:"V10.59-MOBILE-MENU-PEDIDOS-EMPILHADOS",viewportWidth:viewportWidth(),effectivePageSize:responsivePageSize(),effectiveMapPageSize:responsiveMapPageSize(),pageByTab:{...state.pageByTab},pageScroller:getPageScroller()?.id||"document",date:state.date,month:state.month,loaded:state.loaded,orders:state.orders.length,flex:state.flex.length,logistica:logisticaList().length,retiradas:retiradaList().length,entregues:entreguesList().length,separados:separadosList().length,pendencias:pendenciasProdutoList().length,erpMonth:state.orders.filter(inMonth).length,flexMonth:state.flex.filter(inMonth).length,api:API_MAIN,apiFontePlanilha:false,apiWorkerFirst:EASYPANEL_URL,planilhaBridgeUrlOpcional:PLANILHA_BRIDGE_URL,apiFlex:API_FLEX,payloadCounts:state.lastPayload?.counts||null,flexRaw:state.lastFlexRawCount,flexAccepted:state.lastFlexAcceptedCount,flexRejectedSamples:state.lastFlexRejectedSamples,flexPayloadVersion:state.lastFlexPayload?.version||state.lastFlexPayload?.data?.version||null,flexPayloadTotal:state.lastFlexPayload?.total||state.lastFlexPayload?.data?.total||null,flexPayloadPorConta:state.lastFlexPayload?.por_conta||state.lastFlexPayload?.data?.por_conta||null,flexDiagnostics:state.lastFlexDiagnostics||state.lastFlexPayload?.diagnostics||null,sampleFlex:flexList().slice(0,3).map(o=>({pedido:number(o),ecom:ecom(o),conta:pick(o,["conta","loja","store_name"]),marcador:flexMarker(o),validado:flexValidated(o),source:pick(o,["__v8source","__source"]),status:statusAll(o),delivered:isDelivered(o)})),sampleLog:logisticaList().slice(0,3).map(o=>({pedido:number(o),status:statusAll(o),delivered:isDelivered(o),date:dueDate(o)}))}}};
  window.VESCO_FORCE_PLANILHA = async function(){ return await refreshPlanilhaInstantanea(true); };
  window.VESCO_FORCE_SNAPSHOT_LITE = async function(){ const ok = await refreshFromEasyPanel(false); scheduleRender(true); return ok; };
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",init); else init();
  console.log("VESCO V10.59 ativo — menu mobile expandido e até 12 pedidos empilhados; desktop preservado.");
})();
