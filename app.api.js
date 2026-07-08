// app.api.js — V3.3 FIX
// Corrige o erro: VescoAPI undefined / getObsCached undefined.
// Este arquivo deve ficar na RAIZ do projeto, no mesmo nível do logistica.html.

(function(){
  if (window.VescoAPI && window.VescoAPI.__v33) return;

  const CFG = window.VescoConfig || {};
  const OBS_KEY = CFG.OBS_LINK_KEY || "vesco_obs_link_modular_v2";

  function txt(v){
    return v === null || v === undefined ? "" : String(v).trim();
  }

  function parseObsLink(order){
    const raw = txt(order && (
      order.observacao_logistica ||
      order.observacao ||
      order.observacoes ||
      order.observacao_pedido ||
      ""
    ));

    let obs = txt(order && (order.observacao_pedido || order.obs_pedido || ""));
    let link = txt(order && (order.link_pedido || order.linkPedido || order.link_tiny || ""));

    if (!obs) {
      const m =
        raw.match(/\[Solu[cç][aã]o\]\s*([\s\S]*?)(?=\s*\[Link\]|\s*\[Link pedido\]|\s*$)/i) ||
        raw.match(/\[Obs pedido\]\s*([\s\S]*?)(?=\s*\[Link pedido\]|\s*\[Link\]|\s*$)/i) ||
        raw.match(/Obs:\s*([\s\S]*?)(?=\s*\|\s*Link:|\s*$)/i);

      if (m) obs = txt(m[1]);
    }

    if (!link) {
      const m =
        raw.match(/\[Link\]\s*(https?:\/\/\S+)/i) ||
        raw.match(/\[Link pedido\]\s*(https?:\/\/\S+)/i) ||
        raw.match(/Link:\s*(https?:\/\/\S+)/i) ||
        raw.match(/(https?:\/\/erp\.tiny\.com\.br\/\S+)/i) ||
        raw.match(/(https?:\/\/\S+)/i);

      if (m) link = txt(m[1]).replace(/[)\].,;]+$/g, "");
    }

    if (obs) {
      obs = obs
        .replace(/\s*\[Link\][\s\S]*$/i, "")
        .replace(/\s*\[Link pedido\][\s\S]*$/i, "")
        .replace(/\s*\|\s*Link:[\s\S]*$/i, "")
        .trim();
    }

    return { obs, link, raw };
  }

  function onlyDigits(v){
    return txt(v).replace(/\D/g, "");
  }

  function keys(order, fallback){
    const vals = [
      fallback,
      order && order.id,
      order && order.numero,
      order && order.pedido,
      order && order.id_tiny,
      order && order.pedido_key,
      order && order.numero_ecommerce,
      order && order.numero_ecommerc,
      order && order.ecom,
      order && order.referencia,
      order && order.reference,
      order && order.order_id
    ].map(txt).filter(Boolean);

    const out = new Set();

    vals.forEach(v => {
      out.add(v);
      out.add(v.replace(/^#/, ""));
      const d = onlyDigits(v);
      if (d) out.add(d);
    });

    return Array.from(out).filter(Boolean);
  }

  function readJSON(key, fallback){
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch(e) {
      return fallback;
    }
  }

  function writeJSON(key, value){
    try { localStorage.setItem(key, JSON.stringify(value)); } catch(e) {}
  }

  function saveObsCache(order, id, obs, link){
    const cache = readJSON(OBS_KEY, {});
    keys(order, id).forEach(k => {
      cache[k] = {
        obs: txt(obs),
        link: txt(link),
        ts: Date.now()
      };
    });
    writeJSON(OBS_KEY, cache);
    return cache;
  }

  function getObsCached(order, id){
    const parsed = parseObsLink(order);
    const cache = readJSON(OBS_KEY, {});
    let cached = null;

    for (const k of keys(order, id)) {
      if (cache[k]) {
        cached = cache[k];
        break;
      }
    }

    return {
      obs: txt(parsed.obs || (cached && cached.obs) || ""),
      link: txt(parsed.link || (cached && cached.link) || "")
    };
  }

  function apiBaseERP(){
    return txt(CFG.API || window.API || "");
  }

  function apiBaseFlex(){
    return txt(CFG.API_FLEX || window.API_FLEX || "");
  }

  function appendParams(url, params){
    const u = String(url || "");
    const qs = new URLSearchParams();

    Object.keys(params || {}).forEach(k => {
      const v = params[k];
      if (v === undefined || v === null || String(v).trim() === "") return;
      qs.set(k, v);
    });

    return u + (u.includes("?") ? "&" : "?") + qs.toString();
  }

  function jsonp(url, timeoutMs){
    timeoutMs = timeoutMs || 45000;

    return new Promise(resolve => {
      if (!url) {
        resolve({ ok:false, error:"API não configurada", response:null });
        return;
      }

      if (typeof window.jsonpFetch === "function") {
        try {
          window.jsonpFetch(url, function(err, res){
            if (err) resolve({ ok:false, error:err.message || String(err), response:res });
            else resolve({ ok: !(res && res.success === false), response:res });
          });
          return;
        } catch(e) {
          resolve({ ok:false, error:e.message || String(e), response:null });
          return;
        }
      }

      const cb = "__vesco_api_cb_" + Math.random().toString(36).slice(2);
      const script = document.createElement("script");
      let done = false;

      function finish(result){
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { delete window[cb]; } catch(e) {}
        try { script.remove(); } catch(e) {}
        resolve(result);
      }

      const timer = setTimeout(() => {
        finish({ ok:false, error:"JSONP timeout", response:null });
      }, timeoutMs);

      window[cb] = function(res){
        finish({ ok: !(res && res.success === false), response:res });
      };

      script.onerror = function(){
        finish({ ok:false, error:"JSONP script error", response:null });
      };

      script.src = appendParams(url, { callback: cb, _v: Date.now() });
      document.head.appendChild(script);
    });
  }

  function callERP(params){
    return jsonp(appendParams(apiBaseERP(), params || {}));
  }

  function callFlex(params){
    return jsonp(appendParams(apiBaseFlex(), params || {}));
  }

  async function updateStatus(id, status, observacao){
    return callERP({
      action: "updateStatus",
      id,
      status,
      observacao: observacao || "",
      operador: window.currentOperator || localStorage.getItem("vesco_operator") || ""
    });
  }

  async function saveObsLink(id, obs, link, opts){
    opts = opts || {};

    const operator = window.currentOperator || localStorage.getItem("vesco_operator") || "";
    const legacyObs = `Obs: ${txt(obs)} | Link: ${txt(link)}`;

    const a = await callERP({
      action: "updatePedidoExtras",
      id,
      observacao_pedido: txt(obs),
      link_pedido: txt(link),
      operador: operator
    });

    if (a.ok) {
      window.dispatchEvent(new CustomEvent("vesco:obs-link-saved", { detail: { id, obs, link } }));
      return a;
    }

    const b = await callERP({
      action: "updateStatus",
      id,
      status: opts.status || "",
      observacao: legacyObs,
      operador: operator
    });

    window.dispatchEvent(new CustomEvent("vesco:obs-link-saved", { detail: { id, obs, link } }));
    return b;
  }

  window.VescoAPI = {
    __v33: true,
    callERP,
    callFlex,
    updateStatus,
    saveObsLink,
    saveObsCache,
    getObsCached,
    parseObsLink,
    keys
  };

  console.log("app.api.js V3.3 carregado — VescoAPI disponível.");
})();
