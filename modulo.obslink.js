// modulo.obslink.js — V3.3 FIX
// Não quebra se o app.api.js ainda não tiver carregado.
// Mantém obs/link abaixo do pedido.

(function(){
  const S = () => window.VescoState;

  function txt(v){ return v === null || v === undefined ? "" : String(v).trim(); }
  function norm(v){
    return txt(v).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  }
  function esc(v){
    try { if (S() && S().esc) return S().esc(v); } catch(e) {}
    return txt(v).replace(/[&<>"']/g, m => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[m]));
  }

  function allOrders(){
    try { if (S() && S().allOrders) return S().allOrders(); } catch(e) {}
    const a = Array.isArray(window.orders) ? window.orders : [];
    const b = Array.isArray(window.flexOrders) ? window.flexOrders : [];
    return a.concat(b);
  }

  function orderKey(order){
    try { if (S() && S().getKey) return S().getKey(order); } catch(e) {}
    return txt(order && (order.id || order.pedido_key || order.numero || order.id_tiny));
  }

  function keys(order){
    try { if (S() && S().keys) return S().keys(order); } catch(e) {}
    const vals = [
      order && order.id,
      order && order.numero,
      order && order.pedido,
      order && order.id_tiny,
      order && order.pedido_key,
      order && order.numero_ecommerce,
      order && order.ecom
    ].map(txt).filter(Boolean);

    const out = new Set();
    vals.forEach(v => {
      out.add(v);
      out.add(v.replace(/^#/, ""));
      const d = v.replace(/\D/g, "");
      if (d) out.add(d);
    });
    return Array.from(out).filter(Boolean);
  }

  function parseObsLink(order){
    if (window.VescoAPI && typeof window.VescoAPI.parseObsLink === "function") {
      return window.VescoAPI.parseObsLink(order);
    }

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

  function readCache(){
    try {
      const raw =
        localStorage.getItem((window.VescoConfig && window.VescoConfig.OBS_LINK_KEY) || "vesco_obs_link_modular_v2") ||
        localStorage.getItem("vesco_v54_obs_link_cache") ||
        "{}";
      return JSON.parse(raw);
    } catch(e) {
      return {};
    }
  }

  function writeCache(cache){
    try {
      localStorage.setItem((window.VescoConfig && window.VescoConfig.OBS_LINK_KEY) || "vesco_obs_link_modular_v2", JSON.stringify(cache || {}));
    } catch(e) {}
  }

  function saveLocal(order, id, obs, link){
    if (window.VescoAPI && typeof window.VescoAPI.saveObsCache === "function") {
      return window.VescoAPI.saveObsCache(order, id, obs, link);
    }

    const cache = readCache();
    const ks = keys(order);
    ks.push(id);
    ks.filter(Boolean).forEach(k => {
      cache[k] = { obs: txt(obs), link: txt(link), ts: Date.now() };
    });
    writeCache(cache);
    return cache;
  }

  function getObsLink(order){
    const id = orderKey(order);

    if (window.VescoAPI && typeof window.VescoAPI.getObsCached === "function") {
      return window.VescoAPI.getObsCached(order, id);
    }

    const parsed = parseObsLink(order);
    const cache = readCache();
    let cached = null;

    for (const k of keys(order)) {
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

  function findRow(order){
    const ks = keys(order);
    const roots = [
      document.getElementById("view-separacao"),
      document.getElementById("view-retiradas"),
      document.getElementById("view-logistica"),
      document.getElementById("view-envios_flex"),
      document.getElementById("view-saiu"),
      document.body
    ].filter(Boolean);

    for (const root of roots) {
      const rows = Array.from(root.querySelectorAll("tr, .vesco-retirada-card, [data-pedido], [data-num], .pedido-card"));
      for (const row of rows) {
        const text = row.innerText || "";
        if (ks.some(k => k && text.includes(k))) return row;
      }
    }
    return null;
  }

  function findPedidoCell(row, order){
    if (!row) return null;
    const ks = keys(order);
    const cells = Array.from(row.querySelectorAll("td, .vesco-retirada-info, .min-w-0"));
    for (const c of cells) {
      const t = c.innerText || "";
      if (ks.some(k => k && t.includes(k))) return c;
    }
    return row.querySelector("td:nth-child(2), td:nth-child(3), .vesco-retirada-info, .min-w-0") || row;
  }

  function hydrateInputs(){
    allOrders().forEach(order => {
      const data = getObsLink(order);
      if (!data.obs && !data.link) return;

      keys(order).forEach(k => {
        ["vesco-obs-v16-", "solucao-"].forEach(prefix => {
          const el = document.getElementById(prefix + k);
          if (el && !txt(el.value)) el.value = data.obs;
        });
        ["vesco-link-v16-", "link-"].forEach(prefix => {
          const el = document.getElementById(prefix + k);
          if (el && !txt(el.value)) el.value = data.link;
        });
      });
    });
  }

  function renderBadges(){
    document.querySelectorAll("#sub-fila .vesco-obslink-box, #sub-pend .vesco-obslink-box, .tab-btn .vesco-obslink-box").forEach(el => el.remove());

    allOrders().forEach(order => {
      const data = getObsLink(order);
      if (!data.obs && !data.link) return;

      const row = findRow(order);
      if (!row) return;

      let box = row.querySelector(".vesco-obslink-box");
      if (!box) {
        box = document.createElement("div");
        box.className = "vesco-obslink-box";
        const target = findPedidoCell(row, order);
        target.appendChild(box);
      }

      box.innerHTML = `
        ${data.obs ? `<span class="vesco-obs-pill"><b>Obs:</b> ${esc(data.obs)}</span>` : ""}
        ${data.link ? `<a class="vesco-link-pill" href="${esc(data.link)}" target="_blank" rel="noopener noreferrer">Abrir link do pedido</a>` : ""}
      `;
    });
  }

  async function save(id, obs, link, opts){
    opts = opts || {};

    if (opts.requireObs && !txt(obs)) return alert("Informe a observação/solução antes de salvar.");
    if (opts.requireLink && !txt(link)) return alert("Cole o link do pedido antes de salvar.");

    const order = allOrders().find(o => keys(o).includes(String(id)) || keys(o).includes(String(id).replace(/\D/g, "")));

    if (order) {
      order.observacao_pedido = txt(obs);
      order.link_pedido = txt(link);
    }

    saveLocal(order, id, obs, link);
    hydrateInputs();
    renderBadges();

    let result = { ok:false, local:true };

    if (window.VescoAPI && typeof window.VescoAPI.saveObsLink === "function") {
      result = await window.VescoAPI.saveObsLink(id, obs, link, opts);
    } else if (typeof window.updateStatusJsonp === "function") {
      try {
        window.updateStatusJsonp(id, opts.status || "", `Obs: ${txt(obs)} | Link: ${txt(link)}`);
        result = { ok:true, fallback:"updateStatusJsonp" };
      } catch(e) {}
    }

    window.dispatchEvent(new CustomEvent("vesco:obs-link-saved", { detail: { id, obs, link } }));

    setTimeout(() => {
      hydrateInputs();
      renderBadges();
    }, 250);

    return result;
  }

  function readFormNear(btn){
    const row = btn.closest("tr, .vesco-retirada-card, .pedido-card, [data-pedido], [data-num]") || document;
    const text = row.innerText || "";

    let id = btn.dataset.id || btn.dataset.pedido || row.dataset.pedido || row.dataset.num || "";
    if (!id) {
      const m = text.match(/#\s*([0-9A-Za-z._-]{4,})/) || text.match(/\b(\d{5,})\b/);
      if (m) id = m[1];
    }

    const obsEl =
      row.querySelector('textarea[id^="vesco-obs-v16-"], textarea[id^="solucao-"], input[id^="vesco-obs-v16-"], input[id^="solucao-"]') ||
      document.getElementById("vesco-obs-v16-" + id) ||
      document.getElementById("solucao-" + id);

    const linkEl =
      row.querySelector('input[id^="vesco-link-v16-"], input[id^="link-"], textarea[id^="vesco-link-v16-"], textarea[id^="link-"]') ||
      document.getElementById("vesco-link-v16-" + id) ||
      document.getElementById("link-" + id);

    return { id, obs: obsEl ? obsEl.value : "", link: linkEl ? linkEl.value : "" };
  }

  function intercept(e){
    const btn = e.target && e.target.closest && e.target.closest("button, a");
    if (!btn) return;

    const t = norm(btn.textContent || btn.value || "");
    if (!t.includes("salvar obs") && !t.includes("salvar solucao") && !t.includes("salvar solução")) return;

    const form = readFormNear(btn);
    if (!form.id) return;

    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();

    save(form.id, form.obs, form.link, {
      status: t.includes("solucao") || t.includes("solução") ? "Pendente" : undefined,
      requireObs: t.includes("solucao") || t.includes("solução"),
      requireLink: t.includes("solucao") || t.includes("solução")
    });
  }

  window.salvarExtrasPedidoV16 = function(id){
    const row = document.getElementById("vesco-obs-v16-" + id)?.closest("tr, .pedido-card, [data-pedido]") || document;
    const obsEl = row.querySelector('[id^="vesco-obs-v16-"], [id^="solucao-"]') || document.getElementById("vesco-obs-v16-" + id);
    const linkEl = row.querySelector('[id^="vesco-link-v16-"], [id^="link-"]') || document.getElementById("vesco-link-v16-" + id);
    return save(id, obsEl ? obsEl.value : "", linkEl ? linkEl.value : {});
  };

  window.salvarSolucaoPendencia = function(id){
    const row = document.getElementById("solucao-" + id)?.closest("tr, .pedido-card, [data-pedido]") || document;
    const obsEl = row.querySelector('[id^="solucao-"], [id^="vesco-obs-v16-"]') || document.getElementById("solucao-" + id);
    const linkEl = row.querySelector('[id^="link-"], [id^="vesco-link-v16-"]') || document.getElementById("link-" + id);
    return save(id, obsEl ? obsEl.value : "", linkEl ? linkEl.value : "", { status:"Pendente", requireObs:true, requireLink:true });
  };

  function apply(){
    try {
      hydrateInputs();
      renderBadges();
    } catch(e) {
      console.warn("VescoObsLink V3.3 apply protegido:", e);
    }
  }

  function init(){
    document.removeEventListener("click", intercept, true);
    document.addEventListener("click", intercept, true);

    window.addEventListener("vesco:rendered", () => setTimeout(apply, 220));
    window.addEventListener("vesco:loaded", () => setTimeout(apply, 700));
    window.addEventListener("vesco:obs-link-saved", () => setTimeout(apply, 100));

    if (!window.__vescoObsLinkV33Interval) {
      window.__vescoObsLinkV33Interval = setInterval(apply, 1800);
    }

    setTimeout(apply, 500);
    setTimeout(apply, 1500);
  }

  window.VescoObsLink = {
    __v33: true,
    init,
    apply,
    save,
    hydrateInputs,
    renderBadges,
    getObsLink,
    findRow
  };

  init();
  console.log("modulo.obslink V3.3 ativo — sem crash se VescoAPI faltar.");
})();
