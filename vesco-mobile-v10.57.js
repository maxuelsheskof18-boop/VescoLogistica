// vesco-mobile-v10.57.js — navegação mobile confiável; nenhuma alteração estrutural no desktop
(function(){
  "use strict";
  if(window.VescoMobileV1057) return;

  const MQ=window.matchMedia("(max-width: 899px), (max-width: 1100px) and (pointer: coarse)");
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

  const SCROLL_LOCK_CLASSES=[
    "v1025-modal-open","v1027-modal-open","v1034-modal-open",
    "vesco-modal-open","vesco-map-open","v1051-scroll-lock"
  ];

  function isActuallyVisible(el){
    if(!el) return false;
    const style=getComputedStyle(el);
    if(style.display==="none"||style.visibility==="hidden"||Number(style.opacity)===0) return false;
    const rect=el.getBoundingClientRect();
    return rect.width>1&&rect.height>1;
  }

  function hasVisibleModal(){
    const selectors=[
      "#v92PedidoModal.open", ".v8-modal.open", ".v8-dialog.open",
      ".v92-modal.open", "[role=dialog][aria-modal=true]"
    ];
    return selectors.some(selector=>qa(selector).some(isActuallyVisible));
  }

  function releaseScrollLock(force=false){
    if(!isMobile()) return false;
    if(!force&&hasVisibleModal()) return false;

    SCROLL_LOCK_CLASSES.forEach(cls=>{
      document.body.classList.remove(cls);
      document.documentElement.classList.remove(cls);
    });

    const html=document.documentElement;
    const body=document.body;
    const nodes=[q("#v8Shell"),q("#v8Main"),q("#v8Content")].filter(Boolean);

    html.style.setProperty("height","auto","important");
    html.style.setProperty("min-height","100%","important");
    html.style.setProperty("overflow-x","hidden","important");
    html.style.setProperty("overflow-y","auto","important");
    html.style.setProperty("touch-action","auto","important");

    body.style.removeProperty("top");
    body.style.removeProperty("left");
    body.style.removeProperty("right");
    body.style.removeProperty("width");
    body.style.setProperty("position","static","important");
    body.style.setProperty("height","auto","important");
    body.style.setProperty("min-height","100%","important");
    body.style.setProperty("max-height","none","important");
    body.style.setProperty("overflow-x","hidden","important");
    body.style.setProperty("overflow-y","visible","important");
    body.style.setProperty("touch-action","pan-y pinch-zoom","important");

    nodes.forEach(node=>{
      node.style.setProperty("height","auto","important");
      node.style.setProperty("max-height","none","important");
      node.style.setProperty("overflow-y","visible","important");
    });
    return true;
  }

  function scrollDiagnostics(){
    const scrolling=document.scrollingElement||document.documentElement;
    return {
      mobile:isMobile(),
      modalOpen:hasVisibleModal(),
      scrollTop:scrolling?.scrollTop||0,
      scrollHeight:scrolling?.scrollHeight||0,
      clientHeight:scrolling?.clientHeight||0,
      bodyOverflow:getComputedStyle(document.body).overflowY,
      htmlOverflow:getComputedStyle(document.documentElement).overflowY,
      bodyPosition:getComputedStyle(document.body).position,
      lockClasses:SCROLL_LOCK_CLASSES.filter(c=>document.body.classList.contains(c)||document.documentElement.classList.contains(c))
    };
  }

  function resetScrollTop(){
    if(!isMobile()) return false;
    const scrolling=document.scrollingElement||document.documentElement||document.body;
    try{ if(scrolling) scrolling.scrollTop=0; }catch(_e){}
    try{ window.scrollTo(0,0); }catch(_e){}
    [q("#v8Main"),q("#v8Content")].filter(Boolean).forEach(el=>{try{el.scrollTop=0}catch(_e){}});
    return true;
  }

  function clearInteractionLocks(){
    document.body.classList.remove("v1051-nav-busy","v1056-touch-active");
    const content=q("#v8Content");
    if(content) content.setAttribute("aria-busy","false");
    busySince=0;
    releaseScrollLock(false);
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
      document.body.classList.toggle("v1056-keyboard-open",keyboard);
      document.body.classList.toggle("v1052-keyboard-open",keyboard);
      lastViewport.keyboard=keyboard;
    }
    document.body.classList.toggle("v1056-is-mobile",isMobile());
  }
  function queueViewport(){
    if(viewportQueued) return;
    viewportQueued=true;
    requestAnimationFrame(applyViewportVars);
  }

  function setupTopbar(){
    if(!isMobile()) return;
    const actions=q("#v8Topbar .v8-top-actions");
    if(!actions || actions.dataset.v1056Ready==="1") return;
    actions.dataset.v1056Ready="1";

    const search=q("#v8Search",actions), refresh=q("#v8Refresh",actions);
    const date=q("#v8Date",actions), month=q("#v8Month",actions), today=q("#v8Today",actions), clock=q("#v8Clock",actions);
    const quick=document.createElement("div");
    quick.className="v1056-mobile-quick";
    const panel=document.createElement("div");
    panel.className="v1056-filter-panel";
    panel.id="v1056FilterPanel";
    const toggle=document.createElement("button");
    toggle.type="button";
    toggle.id="v1056FiltersToggle";
    toggle.className="v8-btn secondary v1056-filter-toggle";
    toggle.setAttribute("aria-controls","v1056FilterPanel");
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

    const open=safeGet(sessionStorage,"vesco:v1056:filtersOpen")==="1";
    document.body.classList.toggle("v1056-filters-open",open);
    toggle.setAttribute("aria-expanded",open?"true":"false");
    toggle.addEventListener("click",ev=>{
      ev.preventDefault();
      const next=!document.body.classList.contains("v1056-filters-open");
      document.body.classList.toggle("v1056-filters-open",next);
      toggle.setAttribute("aria-expanded",next?"true":"false");
      safeSet(sessionStorage,"vesco:v1056:filtersOpen",next?"1":"0");
      clearInteractionLocks();
    });
  }

  function setupSidebar(){
    const sidebar=q("#v8Sidebar");
    if(!sidebar || sidebar.dataset.v1056Ready==="1") return;
    sidebar.dataset.v1056Ready="1";
    sidebar.setAttribute("aria-label","Menu principal");
    let close=q(".v1056-sidebar-close",sidebar);
    if(!close){
      close=document.createElement("button");
      close.type="button";
      close.className="v1056-sidebar-close";
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
    table.classList.add("v1056-card-table");
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
      el.dataset.v1056Touch="1";
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
    if(!content || content.dataset.v1056Observed==="1") return;
    content.dataset.v1056Observed="1";
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
    if(document.documentElement.dataset.v1056NavGuard==="1") return;
    document.documentElement.dataset.v1056NavGuard="1";

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
      resetScrollTop();
      busySince=Date.now();
      requestAnimationFrame(()=>{
        try{
          if(window.VescoV8?.state?.pageByTab) window.VescoV8.state.pageByTab[tab]=1;
          if(window.VescoV8?.go) window.VescoV8.go(tab);
          else if(window.VescoV8?.state){ window.VescoV8.state.tab=tab; window.VescoV8.render?.(); }
        }catch(error){
          console.error("V10.57: navegação mobile recuperada",error);
          if(window.VescoV8?.state){ window.VescoV8.state.tab=tab; window.VescoV8.render?.(); }
        }
        requestAnimationFrame(resetScrollTop);
        setTimeout(resetScrollTop,90);
        setTimeout(clearInteractionLocks,700);
      });
    },true);

    document.addEventListener("touchstart",()=>{
      document.body.classList.add("v1056-touch-active");
      setTimeout(()=>document.body.classList.remove("v1056-touch-active"),240);
    },{passive:true});

    // Watchdog leve: só atua quando há sinal real de trava.
    setInterval(()=>{
      if(!isMobile()) return;
      const content=q("#v8Content");
      const busy=document.body.classList.contains("v1051-nav-busy") || content?.getAttribute("aria-busy")==="true";
      const locked=SCROLL_LOCK_CLASSES.some(c=>document.body.classList.contains(c)||document.documentElement.classList.contains(c));
      const styleLocked=getComputedStyle(document.body).position==="fixed" || getComputedStyle(document.body).overflowY==="hidden";
      if(busy && (!busySince || Date.now()-busySince>1400)) clearInteractionLocks();
      else if((locked||styleLocked) && !hasVisibleModal()) releaseScrollLock(false);
      if(!document.body.classList.contains("v8-mobile-menu-open")){
        const overlay=q("#v8MobileOverlay");
        if(overlay) overlay.style.pointerEvents="none";
      }
    },2500);
  }

  function restoreDesktopPresentation(){
    if(isMobile()) return false;
    document.body.classList.remove("v8-mobile-menu-open","v1056-filters-open","v1056-is-mobile","v1056-keyboard-open");
    q(".v1056-sidebar-close")?.remove();
    const actions=q("#v8Topbar .v8-top-actions");
    if(actions && actions.dataset.v1056Ready==="1"){
      const order=[q("#v8Date"),q("#v8Month"),q("#v8Today"),q("#v8Search"),q("#v8Refresh"),q("#v8Clock")].filter(Boolean);
      actions.replaceChildren(...order);
      delete actions.dataset.v1056Ready;
    }
    return true;
  }

  function setupShell(){
    if(shellReady) return true;
    if(!q("#v8Shell")) return false;
    shellReady=true;
    document.documentElement.classList.add("vesco-v1056-mobile-capable");
    document.body.classList.add("v1056-mobile-ready");
    setupTopbar();
    setupSidebar();
    setupObserver();
    setupNavigationGuard();
    queueEnhance();
    queueViewport();
    releaseScrollLock(true);
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
    if(isMobile()){ setupTopbar(); setupSidebar(); queueEnhance(); clearInteractionLocks(); }
    else restoreDesktopPresentation();
  });
  window.addEventListener("resize",queueViewport,{passive:true});
  window.addEventListener("orientationchange",()=>setTimeout(()=>{queueViewport();releaseScrollLock(false);},120),{passive:true});
  window.addEventListener("pageshow",()=>{queueViewport();releaseScrollLock(true);clearInteractionLocks();},{passive:true});
  window.visualViewport?.addEventListener("resize",queueViewport,{passive:true});
  document.addEventListener("visibilitychange",()=>{if(!document.hidden){queueViewport();clearInteractionLocks();}});
  document.addEventListener("keydown",ev=>{
    if(ev.key!=="Escape") return;
    closeMenu();
    document.body.classList.remove("v1056-filters-open");
    q("#v1056FiltersToggle")?.setAttribute("aria-expanded","false");
    clearInteractionLocks();
  });

  window.VescoMobileV1057={
    version:"V10.57-PAGINACAO-MOBILE-DIRETA",
    setupShell,enhanceContent,queueViewport,isMobile,clearInteractionLocks,releaseScrollLock,scrollDiagnostics,resetScrollTop,restoreDesktopPresentation
  };
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",boot,{once:true});
  else boot();
  console.log("VESCO Mobile V10.57 ativo — navegação e paginação por toque; desktop preservado.");
})();
