// vesco-mobile-v10.52.js — camada mobile progressiva e não destrutiva
(function(){
  "use strict";
  if(window.VescoMobileV1052) return;

  const MQ=window.matchMedia("(max-width: 820px), (max-height: 600px) and (max-width: 950px)");
  let queued=false, shellReady=false;
  const q=(s,r=document)=>r.querySelector(s);
  const qa=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const isMobile=()=>MQ.matches;

  function setViewportVars(){
    const vv=window.visualViewport;
    const h=vv?vv.height:window.innerHeight;
    const w=vv?vv.width:window.innerWidth;
    document.documentElement.style.setProperty("--vesco-mobile-vh",`${Math.max(320,h)}px`);
    document.documentElement.style.setProperty("--vesco-mobile-vw",`${Math.max(280,w)}px`);
    document.body.classList.toggle("v1052-is-mobile",isMobile());
    document.body.classList.toggle("v1052-keyboard-open",isMobile()&&h<window.innerHeight*.78);
  }

  function setupTopbar(){
    if(!isMobile()) return;
    const actions=q("#v8Topbar .v8-top-actions");
    if(!actions||actions.dataset.v1052Ready==="1") return;
    actions.dataset.v1052Ready="1";
    const search=q("#v8Search",actions), refresh=q("#v8Refresh",actions);
    const date=q("#v8Date",actions), month=q("#v8Month",actions), today=q("#v8Today",actions), clock=q("#v8Clock",actions);
    const quick=document.createElement("div"); quick.className="v1052-mobile-quick";
    const panel=document.createElement("div"); panel.className="v1052-filter-panel"; panel.id="v1052FilterPanel";
    const toggle=document.createElement("button");
    toggle.type="button"; toggle.id="v1052FiltersToggle"; toggle.className="v8-btn secondary v1052-filter-toggle";
    toggle.setAttribute("aria-controls","v1052FilterPanel"); toggle.setAttribute("aria-expanded","false");
    toggle.title="Abrir filtros de data"; toggle.innerHTML='<i class="fas fa-sliders"></i><span>Filtros</span>';
    if(search){
      search.placeholder="Buscar pedido, cliente ou endereço"; search.autocomplete="off";
      search.setAttribute("inputmode","search"); search.setAttribute("enterkeyhint","search");
      search.setAttribute("aria-label","Buscar pedido, cliente ou endereço"); quick.appendChild(search);
    }
    if(refresh){refresh.innerHTML='<i class="fas fa-rotate"></i><span>Atualizar</span>';refresh.setAttribute("aria-label","Atualizar dados");quick.appendChild(refresh);}
    quick.appendChild(toggle);
    [date,month,today,clock].filter(Boolean).forEach(el=>panel.appendChild(el));
    actions.replaceChildren(quick,panel);
    const saved=sessionStorage.getItem("vesco:v1052:filtersOpen")==="1";
    document.body.classList.toggle("v1052-filters-open",saved); toggle.setAttribute("aria-expanded",saved?"true":"false");
    toggle.addEventListener("click",()=>{
      const open=!document.body.classList.contains("v1052-filters-open");
      document.body.classList.toggle("v1052-filters-open",open); toggle.setAttribute("aria-expanded",open?"true":"false");
      sessionStorage.setItem("vesco:v1052:filtersOpen",open?"1":"0");
    });
  }

  function setupSidebar(){
    const sidebar=q("#v8Sidebar"); if(!sidebar||sidebar.dataset.v1052Ready==="1") return;
    sidebar.dataset.v1052Ready="1"; sidebar.setAttribute("aria-label","Menu principal");
    const close=document.createElement("button"); close.type="button"; close.className="v1052-sidebar-close";
    close.setAttribute("aria-label","Fechar menu"); close.innerHTML='<i class="fas fa-xmark"></i>';
    q(".v8-brand",sidebar)?.appendChild(close);
    close.addEventListener("click",()=>document.body.classList.remove("v8-mobile-menu-open"));
    qa("#v8Sidebar [data-tab]").forEach(btn=>btn.addEventListener("click",()=>{if(isMobile())document.body.classList.remove("v8-mobile-menu-open");},{passive:true}));
  }

  function labelTable(table){
    const heads=qa("thead th",table).map(x=>(x.textContent||"").trim()); if(!heads.length)return;
    table.classList.add("v1052-card-table");
    qa("tbody tr",table).forEach(row=>qa(":scope > td",row).forEach((td,i)=>{
      if(td.colSpan>1||td.classList.contains("v8-empty"))return; td.dataset.label=heads[i]||"Informação";
    }));
  }
  function enhanceContent(){
    queued=false; const root=q("#v8Content"); if(!root)return;
    qa(".v8-table",root).forEach(labelTable);
    qa("button,a.v8-btn,input,select,textarea",root).forEach(el=>{el.dataset.v1052Touch="1";if(el.tagName==="BUTTON"&&!el.type)el.type="button";});
    qa("input,select,textarea",root).forEach(el=>{if(!el.getAttribute("aria-label")){const t=el.closest("label")?.querySelector("span")?.textContent?.trim()||el.placeholder||el.title;if(t)el.setAttribute("aria-label",t);}});
    qa(".v8-map",root).forEach(el=>{el.setAttribute("role","region");el.setAttribute("aria-label","Mapa de pedidos");});
    setTimeout(()=>{try{Object.values(window.VescoV8?.state?.maps||{}).forEach(m=>m?.invalidateSize?.(false));}catch(_e){}},160);
  }
  function queueEnhance(){if(queued)return;queued=true;requestAnimationFrame(enhanceContent);}

  function setupObservers(){
    const content=q("#v8Content");
    if(content&&!content.dataset.v1052Observed){content.dataset.v1052Observed="1";new MutationObserver(queueEnhance).observe(content,{childList:true,subtree:true});}
  }
  function setupShell(){
    if(shellReady)return true;if(!q("#v8Shell"))return false;shellReady=true;
    document.documentElement.classList.add("vesco-v1052-mobile-capable");document.body.classList.add("v1052-mobile-ready");
    setupTopbar();setupSidebar();setupObservers();queueEnhance();setViewportVars();return true;
  }
  function boot(){if(setupShell())return;let n=0;const t=setInterval(()=>{n++;if(setupShell()||n>120)clearInterval(t);},50);}

  MQ.addEventListener?.("change",()=>{setViewportVars();setupTopbar();setupSidebar();queueEnhance();});
  window.addEventListener("resize",setViewportVars,{passive:true});
  window.visualViewport?.addEventListener("resize",setViewportVars,{passive:true});
  window.visualViewport?.addEventListener("scroll",setViewportVars,{passive:true});
  document.addEventListener("keydown",e=>{if(e.key==="Escape"){document.body.classList.remove("v8-mobile-menu-open","v1052-filters-open");q("#v1052FiltersToggle")?.setAttribute("aria-expanded","false");}});

  window.VescoMobileV1052={version:"V10.52-MOBILE-COMPLETO",setupShell,enhanceContent,setViewportVars,isMobile};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
  console.log("VESCO Mobile V10.52 ativo — layout touch, filtros compactos e tabelas em cards.");
})();
