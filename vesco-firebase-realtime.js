// vesco-firebase-realtime.js — VESCO CONTROL V10.1
// Sincroniza operadores em tempo real via Firebase Realtime Database.
// Carregar depois de firebase-config.js e depois de modulo.vesco-v8-operacional.js.

(function(){
  if(window.__VESCO_FIREBASE_REALTIME_V10) return;
  window.__VESCO_FIREBASE_REALTIME_V10 = true;

  const SDK_APP = "https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js";
  const SDK_DB  = "https://www.gstatic.com/firebasejs/10.12.5/firebase-database-compat.js";

  const ROUTES_PATH = "vesco_rotas_motorista";
  const ORDERS_PATH = "vesco_operacao/orders";
  const EVENTS_PATH = "vesco_operacao/eventos";

  let app = null;
  let db = null;
  let initialized = false;
  let lastOrdersPatch = {};
  let lastRoutes = [];

  function txt(v){ return String(v ?? "").trim(); }
  function norm(v){ return txt(v).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim(); }
  function escKey(v){ return txt(v).replace(/[.#$/\[\]]/g,"_") || ("key_" + Date.now()); }
  function now(){ return new Date().toISOString(); }

  function loadScript(src){
    return new Promise((resolve,reject)=>{
      if(Array.from(document.scripts).some(s=>s.src===src)) return resolve();
      const s=document.createElement("script");
      s.src=src;
      s.async=true;
      s.onload=resolve;
      s.onerror=()=>reject(new Error("Falha ao carregar " + src));
      document.head.appendChild(s);
    });
  }

  async function ensureFirebase(){
    if(initialized && db) return db;
    const cfg = window.VESCO_FIREBASE_CONFIG || window.firebaseConfig || {
      apiKey: "AIzaSyDvQhoV0x6B9cTnouzvOxyfqXRtsG2nKq0",
      authDomain: "dashlogistica-49689.firebaseapp.com",
      databaseURL: "https://dashlogistica-49689-default-rtdb.firebaseio.com",
      projectId: "dashlogistica-49689",
      storageBucket: "dashlogistica-49689.firebasestorage.app",
      messagingSenderId: "833809141353",
      appId: "1:833809141353:web:c92b18ee10d9fc91c29cf8",
      measurementId: "G-NRYTBELTJ0"
    };

    await loadScript(SDK_APP);
    await loadScript(SDK_DB);

    if(!window.firebase) throw new Error("Firebase SDK não carregou.");

    try{
      app = window.firebase.apps && window.firebase.apps.length
        ? window.firebase.app()
        : window.firebase.initializeApp(cfg);
    }catch(e){
      app = window.firebase.app();
    }

    db = window.firebase.database(app);
    initialized = true;
    console.log("VESCO Firebase V10 conectado:", cfg.databaseURL);
    return db;
  }

  function getV8(){
    return window.VescoV8 || null;
  }

  function orderKeys(o){
    if(!o) return [];
    return [
      o.id, o.pedido_key, o.numero, o.pedido, o.id_tiny, o.numero_ecommerce, o.ecom
    ].map(txt).filter(Boolean);
  }

  function findOrderById(id){
    const v8=getV8();
    if(!v8 || !v8.state) return null;
    const needle=txt(id).replace(/^#/,"");
    const all=[...(v8.state.orders||[]), ...(v8.state.flex||[])];
    return all.find(o=>orderKeys(o).some(k=>k.replace(/^#/,"")===needle || k===needle)) || null;
  }

  function applyOrderPatchToState(id, patch){
    const o=findOrderById(id);
    if(!o) return false;
    Object.assign(o, patch || {});
    return true;
  }

  function applyAllOrderPatches(patches){
    if(!patches || typeof patches!=="object") return 0;
    let applied=0;
    Object.keys(patches).forEach(id=>{
      const patch=patches[id] || {};
      if(applyOrderPatchToState(id, patch)) applied++;
    });
    return applied;
  }

  function normalizeRoute(r, id){
    if(!r) return null;
    const rota = Object.assign({}, r);
    rota.rota_id = txt(rota.rota_id || rota.id || id);
    rota.id = rota.rota_id;
    rota.token = txt(rota.token || rota.motorista_token || "");
    rota.nome_rota = txt(rota.nome_rota || rota.nome || "Rota");
    rota.nome = rota.nome_rota;

    let paradas = rota.paradas;
    if(!Array.isArray(paradas)){
      try{ paradas = JSON.parse(rota.paradas_json || "[]"); }catch(e){ paradas=[]; }
    }

    const entregas = rota.entregas || {};
    paradas = (paradas || []).map(p=>{
      const key=txt(p.pedido || p.numero || p.id || p.ecom);
      const ent = entregas[escKey(key)] || entregas[key] || null;
      return ent ? Object.assign({}, p, ent, {status_logistica:"Entregue"}) : p;
    });

    rota.paradas = paradas;
    rota.paradas_json = JSON.stringify(paradas);
    return rota;
  }

  function applyRoutesToState(routesObj){
    const v8=getV8();
    if(!v8 || !v8.state) return 0;

    const routes = Object.keys(routesObj || {})
      .map(id=>normalizeRoute(routesObj[id], id))
      .filter(Boolean)
      .sort((a,b)=>txt(b.criado_em || b.atualizado_em).localeCompare(txt(a.criado_em || a.atualizado_em)));

    lastRoutes = routes;

    const byId=new Map();
    [...routes, ...(v8.state.rotas||[])].forEach(r=>{
      const id=txt(r.rota_id || r.id || r.rota);
      if(id && !byId.has(id)) byId.set(id,r);
    });

    v8.state.rotas = Array.from(byId.values());

    // Se tiver entregas em rota, também atualiza os pedidos carregados.
    routes.forEach(r=>{
      const entregas = r.entregas || {};
      Object.keys(entregas).forEach(k=>{
        const ent=entregas[k];
        const pedido=ent.pedido || k;
        applyOrderPatchToState(pedido, {
          status_logistica:"Entregue",
          situacao_nome:"Entregue",
          nome_recebedor:ent.recebedor || ent.nome_recebedor || "",
          doc_recebedor:ent.documento || ent.doc_recebedor || "",
          data_entrega_realizada:ent.data_entrega_realizada || new Date().toLocaleDateString("pt-BR"),
          entregue_em:ent.entregue_em || ent.updated_at || now()
        });
      });
    });

    return routes.length;
  }

  async function saveOrderPatch(id, patch){
    const d=await ensureFirebase();
    if(!d) return null;
    const key=escKey(id);
    const payload=Object.assign({}, patch || {}, {updated_at:now()});
    await d.ref(`${ORDERS_PATH}/${key}`).update(payload);
    await d.ref(`${EVENTS_PATH}`).push({type:"order_patch", id, patch:payload, ts:now()});
    applyOrderPatchToState(id, payload);
    try{ getV8()?.render?.(); }catch(e){}
    return payload;
  }

  async function saveRoute(route){
    const d=await ensureFirebase();
    if(!d) return null;
    const id=txt(route.rota_id || route.id || route.rota || ("rota-" + Date.now()));
    const payload=Object.assign({}, route, {rota_id:id, id, atualizado_em:now(), fonte:"vesco_v10"});
    await d.ref(`${ROUTES_PATH}/${escKey(id)}`).set(payload);
    return payload;
  }

  async function confirmDelivery({rotaId, token, pedido, recebedor, documento, transportador, observacao}){
    const d=await ensureFirebase();
    if(!d) throw new Error("Firebase não conectado.");

    const dataBR=new Date().toLocaleDateString("pt-BR");
    const payload={
      pedido,
      recebedor,
      documento,
      transportador:transportador || "Painel Vesco",
      observacao:observacao || "",
      status_logistica:"Entregue",
      data_entrega_realizada:dataBR,
      entregue_em:now(),
      updated_at:now()
    };

    await d.ref(`${ROUTES_PATH}/${escKey(rotaId)}/entregas/${escKey(pedido)}`).set(payload);
    await d.ref(`${ORDERS_PATH}/${escKey(pedido)}`).update({
      status_logistica:"Entregue",
      situacao_nome:"Entregue",
      nome_recebedor:recebedor,
      doc_recebedor:documento,
      data_entrega_realizada:dataBR,
      entregue_em:payload.entregue_em,
      updated_at:payload.updated_at
    });
    await d.ref(`${EVENTS_PATH}`).push({type:"delivery", rotaId, pedido, recebedor, ts:now()});

    applyOrderPatchToState(pedido, {
      status_logistica:"Entregue",
      situacao_nome:"Entregue",
      nome_recebedor:recebedor,
      doc_recebedor:documento,
      data_entrega_realizada:dataBR,
      entregue_em:payload.entregue_em
    });
    try{ getV8()?.render?.(); }catch(e){}

    return payload;
  }

  async function startListeners(){
    const d=await ensureFirebase();
    if(!d) return false;

    d.ref(".info/connected").on("value", snap=>{
      const ok=!!snap.val();
      document.body.classList.toggle("vesco-firebase-online", ok);
      console.log(ok ? "VESCO Firebase online" : "VESCO Firebase offline");
    });

    d.ref(ORDERS_PATH).on("value", snap=>{
      lastOrdersPatch = snap.val() || {};
      const count=applyAllOrderPatches(lastOrdersPatch);
      if(count){
        try{ getV8()?.render?.(); }catch(e){}
      }
    });

    d.ref(ROUTES_PATH).on("value", snap=>{
      const total=applyRoutesToState(snap.val() || {});
      try{ getV8()?.render?.(); }catch(e){}
      console.log("VESCO Firebase rotas sincronizadas:", total);
    });

    patchVescoV8Methods();
    return true;
  }

  function jsonp(url, params={}, timeout=18000){
    return new Promise((resolve,reject)=>{
      const cb="__vesco_fb_cb_"+Math.random().toString(36).slice(2);
      const qs=new URLSearchParams(Object.assign({}, params, {callback:cb, _v:Date.now()}));
      const s=document.createElement("script");
      let done=false;
      const timer=setTimeout(()=>{ if(done)return; done=true; cleanup(true); reject(new Error("timeout")); },timeout);
      function cleanup(late){ clearTimeout(timer); try{s.remove();}catch(e){}; if(late){ window[cb]=function(){}; setTimeout(()=>{try{delete window[cb]}catch(e){}},120000); } else { try{delete window[cb]}catch(e){} } }
      window[cb]=res=>{ if(done)return; done=true; cleanup(false); resolve(res); };
      s.onerror=()=>{ if(done)return; done=true; cleanup(true); reject(new Error("jsonp error")); };
      s.src=url+(url.includes("?")?"&":"?")+qs.toString();
      document.head.appendChild(s);
    });
  }

  function patchVescoV8Methods(){
    const v8=getV8();
    if(!v8 || v8.__firebasePatchedV10) return;
    v8.__firebasePatchedV10 = true;

    const oldUpdateStatus = v8.updateStatus;
    if(typeof oldUpdateStatus === "function"){
      v8.updateStatus = async function(id, statusNovo){
        await saveOrderPatch(id, {status_logistica:statusNovo, operador:"Painel"});
        try{
          return await oldUpdateStatus.call(v8, id, statusNovo);
        }catch(e){
          console.warn("Apps Script updateStatus falhou; Firebase manteve alteração.", e.message||e);
          return {success:true, firebase:true};
        }
      };
    }

    const oldConfirm = v8.confirmarEntregaRotaSite;
    v8.confirmarEntregaRotaSite = async function(rotaId, token, pedido){
      const recebedor = prompt(`Quem recebeu o pedido #${pedido}?`);
      if(!txt(recebedor)) return null;
      const documento = prompt("Documento/observação de quem recebeu:") || "";
      const observacao = prompt("Observação da entrega:", "Confirmado pelo painel Vesco") || "Confirmado pelo painel Vesco";

      const saved = await confirmDelivery({
        rotaId, token, pedido, recebedor, documento,
        transportador:"Painel Vesco", observacao
      });

      // Apps Script em segundo plano para manter planilha/comprovante, sem travar UI.
      const api = v8.debug && v8.debug().api;
      if(api){
        jsonp(api,{
          action:"confirmarEntregaMotorista",
          rota:rotaId,
          rota_id:rotaId,
          token,
          pedido,
          recebedor,
          documento,
          transportador:"Painel Vesco",
          observacao
        },18000).catch(e=>console.warn("Apps Script confirmar entrega falhou; Firebase manteve confirmação.", e.message||e));
      }else if(typeof oldConfirm === "function"){
        // Não chama para evitar prompt duplicado.
      }

      alert("Entrega confirmada no Firebase em tempo real.");
      return saved;
    };

    console.log("VESCO Firebase V10: métodos do painel sincronizados.");
  }

  async function boot(){
    const wait=()=>new Promise(r=>setTimeout(r,200));
    for(let i=0;i<50;i++){
      if(window.VescoV8) break;
      await wait();
    }
    await startListeners();
  }

  window.VescoFirebase = {
    init: startListeners,
    saveOrderPatch,
    saveRoute,
    confirmDelivery,
    applyRoutesToState,
    applyAllOrderPatches,
    debug:()=>({
      initialized,
      connected:!!db,
      dbUrl:(window.VESCO_FIREBASE_CONFIG||{}).databaseURL || window.VESCO_FIREBASE_DATABASE_URL || "",
      routes:lastRoutes.length,
      orderPatches:Object.keys(lastOrdersPatch||{}).length
    })
  };

  boot().catch(e=>console.error("VESCO Firebase V10 erro:", e));
})();
