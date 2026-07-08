// modulo.vesco-v8-operacional.js — V10.6 RASTREAMENTO MOTORISTA
// Correções: Flex sem ERP, logística sem entregues, faturamento mensal com seletor de mês, coordenadas sem inversão.

(function(){
  if (window.VescoV8 && window.VescoV8.__v106) return;

  const API_MAIN = window.VESCO_API_URL || "https://script.google.com/macros/s/AKfycbxEzbxBABMDwi7B7tn_1p-lC0vc50JjHFOrH3w42Oog2-5R2-WMYSrQ27ED7wduJUN6/exec";
  const API_FLEX = window.VESCO_API_FLEX_URL || "https://script.google.com/macros/s/AKfycbzDp2qs2S_MxDc_3afY1TurNKYEwfYKkk2cc4IliNxLiVaJuSKYyRqofOUMnhdFBjwNwg/exec";

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
    tarefas: [],
    rotaFlexExtras: [],
    geoAutoRunning: {},
    geoCache: {},
    flexArchive: {},
    flexMonthView: todayISO().slice(0,7),
    motoristasLocalizacao: {},
    motoristaTrackingFocus: "",
    driverTrackTimer: null,
    sidebarCollapsed: localStorage.getItem("vesco:v8:sidebarCollapsed")==="1"
  };

  function sleep(ms){ return new Promise(resolve=>setTimeout(resolve, ms)); }
  function txt(v){ return v === null || v === undefined ? "" : String(v).trim(); }
  function norm(v){ return txt(v).normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim(); }
  function keyNorm(v){ return norm(v).replace(/\s+/g,""); }
  function esc(v){ return txt(v).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function todayISO(){ return new Date().toLocaleDateString("en-CA", { timeZone:"America/Sao_Paulo" }); }
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
  function parseMoney(v){ if(typeof v==="number") return Number.isFinite(v)?v:0; let s=txt(v); if(!s) return 0; s=s.replace(/[^\d,.-]/g,""); if(s.includes(",")&&s.includes(".")) s=s.replace(/\./g,"").replace(",","."); else if(s.includes(",")) s=s.replace(",","."); const n=parseFloat(s); return Number.isFinite(n)?n:0; }

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

  function orderKey(o){ return txt(pick(o,["pedido_key","pedidoKey","id","id_tiny","idTiny","numero","pedido","numero_pedido","numeroPedido"])); }
  function number(o){ return txt(pick(o,["numero","pedido","id_tiny","idTiny","id","numero_pedido","numeroPedido"]) || orderKey(o)); }
  function ecom(o){ return txt(pick(o,["numero_ecommerce","numeroEcommerce","ecommerce","e_commerce","ecom","id_ecommerce","idEcommerce"])); }
  function client(o){ return txt(pick(o,["cliente_nome","clienteNome","cliente nome","destinatario","destinatário","cliente","nome","nome_destinatario","nomeDestinatario"]) || "Cliente não informado"); }
  function address(o){ return txt(pick(o,["endereco_completo","enderecoCompleto","endereco completo","endereco","endereço","address","full_address","fullAddress"])); }
  function statusAll(o){ return [pick(o,["status_logistica","statusLogistica","status logistica"]), pick(o,["situacao_tiny","situacaoTiny","situacao tiny"]), pick(o,["situacao_nome","situacaoNome","situacao nome"]), pick(o,["situacao","situação"]), pick(o,["status_tiny","statusTiny","status tiny"]), pick(o,["status"]), pick(o,["is_delivered"]), pick(o,["is_delivered","entregue"])] .map(txt).join(" | "); }
  function status(o){ return txt(pick(o,["status_logistica","statusLogistica","status logistica","status"]) || pick(o,["situacao_nome","situacaoNome","situacao","situação","situacao_tiny","status_tiny"]) || ""); }
  function formaText(o){ return [pick(o,["id_forma_envio","idFormaEnvio","idFormaEnvioPsq","forma_envio_id","id forma envio"]), pick(o,["forma_envio_nome","formaEnvioNome","nome_forma_envio","nomeformafenvio","forma envio nome"]), pick(o,["forma_envio","formaEnvio","forma envio"]), pick(o,["transportadora"]), pick(o,["tipo_entrega","tipoEntrega","tipo entrega"]), pick(o,["prioridade_label","prioridadeLabel","prioridade label"]), pick(o,["is_flex"]), pick(o,["__source","__v8source"])] .map(txt).join(" | "); }
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
  function dueDate(o){ return parseISO(pick(o,["data_prevista_iso","data_prevista","dataPrevisao","data_previsao","data previsão","data_pedido","dataPedido","data","created_at","criado_em","data_criacao","data_emissao","data_entrega"])); }
  function deliveryDate(o){ return parseISO(pick(o,["data_entregue_iso","data_entregue","entregue_em","finalizado_em","data_finalizado","data_entrega_realizada","concluido_em"])); }
  function sepDate(o){ return parseISO(pick(o,["data_separacao_iso","data_conclusao_separacao","dataSeparacao","data_separacao","separado_em","separado_data","data_separado","conclusao_separacao_em","fim_separacao_em","separacao_fim_em","hora_conclusao","status_atualizado_em","atualizado_em"])); }
  function value(o){ const v = pick(o,["valor_num","valor_total","valorPedido","valor_pedido","valor","total","total_pedido","preco_total","preco","valor_nf","valor_venda","receita"]); return parseMoney(v); }
  function isDelivered(o){
    if(String(pick(o,["is_delivered"])).toLowerCase()==="true") return true;
    const s=norm(statusAll(o));
    if(
      s.includes("nao entregue") || s.includes("não entregue") ||
      s.includes("a entregar") || s.includes("saiu para entrega") ||
      s.includes("em rota") || s.includes("pendente") ||
      s.includes("a separar") || s.includes("em separacao") ||
      s.includes("em separação") || s.includes("separado") ||
      s.includes("pronto")
    ) return false;
    if(deliveryDate(o)) return true;
    // Faturado não é entregue. Só sai da Logística quando for Entregue/Finalizado/Concluído ou tiver data real de entrega.
    return s==="entregue" || s==="finalizado" || s==="finalizada" || s==="concluido" || s==="concluído" || s.includes("entrega realizada") || s.includes("pedido entregue") || s.includes("confirmado entregue");
  }

  function isFlexIndicator(o){
    if(String(pick(o,["is_flex"])).toLowerCase()==="true") return true;
    const raw=formaText(o);
    const s=norm(raw);
    return raw.includes("780391986") || !!pick(o,["id_flex","flex_id","numero_flex","id_envio_flex"]) || s.includes("mercado envios flex") || s.includes("envios flex") || s.includes(" flex");
  }
  function isRetirada(o){ const raw=formaText(o); const s=norm(raw); return s.includes("retirada") || s.includes("retirar pessoalmente") || s.includes("retirar na loja") || s.includes("cliente retira") || ["747632298","758290131","860463094"].some(id=>raw.includes(id)); }
  function hasAddress(o){ const a=norm(address(o)); if(!a || a==="-" || a==="—") return false; return !(a.includes("endereco nao disponivel") || a.includes("endereço não disponível") || a.includes("sem endereco") || a.includes("sem endereço") || a.includes("nao informado") || a.includes("não informado")); }

  function coords(o){
    let lat = parseFloat(String(pick(o,["lat","latitude","lat_destino","latitude_destino","geo_lat"]) ?? "").replace(",","."));
    let lon = parseFloat(String(pick(o,["lon","lng","longitude","lon_destino","lng_destino","longitude_destino","geo_lon"]) ?? "").replace(",","."));
    if(!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const okBR = lat >= -34 && lat <= 6 && lon >= -74 && lon <= -34;
    const swappedBR = lon >= -34 && lon <= 6 && lat >= -74 && lat <= -34;
    if(!okBR && swappedBR){ const t=lat; lat=lon; lon=t; }
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
    n.data_prevista_iso = dueDate(n);
    n.data_entregue_iso = deliveryDate(n);
    n.data_separacao_iso = sepDate(n);
    n.valor_num = value(n);
    n.marcador_flex_id = flexMarker(n);
    const c = coords(n); if(c){ n.lat=c.lat; n.lon=c.lon; }
    n.is_delivered = isDelivered(n);
    n.is_flex = src === "flex" || isFlexIndicator(n);
    n.is_retirada = isRetirada(n);
    n.has_address = hasAddress(n);
    return n;
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
    if(!isStrictFlexMarker(o)) return false;
    // V8.7.2: a API Flex já é a fonte filtrada/validada pelo Apps Script.
    // Algumas respostas antigas não trazem marcador_validado_no_detalhe no JSON,
    // então o painel aceita origem API Flex + marcador válido.
    const source=txt(pick(o,["__v8source","__source","source"])).toLowerCase();
    return flexValidated(o) || source==="flex";
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
    return "vesco_cache/painel/" + state.date + "_" + state.month.replace(/[^0-9-]/g,"_");
  }
  function localSnapshotKey(){
    return "vesco:v102:snapshot:" + state.date + ":" + state.month;
  }
  function snapshotFromState(){
    return {
      version:"V10.6",
      date:state.date,
      month:state.month,
      updated_at:new Date().toISOString(),
      orders:state.orders||[],
      flex:state.flex||[],
      rotas:state.rotas||[]
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
  function applyOrderPatchesFromFirebase(orders, patches){
    if(!patches || typeof patches!=="object") return orders;
    return (orders||[]).map(o=>{
      const vals=[orderKey(o),number(o),ecom(o),o.id,o.id_tiny,o.numero,o.numero_ecommerce,o.pedido_key].map(txt).filter(Boolean);
      const patchKey=Object.keys(patches).find(k=>vals.some(v=>firebaseSafeId(v)===k || v===k));
      return patchKey ? Object.assign({}, o, patches[patchKey]) : o;
    });
  }
  async function getOrderPatchesFirebase(){
    try{ return await firebaseGet("vesco_operacao/orders", 2500) || {}; }
    catch(e){ return {}; }
  }
  async function applySnapshot(snap, source){
    if(!snap) return false;
    const patches=await getOrderPatchesFirebase();
    let orders=(snap.orders||[]).map(o=>normalizeOrder(o,"erp")).filter(o=>!o.is_flex);
    orders=applyOrderPatchesFromFirebase(orders, patches);
    let flex=(snap.flex||[]).map(o=>normalizeOrder(o,"flex")).filter(o=>o.is_flex && isFlexProjeto(o) && !o.is_delivered);
    let rotas=mergeRotas(Array.isArray(snap.rotas)?snap.rotas:[]);
    state.orders=dedup(orders).filter(o=>!o.is_flex);
    state.flex=dedup(flex).filter(o=>o.is_flex && isFlexProjeto(o) && !o.is_delivered);
    state.rotas=rotas;
    state.loaded=true;
    state.lastSnapshotSource=source||"snapshot";
    state.loading=false;
    showLoading(false);
    updateBadges();
    return true;
  }
  async function loadFirebaseSnapshot(){
    try{
      const snap=await firebaseGet(firebaseCacheKey(), 3500);
      if(snap) return snap;
    }catch(e){}
    try{
      const latest=await firebaseGet("vesco_cache/painel/latest", 3500);
      if(latest) return latest;
    }catch(e){}
    return null;
  }
  async function saveFirebaseSnapshot(snap){
    if(!snap) return;
    saveLocalSnapshot(snap);
    try{ await firebasePut(firebaseCacheKey(), snap, 6500); }catch(e){ console.warn("V10.6: não salvou cache por data no Firebase.", e.message||e); }
    try{ await firebasePut("vesco_cache/painel/latest", snap, 6500); }catch(e){ console.warn("V10.6: não salvou cache latest no Firebase.", e.message||e); }
  }
  async function firebasePatchOrder(id, patch){
    const payload=Object.assign({}, patch||{}, {updated_at:new Date().toISOString()});
    const key=firebaseSafeId(id);
    try{ await firebasePatch("vesco_operacao/orders/" + key, payload, 6500); }
    catch(e){ console.warn("V10.6: patch Firebase falhou.", e.message||e); }
    const all=[...(state.orders||[]),...(state.flex||[])];
    all.forEach(o=>{
      const vals=[orderKey(o),number(o),ecom(o),o.id,o.id_tiny,o.numero,o.numero_ecommerce,o.pedido_key].map(txt).filter(Boolean);
      if(vals.some(v=>v===txt(id) || firebaseSafeId(v)===key)) Object.assign(o,payload);
    });
    saveLocalSnapshot(snapshotFromState());
    return payload;
  }
  async function refreshFromAppsScriptBackground(){
    let orders=[];
    let flex=[];
    let rotas=[];
    let gotAnything=false;

    try{
      const main=await jsonp(API_MAIN,{action:"loadVesco",dataISO:state.date,mes:state.month},15000);
      state.lastPayload=main;
      const apiOrders=extractArray(main,["pedidos","orders","rows","data"]).map(o=>normalizeOrder(o,"erp"));
      if(apiOrders.length){
        orders=apiOrders.filter(o=>!o.is_flex);
        gotAnything=true;
      }
    }catch(e){
      console.warn("V10.6: Apps Script ERP lento/indisponível; Firebase mantém UI.", e.message);
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
      console.warn("V10.6: Apps Script Flex lento/indisponível; Firebase mantém UI.", e.message);
    }

    try{
      const rp=await jsonp(API_MAIN,{action:"listarRotasMotorista",dataISO:state.date},10000);
      rotas=extractArray(rp,["rotas","data","rows"]);
      if(rotas.length) gotAnything=true;
    }catch(e){
      console.warn("V10.6: rotas Apps Script lento/indisponível; Firebase/local mantém UI.", e.message);
    }

    if(!gotAnything) return false;

    if(!orders.length && state.orders.length) orders=state.orders;
    if(!flex.length && state.flex.length) flex=state.flex;
    rotas=mergeRotas(rotas.length?rotas:state.rotas);

    const patches=await getOrderPatchesFirebase();
    orders=applyOrderPatchesFromFirebase(orders, patches);

    state.orders=dedup(orders).filter(o=>!o.is_flex);
    state.flex=dedup(flex).filter(o=>o.is_flex && isFlexProjeto(o) && !o.is_delivered);
    state.rotas=rotas;
    state.loaded=true;
    state.loading=false;
    showLoading(false);
    updateBadges();

    const snap=snapshotFromState();
    await saveFirebaseSnapshot(snap);

    try{ render(); }catch(e){}
    return true;
  }


async function loadData(force=false){
    if(state.loading) return;
    state.loading=true;
    showLoading(true);

    // V10.6: Firebase-first. A tela não fica presa esperando Apps Script.
    let quickLoaded=false;

    const snapFb=await loadFirebaseSnapshot();
    if(snapFb){
      quickLoaded=await applySnapshot(snapFb,"firebase");
    }else{
      const snapLocal=loadLocalSnapshot();
      if(snapLocal) quickLoaded=await applySnapshot(snapLocal,"localStorage");
    }

    if(quickLoaded){
      showLoading(false);
      // Atualiza em segundo plano, sem travar operadores.
      setTimeout(()=>refreshFromAppsScriptBackground(),250);
      return;
    }

    // Se ainda não existe cache, libera a tela rápido e busca dados em segundo plano.
    state.orders=state.orders||[];
    state.flex=state.flex||[];
    state.rotas=mergeRotas(state.rotas||[]);
    state.loaded=true;
    state.loading=false;
    showLoading(false);
    updateBadges();

    setTimeout(()=>refreshFromAppsScriptBackground(),100);
  }

  function showLoading(show){ let el=document.getElementById("v8Loading"); if(!el){el=document.createElement("div"); el.id="v8Loading"; el.className="v8-loading"; el.innerHTML="<div>Carregando dados...</div>"; document.body.appendChild(el);} el.style.display=show?"grid":"none"; }

  function untilDate(o){ const d=dueDate(o); return !d || d<=state.date; }
  function inMonth(o){ return (dueDate(o)||"").slice(0,7)===state.month; }
  function logisticaList(){ return dedup(state.orders).filter(o=>!o.is_delivered && !o.is_retirada && o.has_address && untilDate(o)); }
  function flexList(){
    // V8.7: Flex da operação vem somente da API Flex atual.
    // Armazenamento antigo não entra mais na lista viva, para evitar pedidos sujos.
    const month = state.month || state.date.slice(0,7);
    return dedup(state.flex||[])
      .filter(o=>o.is_flex)
      .filter(o=>isFlexProjeto(o))
      .filter(o=>!o.is_delivered)
      .filter(o=>{
        const m=flexMonthOf(o);
        return !month || !m || m===month;
      });
  }

  function retiradaList(){ return dedup(state.orders).filter(o=>!o.is_delivered && (o.is_retirada || !o.has_address) && untilDate(o)); }
  function entreguesList(){
    // Entregues só com data real de entrega no dia selecionado.
    return dedup(state.orders)
      .filter(o=>!o.is_flex)
      .filter(o=>o.is_delivered)
      .filter(o=>deliveryDate(o)===state.date);
  }

  function separadosList(){
    // Nunca usa data do pedido como atalho. Usa conclusão real ou data da última atualização do status.
    const all=dedup(state.orders);
    const byRealDate=all.filter(o=>sepDate(o)===state.date);
    if(byRealDate.length) return byRealDate;

    return all.filter(o=>{
      const s=norm(statusAll(o));
      const statusOk=s.includes("separado")||s.includes("pronto")||s.includes("despachado");
      if(!statusOk) return false;
      const updated=parseISO(pick(o,[
        "status_atualizado_em",
        "ultima_atualizacao_status",
        "operador_ultima_alteracao_em",
        "atualizado_em",
        "ultima_sincronizacao"
      ]));
      return updated===state.date;
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
  function routeReadyList(){
    // V8.7.3: Pronto para Envio não carrega todos os Flex.
    // Flex só entra na rota quando digitado/adicionado pelo número ou e-commerce.
    const erp=prontoList().map(o=>({...o,__rotaSource:"ERP"}));
    const flex=routeFlexExtras();
    return dedup(erp.concat(flex));
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

    document.body.classList.toggle("v8-sidebar-collapsed", !!state.sidebarCollapsed);

    function isMobile(){ return window.matchMedia && window.matchMedia("(max-width: 760px)").matches; }
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
      await loadData(true);
      render();
    });
    document.getElementById("v8Month").addEventListener("change",async e=>{
      state.month=e.target.value||state.date.slice(0,7);
      state.flexMonthView=state.month;
      await loadData(true);
      render();
    });
    document.getElementById("v8Today").addEventListener("click",async()=>{
      state.date=todayISO();
      const d=document.getElementById("v8Date");
      if(d)d.value=state.date;
      await loadData(true);
      render();
    });
    document.getElementById("v8Refresh").addEventListener("click",async()=>{await loadData(true); render();});
    document.getElementById("v8Search").addEventListener("input",()=>render());

    function bindNav(selector){
      document.querySelectorAll(selector).forEach(btn=>btn.addEventListener("click",async()=>{
        const tab=btn.dataset.tab;
        if(tab==="menu"){ openMobileMenu(); return; }
        state.tab=tab;
        closeMobileMenu();
        await ensureData();
        render();
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
    document.getElementById("v8Content").innerHTML=`
      ${kpis(kpi)}
      <div class="v8-card">
        <div class="v8-card-head">
          <div><h3>${esc(title)}</h3><small>${list.length} registro(s)</small></div>
        </div>
        <div class="v8-table-wrap">
          <table class="v8-table">
            <thead><tr>${columns.map(c=>`<th>${esc(c.h)}</th>`).join("")}</tr></thead>
            <tbody>${list.length?list.map(o=>`<tr>${columns.map(c=>`<td>${c.render(o)}</td>`).join("")}</tr>`).join(""):`<tr><td colspan="${columns.length}" class="v8-empty"><b>${esc(empty||"Nenhum registro encontrado.")}</b></td></tr>`}</tbody>
          </table>
        </div>
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
    const sep=separacaoList().length;
    const pronta=prontoList().length;
    const log=logisticaList().length;
    const flex=flexList().length;
    const ret=retiradaList().length;
    const pend=pendenciasProdutoList().length;
    const rotaStats=routeOrdersStats();
    const ent=entreguesList().length;

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
          <button onclick="VescoV8.go('separados')"><i class="fas fa-boxes-stacked"></i><span>Separados hoje</span><b>${separadosList().length}</b></button>
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
            <table class="v8-table"><thead><tr><th>Pedido</th><th>Cliente</th><th>Entrega</th></tr></thead><tbody>${entreguesList().slice(0,8).map(o=>`<tr><td>#${esc(number(o)||orderKey(o))}</td><td>${esc(client(o))}</td><td>${br(deliveryDate(o))}</td></tr>`).join("")||`<tr><td colspan="3" class="v8-empty"><b>Nenhuma entrega hoje.</b></td></tr>`}</tbody></table>
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
  function pendenciasProdutoList(){
    return dedup(state.orders)
      .filter(o=>!o.is_flex)
      .filter(o=>!o.is_delivered)
      .filter(hasPendenciaProduto);
  }

  function separacaoList(){
    return dedup(state.orders)
      .filter(o=>!o.is_flex)
      .filter(o=>!o.is_delivered)
      .filter(untilDate)
      .filter(o=>{
        const s=norm(statusAll(o));
        return !s || s.includes("a separar") || s.includes("em separacao") || s.includes("em separação") || s.includes("pendente");
      });
  }

  function renderSeparacao(){
    const allList=searchFilter(separacaoList());
    const pendencias=searchFilter(pendenciasProdutoList());
    const list=dedup(allList.concat(pendencias));
    setPage("Separação","Fila ativa de pedidos ERP ainda não separados.");
    const totalValue=list.reduce((s,o)=>s+value(o),0);
    document.getElementById("v8Content").innerHTML=`
      ${kpis([
        {label:"Na fila",value:String(list.length),small:"pedidos a separar"},
        {label:"Com endereço",value:String(list.filter(o=>o.has_address).length),small:"podem ir para rota depois"},
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
          <div><h3>Pedidos aguardando separação</h3><small>${list.length} registro(s)</small></div>
          <div class="v8-card-actions"><button class="v8-btn secondary" onclick="VescoV8.definirOperador()">Operador</button></div>
        </div>
        <div class="v8-table-wrap">
          <table class="v8-table v92-separacao-table">
            <thead><tr><th>Pedido</th><th>Cliente / endereço / aviso</th><th>Data</th><th>Forma</th><th>Pagamento</th><th>Status</th><th>Ação</th></tr></thead>
            <tbody>${list.length?list.map(o=>{
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
      </div>`;
  }

  
  
  function prontoList(){
    const base=dedup(state.orders);
    const byStatus=base.filter(o=>{
      const s=norm(statusAll(o));
      return s.includes("separado") || s.includes("pronto") || s.includes("despachado") || s.includes("pendente de entrega") || s.includes("saiu para entrega");
    });
    const bySeparated=typeof separadosList==="function" ? separadosList() : [];
    return dedup(byStatus.concat(bySeparated))
      .filter(o=>!o.is_flex)
      .filter(o=>!o.is_delivered)
      .filter(o=>!o.is_retirada)
      .filter(o=>o.has_address);
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

    // V10.6: SEMPRE leva data como fallback.
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
    const rotas=Array.isArray(state.rotas)?state.rotas:[];
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
        const order=found || fallbackOrderFromStop(Object.assign({}, stop||{}, {pedido:key}), r);
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
      if(renderDom) renderMotoristasAoVivoIntoDom();
      return state.motoristasLocalizacao;
    }catch(e){
      console.warn("V10.6: localização motorista indisponível.", e.message||e);
      return state.motoristasLocalizacao||{};
    }
  }
  function startMotoristaTrackingPolling(){
    if(state.driverTrackTimer) return;
    refreshMotoristasLocalizacao(false);
    state.driverTrackTimer=setInterval(()=>refreshMotoristasLocalizacao(true),10000);
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
    const rotas=Array.isArray(state.rotas)?state.rotas:[];
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
      const r=row.rota, loc=row.loc, ok=locOk(loc);
      const cls=ok?locStatusClass(loc):"red";
      const age=ok?locAgeText(loc.updated_at||loc.atualizado_em):"sem localização";
      const speed=txt(loc?.velocidade_kmh || loc?.speed_kmh || "");
      const acc=txt(loc?.precisao_m || loc?.accuracy || "");
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
          <button class="v8-btn" onclick="VescoV8.focarMotoristaRota('${esc(row.rota_id)}')">Acompanhar</button>
        </div>
      </div>`;
    }).join("")}</div>`;
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
    const row=routeOrdersRows().find(r=>txt(r.rota_id)===txt(rotaId) && (txt(r.key)===txt(pedido) || txt(number(r.order))===txt(pedido) || txt(orderKey(r.order))===txt(pedido)));
    const o=row && row.order;
    const numero=number(o)||pedido;
    const recebedor=prompt(`Quem recebeu o pedido #${numero}?`);
    if(!txt(recebedor)) return;
    const documento=prompt("Documento/observação de quem recebeu:") || "";
    const observacao=prompt("Observação da entrega:", "Confirmado pelo painel Vesco") || "Confirmado pelo painel Vesco";

    try{
      showLoading(true);
      const resp=await jsonp(API_MAIN,{
        action:"confirmarEntregaMotorista",
        rota:rotaId,
        rota_id:rotaId,
        token,
        pedido,
        recebedor,
        documento,
        transportador:"Painel Vesco",
        observacao
      },30000);
      showLoading(false);
      if(!resp || resp.success===false) throw new Error(resp && resp.error ? resp.error : "Não foi possível confirmar entrega.");
      await loadData(true);
      renderProntoEnvio();
      alert("Entrega confirmada com sucesso.");
      return resp;
    }catch(e){
      showLoading(false);
      alert("Erro ao confirmar entrega: " + (e.message || e));
      return null;
    }
  }

  function renderRotasCriadas(){
    const rotas=Array.isArray(state.rotas)?state.rotas:[];
    if(!rotas.length) return '<div class="v8-empty"><b>Nenhuma rota criada nesta data.</b></div>';
    return rotas.map(r=>{
      const app=routeMotoristaLink(r);
      const maps=routeGoogleMapsLink(r);
      const waze=routeWazeLink(r);
      const wa=whatsappRouteLink(r, app);

      // Tenta salvar no Firebase em segundo plano, mas o botão não depende disso.
      if(firebaseEnabled() && !r.__firebaseSaved){
        saveRouteFirebase(r).then(res=>{
          if(res && res.success){
            r.__firebaseSaved=true;
            saveLocalRota(r);
          }
        }).catch(()=>{});
      }

      return `<div class="v8-route-item">
        <div>
          <b>${esc(r.nome_rota||r.nome||"Rota")}</b>
          <span>Motorista: ${esc(r.motorista||"—")} • Pedidos: ${routePedidosCount(r)} • ${esc(r.criado_em||r.criadoEm||"")}</span>
        </div>
        <div class="v8-route-actions">
          <a class="v8-btn" href="${esc(app)}" target="_blank" rel="noopener">App motorista</a>
          <a class="v8-btn secondary" href="${esc(maps)}" target="_blank" rel="noopener">Google Maps</a>
          <a class="v8-btn orange" href="${esc(waze)}" target="_blank" rel="noopener">Waze</a>
          <button type="button" class="v8-btn secondary" data-link="${esc(app)}" onclick="VescoV8.copyRouteLinkDirect(this.dataset.link)">Copiar link</button>
          <a class="v8-btn green" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>
        </div>
      </div>`;
    }).join("");
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
    if(ok) console.log("V10.6: link copiado automaticamente.");
  }


  function renderProntoEnvio(){
    const addedFlex=routeFlexExtras();
    const list=searchFilter(routeReadyList());
    const erpCount=list.filter(o=>txt(o.__rotaSource)==="ERP").length;
    const flexCount=addedFlex.length;
    const sepSource=prontoList();
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

          <div class="v8-table-wrap">
            <table class="v8-table">
              <thead><tr><th>Sel</th><th>Tipo</th><th>Pedido</th><th>Cliente / endereço</th><th>Data</th><th>Pagamento</th><th>Status</th><th>Mapa</th></tr></thead>
              <tbody>
                ${list.length?list.map(o=>{
                  const src=txt(o.__rotaSource)==="Flex"?"Flex":"ERP";
                  const id=orderKey(o)||number(o)||ecom(o);
                  const checked=src==="Flex"?"checked":"";
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

          <div class="v8-card-head v9-routes-created"><div><h3>Rotas criadas</h3><small>${(state.rotas||[]).length} rota(s) na data</small></div></div>
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
          <div id="v106MotoristasAoVivo" class="v106-driver-live">${renderMotoristasAoVivo()}</div>
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
    document.getElementById("v8FlexRotaBusca")?.addEventListener("keydown",e=>{ if(e.key==="Enter") addFlexToRouteByCode(); });
    renderMap("logistica", true, list);
    startMotoristaTrackingPolling();
  }

  
  async function salvarRotaSelecionada(){
    const pedidos=Array.from(document.querySelectorAll(".v8-route-check:checked")).map(i=>i.value).filter(Boolean);
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
    // V10.6: status instantâneo no Firebase com operador e horário real de separação.
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
    setTimeout(()=>document.getElementById("v92_modal_pendencia")?.focus(),60);
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
    setTimeout(()=>document.getElementById("v92_modal_obs")?.focus(),60);
  }

  async function salvarObsLinkPedido(id){
    const obs=txt(document.getElementById("v92_modal_obs")?.value);
    const link=txt(document.getElementById("v92_modal_link")?.value);
    try{
      showLoading(true);
      const resp=await jsonp(API_MAIN,{
        action:"updatePedidoExtras",
        id,
        observacao_pedido:obs,
        observacao:obs,
        link_pedido:link,
        link
      },16000);
      showLoading(false);
      if(resp && resp.success===false) throw new Error(resp.error||"erro");
      fecharPedidoModal();
      await loadData(true);
      render();
      return resp;
    }catch(e){
      showLoading(false);
      alert("Erro ao salvar observação/link: " + e.message);
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
    const relatorio=`[Pendência de produto] Operador: ${operador} | Tipo: ${tipo} | Pendência: ${pend}${obs ? " | Obs: " + obs : ""}`;
    try{
      showLoading(true);
      const extras=await jsonp(API_MAIN,{
        action:"updatePedidoExtras",
        id,
        observacao_pedido:relatorio,
        observacao:relatorio,
        link_pedido:link,
        link,
        pendencia_produto:pend,
        operador_pendencia:operador,
        tipo_pendencia:tipo
      },16000);
      if(extras && extras.success===false) throw new Error(extras.error||"erro extras");
      const st=await jsonp(API_MAIN,{action:"updateStatus",id,status:"Pendência de produto",operador},16000);
      if(st && st.success===false) throw new Error(st.error||"erro status");
      showLoading(false);
      fecharPedidoModal();
      await loadData(true);
      renderSeparacao();
      return {extras,st};
    }catch(e){
      showLoading(false);
      alert("Erro ao registrar pendência: " + e.message);
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
    const texto=`[Pendência resolvida] Operador: ${operador} | ${obs}`;
    try{
      showLoading(true);
      const extras=await jsonp(API_MAIN,{
        action:"updatePedidoExtras",
        id,
        observacao_pedido:texto,
        observacao:texto,
        pendencia_produto:"",
        operador_pendencia:operador
      },16000);
      if(extras && extras.success===false) throw new Error(extras.error||"erro extras");
      const st=await jsonp(API_MAIN,{action:"updateStatus",id,status:"A Separar",operador},16000);
      if(st && st.success===false) throw new Error(st.error||"erro status");
      showLoading(false);
      await loadData(true);
      renderSeparacao();
      return {extras,st};
    }catch(e){
      showLoading(false);
      alert("Erro ao resolver pendência: " + e.message);
      return null;
    }
  }

    function renderSeparados(){
    const list=searchFilter(separadosList());
    tablePage({
      title:"Separados Hoje",
      sub:"",
      kpi:[
        {label:"Separados",value:String(list.length),small:"na data"},
        {label:"Iniciados por",value:String(new Set(list.map(sepStartOperator).filter(Boolean)).size),small:"operador início"},
        {label:"Finalizados por",value:String(new Set(list.map(sepEndOperator).filter(Boolean)).size),small:"operador conclusão"},
        {label:"Com tempo",value:String(list.filter(o=>sepTempo(o)!=="—").length),small:"duração calculada"}
      ],
      list,
      empty:"Nenhum pedido separado nessa data.",
      columns:[
        {h:"Pedido",render:orderCell},
        {h:"Cliente",render:o=>`<b>${esc(client(o))}</b>${pagamentoHtml(o)}`},
        {h:"Iniciado por",render:o=>esc(sepStartOperator(o)||"—")},
        {h:"Início",render:o=>esc(brDateTime(sepStartTime(o)))},
        {h:"Finalizado por",render:o=>esc(sepEndOperator(o)||"—")},
        {h:"Separado",render:o=>esc(brDateTime(sepEndTime(o)))},
        {h:"Tempo",render:o=>esc(sepTempo(o))},
        {h:"Status",render:o=>`<span class="v8-chip green">${esc(status(o)||"Separado")}</span>`}
      ]
    });
  }

  function renderRetiradas(){ const list=searchFilter(retiradaList()); tablePage({title:"Retiradas / sem rota",sub:"Se não houver pedidos nesta regra, o contador fica zerado.",kpi:[{label:"Total",value:String(list.length),small:"retirada ou sem endereço"},{label:"Retirada",value:String(list.filter(o=>o.is_retirada).length),small:"forma retirada"},{label:"Sem endereço",value:String(list.filter(o=>!o.has_address).length),small:"precisa corrigir"},{label:"Valor",value:money(list.reduce((s,o)=>s+value(o),0)),small:"pedidos sem rota"}],list,empty:"Nenhum pedido para retirada ou sem rota.",columns:[{h:"Pedido",render:orderCell},{h:"Cliente",render:clientCell},{h:"Motivo",render:o=>`${o.is_retirada?'<span class="v8-chip green">Retirada</span>':''} ${!o.has_address?'<span class="v8-chip orange">Sem endereço</span>':''}`},{h:"Data",render:o=>`<span class="v8-chip gray">${br(dueDate(o))}</span>`},{h:"Status",render:o=>esc(status(o)||"Pendente")},{h:"Ação",render:o=>`<button class="v8-btn green" onclick="VescoV8.marcarRetirada('${esc(orderKey(o)||number(o))}')">Registrar</button>`}]}); updateBadges(); }
  function renderEntregues(){ const list=searchFilter(entreguesList()); tablePage({title:"Entregues",sub:"Somente pedidos com data real de entrega na data selecionada.",kpi:[{label:"Entregues hoje",value:String(list.length),small:br(state.date)},{label:"Clientes",value:String(new Set(list.map(client)).size),small:"únicos"},{label:"Valor",value:money(list.reduce((s,o)=>s+value(o),0)),small:"entregas do dia"},{label:"Com recebedor",value:String(list.filter(o=>txt(pick(o,["recebedor","nome_recebedor","recebido_por"]))).length),small:"documentado"}],list,empty:"Nenhuma entrega finalizada nessa data.",columns:[{h:"Pedido",render:orderCell},{h:"Cliente / endereço",render:clientCell},{h:"Data entrega",render:o=>`<span class="v8-chip green">${br(deliveryDate(o))}</span>`},{h:"Recebedor",render:o=>esc(pick(o,["recebedor","nome_recebedor","recebido_por"])||"—")},{h:"Status",render:o=>`<span class="v8-chip green">${esc(status(o)||"Entregue")}</span>`},{h:"Valor",render:o=>money(value(o))}]}); }

  function renderLogistica(){
    const list=searchFilter(logisticaList());
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
          <div class="v8-card-head"><div><h3>Pedidos ERP para entrega</h3><small>${list.length} pedido(s)</small></div></div>
          <div class="v8-table-wrap"><table class="v8-table"><thead><tr><th>Pedido</th><th>Cliente / endereço</th><th>Data</th><th>Status</th><th>Valor</th><th>Ação</th></tr></thead><tbody>${list.length?list.map(o=>`<tr><td>${orderCell(o)} ${dueDate(o)&&dueDate(o)<state.date?'<span class="v8-chip red">Atrasado</span>':'<span class="v8-chip green">Do dia</span>'}</td><td>${clientCell(o)}</td><td><span class="v8-chip gray">${br(dueDate(o))}</span></td><td>${esc(status(o)||"Pendente")}</td><td>${money(value(o))}</td><td><button class="v8-btn green" onclick="VescoV8.updateStatus('${esc(orderKey(o)||number(o))}','Entregue')">Entregue</button></td></tr>`).join(""):`<tr><td colspan="6" class="v8-empty"><b>Nenhum ERP pendente para entrega.</b></td></tr>`}</tbody></table></div>
        </div>
        <div class="v8-card v8-map-card">
          <div class="v8-map-toolbar"><div><h3>Mapa ERP</h3><small>Somente pedidos da lista</small></div><button class="v8-btn secondary" onclick="VescoV8.renderMap('logistica', true)">Ajustar</button></div>
          <div id="v8-map-logistica" class="v8-map"></div><div id="v8-map-logistica-stats" class="v8-map-stats"></div>
        </div>
      </div>`;
    renderMap("logistica",true);
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
    const list=searchFilter(flexList());
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
      `<div class="v8-grid"><div class="v8-card"><div class="v8-card-head"><div><h3>Pedidos Flex</h3><small>${list.length} pedido(s)</small></div><div class="v8-card-actions"><button class="v8-btn secondary" onclick="VescoV8.openFlexMonth('${esc(month)}')">Recarregar mês</button></div></div><div class="v8-table-wrap"><table class="v8-table"><thead><tr><th>Pedido/E-com</th><th>Destinatário</th><th>Produtos</th><th>Data</th><th>Valor</th><th>Conta</th><th>Status</th><th>Ação</th></tr></thead><tbody>${list.length?list.map(o=>`<tr><td>${orderCell(o)}</td><td>${clientCell(o)}</td><td>${produtoHtml(o)}</td><td><span class="v8-chip gray">${br(dueDate(o))}</span></td><td>${money(value(o))}</td><td><span class="v8-chip blue">${esc(pick(o,["conta","loja","store_name"])||"Flex")}</span></td><td><span class="v8-chip orange">Flex pendente</span></td><td><button class="v8-btn orange" onclick="VescoV8.openMapForOrder('flex','${esc(number(o)||orderKey(o)||ecom(o))}')">${coords(o)?"Mapa":"Maps"}</button></td></tr>`).join(""):`<tr><td colspan="8" class="v8-empty"><b>Nenhum Flex neste mês.</b></td></tr>`}</tbody></table></div></div><div class="v8-card v8-map-card"><div class="v8-map-toolbar"><div><h3>Radar Flex</h3><small>Somente pedidos da lista</small></div><button class="v8-btn secondary" onclick="VescoV8.renderMap('flex', true)">Ajustar</button></div><div id="v8-map-flex" class="v8-map"></div><div id="v8-map-flex-stats" class="v8-map-stats"></div></div></div>`;
    renderMap("flex",true);
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

  async function geocodeAddressViaFlexApi(endereco){
    const a=txt(endereco);
    if(!a || a==="—" || a==="-") return null;
    if(state.geoCache[a]) return state.geoCache[a];
    const res=await jsonp(API_FLEX,{action:"geocodeEndereco",endereco:a,address:a},60000);
    const ok=(res && (res.status==="OK" || res?.resultado?.status==="OK"));
    const out=ok ? (res.status==="OK"?res:res.resultado) : res;
    state.geoCache[a]=out;
    return out;
  }
  function applyGeoToOrder(o, ge){
    if(!o || !ge || ge.status!=="OK") return false;
    const lat=parseFloat(String(ge.lat).replace(",","."));
    const lon=parseFloat(String(ge.lon ?? ge.lng).replace(",","."));
    if(!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    o.lat=lat;
    o.lon=lon;
    o.latitude=lat;
    o.longitude=lon;
    o.geocode_status="OK_AUTO_MAP";
    return true;
  }
  async function autoGeocodeMap(type,list){
    const key=`${type}:${state.tab}:${state.date}:${state.month}`;
    if(state.geoAutoRunning[key]) return false;
    const missing=(list||[]).filter(o=>!coords(o)&&hasAddress(o)).slice(0,25);
    if(!missing.length) return false;
    state.geoAutoRunning[key]=true;
    let updated=0, fail=0;
    try{
      for(const o of missing){
        try{
          const ge=await geocodeAddressViaFlexApi(address(o));
          if(applyGeoToOrder(o,ge)) updated++; else fail++;
        }catch(e){ fail++; }
        await sleep(180);
      }
      if(updated){
        const stats=document.getElementById(`v8-map-${type}-stats`);
        if(stats) stats.innerHTML+=`<span class="ok">${updated} endereço(s) geocodificado(s) agora</span>`;
        setTimeout(()=>renderMap(type,true,list),250);
      }else if(fail){
        const stats=document.getElementById(`v8-map-${type}-stats`);
        if(stats) stats.innerHTML+=`<span class="warn">geocode automático sem resultado neste lote</span>`;
      }
      return updated>0;
    }finally{
      state.geoAutoRunning[key]=false;
    }
  }

function render(){
    closeMaps();
    updateBadges();
    if(state.tab==="dashboard") return renderDashboard();
    if(state.tab==="separacao") return renderSeparacao();
    if(state.tab==="separados") return renderSeparados();
    if(state.tab==="logistica") return renderLogistica();
    if(state.tab==="flex") return renderFlex();
    if(state.tab==="retiradas") return renderRetiradas();
    if(state.tab==="tarefas") return renderTarefasFrota();
    if(state.tab==="entregues") return renderEntregues();
    if(state.tab==="saiu") return renderProntoEnvio();
    return renderDashboard();
  }

  function updateBadges(){
    function setTabBadge(tab,count){
      const btn=document.querySelector(`#v8Sidebar [data-tab="${tab}"]`);
      if(!btn) return;
      let b=btn.querySelector(".v105-menu-badge");
      if(!b){
        b=document.createElement("b");
        b.className="v105-menu-badge";
        btn.appendChild(b);
      }
      b.textContent=String(count);
      b.style.display=count>0?"inline-grid":"none";
    }
    setTabBadge("separacao", separacaoList().length + pendenciasProdutoList().length);
    setTabBadge("saiu", prontoList().length + routeFlexExtras().length);
    setTabBadge("logistica", logisticaList().length);
    setTabBadge("retiradas", retiradaList().length);
    setTabBadge("tarefas", tarefasFrotaList().filter(t=>t.status!=="Concluída").length);
    setTabBadge("flex", flexList().length);
    setTabBadge("separados", separadosList().length);
    const b=document.getElementById("v8RetBadge"); if(b) b.textContent=String(retiradaList().length);
  }
  function closeMaps(){ Object.keys(state.maps).forEach(k=>{ try{state.maps[k].remove()}catch(e){} }); state.maps={}; state.layers={}; state.markers={logistica:{},flex:{}}; }
  function mapIcon(type,label){ return L.divIcon({className:"",html:`<div class="v8-marker ${type==="flex"?"flex":""}">${label}</div>`,iconSize:[31,31],iconAnchor:[15,15]}); }
  function ensureMap(type){ if(typeof L==="undefined")return null; const el=document.getElementById(`v8-map-${type}`); if(!el)return null; if(state.maps[type])return state.maps[type]; const map=L.map(el,{preferCanvas:true,zoomControl:true}).setView([-23.5505,-46.6333],11); L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap"}).addTo(map); state.maps[type]=map; state.layers[type]=L.layerGroup().addTo(map); setTimeout(()=>map.invalidateSize(true),120); return map; }
  function listForMap(type){ return type==="flex"?searchFilter(flexList()):searchFilter(logisticaList()); }
  function renderMap(type,forceFit=false,listOverride=null){
    const map=ensureMap(type);
    if(!map) return false;
    const list=Array.isArray(listOverride)?listOverride:listForMap(type);
    const plotted=list.filter(coords);
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
      const missingAddress=list.filter(o=>!coords(o)&&hasAddress(o)).length;
      stats.innerHTML=`<span class="ok">${plotted.length}/${list.length} no mapa interno</span><span class="warn">${list.length-plotted.length} sem lat/lon</span><span>${missingAddress} com endereço</span>${missingAddress?`<button class="v8-mini-btn" onclick="VescoV8.openGoogleMapsForList('${type}')">Abrir no Google Maps por endereço</button>`:""}`;
    }
    setTimeout(()=>{try{map.invalidateSize(true); if(pts.length&&forceFit){ if(pts.length===1) map.setView(pts[0],15); else map.fitBounds(L.latLngBounds(pts).pad(.16),{maxZoom:14}); }}catch(e){}},100);
    if((list.length-plotted.length)>0){
      setTimeout(()=>autoGeocodeMap(type,list),350);
    }
    return true;
  }

  function focus(type,id){ if(type==="flex"&&state.tab!=="flex"){state.tab="flex"; renderFlex();} if(type==="logistica"&&state.tab!=="logistica"){state.tab="logistica"; renderLogistica();} renderMap(type,false); const clean=txt(id).replace(/^#/,""); let marker=state.markers[type][clean]; if(!marker){const d=clean.replace(/\D/g,""); if(d)marker=state.markers[type][d];} if(!marker){alert("Pedido sem coordenada ainda. O painel vai tentar localizar pelo endereço; se não entrar no mapa, rode Rodar coordenadas ou confira o endereço."); autoGeocodeMap(type,listForMap(type)); return false;} const map=state.maps[type]; setTimeout(()=>{map.setView(marker.getLatLng(),17); marker.openPopup(); map.invalidateSize(true);},120); return true; }
  function marcarRetirada(id){ if(typeof updateStatusJsonp==="function"){updateStatusJsonp(id,"Entregue","Retirada registrada pelo painel"); setTimeout(async()=>{await loadData(true); renderRetiradas();},800);} else alert("Função updateStatusJsonp não encontrada. Confira se app.js está carregado."); }
  async function ensureData(){ if(!state.loaded) await loadData(true); }
  async function go(tab){ state.tab=tab; await ensureData(); render(); }
  function interceptOldClicks(){ document.addEventListener("click",e=>{ const btn=e.target.closest?.("[data-v7tab], [data-v8tab], #v7Sidebar button, .tab-nav button"); if(!btn)return; const label=norm(btn.dataset.v7tab||btn.dataset.v8tab||btn.textContent||""); const map={"dashboard":"dashboard","separacao":"separacao","separados hoje":"separados","separados":"separados","logistica":"logistica","logistica erp":"logistica","logística":"logistica","pronto para envio":"saiu","retiradas":"retiradas","tarefas frota":"tarefas","tarefas":"tarefas","frota":"tarefas","envios flex":"flex","flex":"flex","entregues":"entregues"}; const tab=map[label]||(label.includes("separados")?"separados":label.includes("log")?"logistica":label.includes("flex")?"flex":""); if(tab){e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); go(tab);}},true); }
  async function init(){ state.tarefas=loadTarefas(); autoCleanFlexStorageV87(); layout(); interceptOldClicks(); window.focusOrderOnMap=id=>focus("logistica",id); window.focusFlexOnMap=id=>focus("flex",id); await loadData(true); render(); }
  window.VescoV8={__v82:true,__v821:true,__v84:true,__v86:true,__v861:true,__v87:true,__v871:true,__v872:true,__v873:true,__v874:true,__v875:true,__v876:true,__v90:true,__v91:true,__v92:true,__v921:true,__v922:true,__v93:true,__v94:true,__v95:true,__v100:true,__v101:true,__v102:true,__v103:true,__v104:true,__v105:true,__v106:true,state,init,go,
    openFlexMonth:async(month)=>{state.month=month||state.month; const m=document.getElementById("v8Month"); if(m)m.value=state.month; await loadData(true); renderFlex();},
    saveFlexMonthNow:()=>{const saved=saveStoredFlex(flexList(),state.month); alert(saved.saved?`Mês armazenado: ${monthLabel(saved.month)} — ${saved.total} pedido(s).`:`Nada novo para armazenar em ${monthLabel(saved.month)}.`); renderFlex(); return saved;},
    refreshFlexOnly:async()=>{await loadData(true); saveStoredFlex(state.flex,state.month); renderFlex();},
    clearFlexStorage:()=>{const removed=clearFlexStorage(); alert(`Armazenamento Flex limpo: ${removed.length} item(ns). Clique em Atualizar Flex.`); renderFlex(); return removed;},
    autoCleanFlexStorageV87,
    sleep,
    routeReadyList,routeFlexExtras,addFlexToRouteByCode,removeFlexFromRoute,routeMotoristaLink,routeOfflinePayload,encodeRoutePayload,routeOrdersRows,routeOrdersStats,renderPedidosEmRota,confirmarEntregaRotaSite,openMapForRouteOrder,shareRouteById,openShareRouteModal,copyShareInput,closeShareModal,copyRouteLinkById,copyRouteLinkDirect,openWhatsAppRouteById,whatsappRouteLink,saveRouteFirebase,testFirebaseRoutes,fastRouteLink,localRotas,firebasePatchOrder,refreshFromAppsScriptBackground,loadFirebaseSnapshot,saveFirebaseSnapshot,refreshMotoristasLocalizacao,renderMotoristasAoVivo,focarMotoristaRota,startMotoristaTrackingPolling,stopMotoristaTrackingPolling,
    salvarDetalhesPedido,marcarPendenciaProduto,resolverPendenciaProduto,pendenciasProdutoList,abrirRelatorioPendencia,abrirObsLinkPedido,salvarObsLinkPedido,salvarRelatorioPendencia,fecharPedidoModal,
    runFlexGeocode,statusFlexGeocode,autoGeocodeMap,geocodeAddressViaFlexApi,openMapForOrder,openGoogleMapsForList,googleMapsDirectionsUrlFromOrders,
    renderTarefasFrota,registrarTarefaFrota,concluirTarefaFrota,removerTarefaFrota,tarefasFrotaList,
    sidebar:()=>{state.sidebarCollapsed=!state.sidebarCollapsed; document.body.classList.toggle("v8-sidebar-collapsed",state.sidebarCollapsed); localStorage.setItem("vesco:v8:sidebarCollapsed",state.sidebarCollapsed?"1":"0");},
    today:async()=>{state.date=todayISO(); const d=document.getElementById("v8Date"); if(d)d.value=state.date; await loadData(true); render();},refresh:async()=>{await loadData(true); render();},render,renderDashboard,renderLogistica,renderFlex,renderRetiradas,renderEntregues,renderSeparados,renderMap,logisticaList,flexList,retiradaList,entreguesList,separadosList,marcarRetirada,updateStatus,definirOperador,operadorAtual,produtosText,pagamentoText,renderSeparacao,renderProntoEnvio,copyRouteLink,routeMotoristaLink,routeGoogleMapsLink,routeWazeLink,parseMoney,debug(){return{version:"V10.6",date:state.date,month:state.month,loaded:state.loaded,orders:state.orders.length,flex:state.flex.length,logistica:logisticaList().length,retiradas:retiradaList().length,entregues:entreguesList().length,separados:separadosList().length,pendencias:pendenciasProdutoList().length,erpMonth:state.orders.filter(inMonth).length,flexMonth:state.flex.filter(inMonth).length,api:API_MAIN,apiFlex:API_FLEX,payloadCounts:state.lastPayload?.counts||null,flexRaw:state.lastFlexRawCount,flexAccepted:state.lastFlexAcceptedCount,flexRejectedSamples:state.lastFlexRejectedSamples,flexPayloadVersion:state.lastFlexPayload?.version||state.lastFlexPayload?.data?.version||null,flexPayloadTotal:state.lastFlexPayload?.total||state.lastFlexPayload?.data?.total||null,flexPayloadPorConta:state.lastFlexPayload?.por_conta||state.lastFlexPayload?.data?.por_conta||null,sampleFlex:flexList().slice(0,3).map(o=>({pedido:number(o),ecom:ecom(o),conta:pick(o,["conta","loja","store_name"]),marcador:flexMarker(o),validado:flexValidated(o),source:pick(o,["__v8source","__source"]),status:statusAll(o),delivered:isDelivered(o)})),sampleLog:logisticaList().slice(0,3).map(o=>({pedido:number(o),status:statusAll(o),delivered:isDelivered(o),date:dueDate(o)}))}}};
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",init); else init();
  console.log("VESCO V10.6 ativo — rastreamento do motorista em tempo real via Firebase.");
})();
