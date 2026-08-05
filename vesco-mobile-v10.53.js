// vesco-mobile-v10.53.js — runtime mobile resiliente, sem bloqueio de toque
(function(){
  "use strict";
  if(window.VescoMobileV1053) return;

  const MQ=window.matchMedia("(max-width: 820px), (max-height: 600px) and (max-width: 950px)");
  const q=(s,r=document)=>r.querySelector(s);
  const qa=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const isMobile=()=>MQ.matches;
  const safeGet=(store,key)=>{try{return store.getItem(key)}catch(_e){return null}};
  const safeSet=(store,key,value)=>{try{store.setItem(key,value)}catch(_e){}};

  let shellReady=false;
  let enhanceTimer=null;
  let viewportQueued=false;
  let lastViewport={w:0,h:0,keyboard:false};
  let busySince=0;

  function clearInteractionLocks(){
    document.body.classList.remove("v1051-nav-busy","v1053-touch-active");
    const content=q("#v8Content");
    if(content) content.setAttribute("aria-busy","false");
    busySince=0;
  }

  function applyViewportVars(){
    viewportQueued=false;
    const vv=window.visualViewport;
    const h=Math.max(320,Math.round(vv?vv.height:window.innerHeight));
    const w=Math.max(280,Math.round(vv?vv.width:window.innerWidth));
    const keyboard=isMobile() && h<window.innerHeight*.76;
    if(Math.abs(h-lastViewport.h)>2){
      document.documentElement.style.setProperty("--vesco-mobile-vh",`${h}px`);
      lastViewport.h=h;
    }
    if(Math.abs(w-lastViewport.w)>2){
      document.documentElement.style.setProperty("--vesco-mobile-vw",`${w}px`);
      lastViewport.w=w;
    }
    if(keyboard!==lastViewport.keyboard){
      document.body.classList.toggle("v1053-keyboard-open",keyboard);
      document.body.classList.toggle("v1052-keyboard-open",keyboard);
      lastViewport.keyboard=keyboard;
    }
    document.body.classList.toggle("v1053-is-mobile",isMobile());
  }
  function queueViewport(){
    if(viewportQueued) return;
    viewportQueued=true;
    requestAnimationFrame(applyViewportVars);
  }

  function setupTopbar(){
    if(!isMobile()) return;
    const actions=q("#v8Topbar .v8-top-actions");
    if(!actions || actions.dataset.v1053Ready==="1") return;
    actions.dataset.v1053Ready="1";

    const search=q("#v8Search",actions), refresh=q("#v8Refresh",actions);
    const date=q("#v8Date",actions), month=q("#v8Month",actions), today=q("#v8Today",actions), clock=q("#v8Clock",actions);
    const quick=document.createElement("div");
    quick.className="v1053-mobile-quick";
    const panel=document.createElement("div");
    panel.className="v1053-filter-panel";
    panel.id="v1053FilterPanel";
    const toggle=document.createElement("button");
    toggle.type="button";
    toggle.id="v1053FiltersToggle";
    toggle.className="v8-btn secondary v1053-filter-toggle";
    toggle.setAttribute("aria-controls","v1053FilterPanel");
    toggle.setAttribute("aria-expanded","false");
    toggle.title="Abrir filtros de data";
    toggle.innerHTML='<i class="fas fa-sliders"></i><span>Filtros</span>';

    if(search){
      search.placeholder="Buscar pedido, cliente ou endereço";
      search.autocomplete="off";
      search.setAttribute("inputmode","search");
      search.setAttribute("enterkeyhint","search");
      search.setAttribute("aria-label","Buscar pedido, cliente ou endereço");
      quick.appendChild(search);
    }
    if(refresh){
      refresh.innerHTML='<i class="fas fa-rotate"></i><span>Atualizar</span>';
      refresh.setAttribute("aria-label","Atualizar dados");
      quick.appendChild(refresh);
    }
    quick.appendChild(toggle);
    [date,month,today,clock].filter(Boolean).forEach(el=>panel.appendChild(el));
    actions.replaceChildren(quick,panel);

    const open=safeGet(sessionStorage,"vesco:v1053:filtersOpen")==="1";
    document.body.classList.toggle("v1053-filters-open",open);
    toggle.setAttribute("aria-expanded",open?"true":"false");
    toggle.addEventListener("click",ev=>{
      ev.preventDefault();
      const next=!document.body.classList.contains("v1053-filters-open");
      document.body.classList.toggle("v1053-filters-open",next);
      toggle.setAttribute("aria-expanded",next?"true":"false");
      safeSet(sessionStorage,"vesco:v1053:filtersOpen",next?"1":"0");
      clearInteractionLocks();
    });
  }

  function setupSidebar(){
    const sidebar=q("#v8Sidebar");
    if(!sidebar || sidebar.dataset.v1053Ready==="1") return;
    sidebar.dataset.v1053Ready="1";
    sidebar.setAttribute("aria-label","Menu principal");
    let close=q(".v1053-sidebar-close",sidebar);
    if(!close){
      close=document.createElement("button");
      close.type="button";
      close.className="v1053-sidebar-close";
      close.setAttribute("aria-label","Fechar menu");
      close.innerHTML='<i class="fas fa-xmark"></i>';
      q(".v8-brand",sidebar)?.appendChild(close);
    }
    close.addEventListener("click",ev=>{
      ev.preventDefault();
      document.body.classList.remove("v8-mobile-menu-open");
      clearInteractionLocks();
    });
  }

  function labelTable(table){
    const heads=qa("thead th",table).map(x=>(x.textContent||"").trim());
    if(!heads.length) return;
    table.classList.add("v1053-card-table");
    qa("tbody tr",table).forEach(row=>{
      qa(":scope > td",row).forEach((td,i)=>{
        if(td.colSpan>1 || td.classList.contains("v8-empty")) return;
        const label=heads[i]||"Informação";
        if(td.dataset.label!==label) td.dataset.label=label;
      });
    });
  }

  function enhanceContent(){
    enhanceTimer=null;
    const root=q("#v8Content");
    if(!root) return;
    qa(".v8-table",root).forEach(labelTable);
    qa("button,a.v8-btn,input,select,textarea",root).forEach(el=>{
      el.dataset.v1053Touch="1";
      if(el.tagName==="BUTTON" && !el.type) el.type="button";
    });
    qa("input,select,textarea",root).forEach(el=>{
      if(el.getAttribute("aria-label")) return;
      const t=el.closest("label")?.querySelector("span")?.textContent?.trim() || el.placeholder || el.title;
      if(t) el.setAttribute("aria-label",t);
    });
    qa(".v8-map",root).forEach(el=>{
      el.setAttribute("role","region");
      el.setAttribute("aria-label","Mapa de pedidos");
    });
    // O mapa é invalidado só quando realmente existe e após a tela estabilizar.
    setTimeout(()=>{
      if(document.hidden || document.body.classList.contains("v1051-nav-busy")) return;
      try{Object.values(window.VescoV8?.state?.maps||{}).forEach(m=>m?.invalidateSize?.(false));}catch(_e){}
    },220);
  }
  function queueEnhance(){
    clearTimeout(enhanceTimer);
    enhanceTimer=setTimeout(()=>requestAnimationFrame(enhanceContent),90);
  }

  function setupObserver(){
    const content=q("#v8Content");
    if(!content || content.dataset.v1053Observed==="1") return;
    content.dataset.v1053Observed="1";
    const observer=new MutationObserver(mutations=>{
      if(mutations.some(m=>m.addedNodes && m.addedNodes.length)) queueEnhance();
    });
    observer.observe(content,{childList:true,subtree:false});
  }

  function openMenu(){
    document.body.classList.add("v8-mobile-menu-open");
    clearInteractionLocks();
  }
  function closeMenu(){
    document.body.classList.remove("v8-mobile-menu-open");
  }

  function setupNavigationGuard(){
    if(document.documentElement.dataset.v1053NavGuard==="1") return;
    document.documentElement.dataset.v1053NavGuard="1";

    document.addEventListener("click",ev=>{
      if(!isMobile()) return;
      const menuToggle=ev.target.closest?.("#v8MobileMenuToggle");
      if(menuToggle){
        ev.preventDefault(); ev.stopImmediatePropagation();
        openMenu();
        return;
      }
      const overlay=ev.target.closest?.("#v8MobileOverlay");
      if(overlay){
        ev.preventDefault(); ev.stopImmediatePropagation();
        closeMenu(); clearInteractionLocks();
        return;
      }
      const nav=ev.target.closest?.("#v8MobileBar [data-tab], #v8Sidebar [data-tab]");
      if(!nav) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      const tab=nav.dataset.tab;
      if(tab==="menu"){ openMenu(); return; }
      closeMenu();
      clearInteractionLocks();
      busySince=Date.now();
      requestAnimationFrame(()=>{
        try{
          if(window.VescoV8?.go) window.VescoV8.go(tab);
          else if(window.VescoV8?.state){ window.VescoV8.state.tab=tab; window.VescoV8.render?.(); }
        }catch(error){
          console.error("V10.53: navegação mobile recuperada",error);
          if(window.VescoV8?.state){ window.VescoV8.state.tab=tab; window.VescoV8.render?.(); }
        }
        setTimeout(clearInteractionLocks,1100);
      });
    },true);

    document.addEventListener("touchstart",()=>{
      document.body.classList.add("v1053-touch-active");
      setTimeout(()=>document.body.classList.remove("v1053-touch-active"),240);
    },{passive:true});

    // Watchdog: nenhuma exceção pode deixar uma camada invisível bloqueando o toque.
    setInterval(()=>{
      if(!isMobile()) return;
      const content=q("#v8Content");
      const busy=document.body.classList.contains("v1051-nav-busy") || content?.getAttribute("aria-busy")==="true";
      if(busy && (!busySince || Date.now()-busySince>1500)) clearInteractionLocks();
      if(!document.body.classList.contains("v8-mobile-menu-open")){
        const overlay=q("#v8MobileOverlay");
        if(overlay) overlay.style.pointerEvents="none";
      }
    },900);
  }

  function setupShell(){
    if(shellReady) return true;
    if(!q("#v8Shell")) return false;
    shellReady=true;
    document.documentElement.classList.add("vesco-v1053-mobile-capable");
    document.body.classList.add("v1053-mobile-ready");
    setupTopbar();
    setupSidebar();
    setupObserver();
    setupNavigationGuard();
    queueEnhance();
    queueViewport();
    clearInteractionLocks();
    return true;
  }

  function boot(){
    if(setupShell()) return;
    let attempts=0;
    const timer=setInterval(()=>{
      attempts++;
      if(setupShell() || attempts>160) clearInterval(timer);
    },50);
  }

  MQ.addEventListener?.("change",()=>{
    queueViewport();
    setupTopbar();
    setupSidebar();
    queueEnhance();
    clearInteractionLocks();
  });
  window.addEventListener("resize",queueViewport,{passive:true});
  window.addEventListener("orientationchange",()=>setTimeout(queueViewport,120),{passive:true});
  window.visualViewport?.addEventListener("resize",queueViewport,{passive:true});
  document.addEventListener("visibilitychange",()=>{if(!document.hidden){queueViewport();clearInteractionLocks();}});
  document.addEventListener("keydown",ev=>{
    if(ev.key!=="Escape") return;
    closeMenu();
    document.body.classList.remove("v1053-filters-open");
    q("#v1053FiltersToggle")?.setAttribute("aria-expanded","false");
    clearInteractionLocks();
  });

  window.VescoMobileV1053={
    version:"V10.53-MOBILE-DESTRAVADO",
    setupShell,enhanceContent,queueViewport,isMobile,clearInteractionLocks
  };
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",boot,{once:true});
  else boot();
  console.log("VESCO Mobile V10.53 ativo — toque destravado, navegação resiliente e viewport leve.");
})();
