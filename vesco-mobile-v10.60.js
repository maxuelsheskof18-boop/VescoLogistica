// VESCO V10.60 — mobile com rolagem nativa do documento.
// Não intercepta touch, pointer, wheel ou clique dos botões operacionais.
(function(){
  "use strict";
  if(window.VescoMobileV1060) return;

  const MQ=window.matchMedia("(max-width: 899px)");
  const q=(s,r=document)=>r.querySelector(s);
  const qa=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const isMobile=()=>MQ.matches;
  const safeGet=(store,key)=>{try{return store.getItem(key)}catch(_e){return null}};
  const safeSet=(store,key,value)=>{try{store.setItem(key,value)}catch(_e){}};
  let resizeTimer=null;
  let lastMobile=null;

  function hasVisibleModal(){
    return qa("#v92PedidoModal.open,.v8-modal.open,.v8-dialog.open,.v92-modal.open,[role=dialog][aria-modal=true]")
      .some(el=>{
        const st=getComputedStyle(el),r=el.getBoundingClientRect();
        return st.display!=="none"&&st.visibility!=="hidden"&&r.width>1&&r.height>1;
      });
  }

  function nativeScroller(){
    return document.scrollingElement || document.documentElement || document.body;
  }

  function clearStaleLocks(){
    if(!isMobile()) return;
    document.body.classList.remove("v1051-nav-busy","v1056-touch-active","v1051-scroll-lock");
    document.documentElement.classList.remove("v1051-scroll-lock");
    if(!hasVisibleModal()){
      document.body.classList.remove("v1025-modal-open","v1027-modal-open");
    }
    const content=q("#v8Content");
    if(content){
      content.setAttribute("aria-busy","false");
      content.style.removeProperty("height");
      content.style.removeProperty("max-height");
      content.style.removeProperty("overflow-y");
    }
  }

  function resetScrollTop(){
    if(!isMobile()) return false;
    try{window.scrollTo({top:0,left:0,behavior:"auto"});}
    catch(_e){nativeScroller().scrollTop=0;}
    return true;
  }

  function scrollDiagnostics(){
    const s=nativeScroller();
    return {
      version:"V10.60-MOBILE-SCROLL-NATIVO",
      mobile:isMobile(),
      scroller:s?.tagName||"document",
      scrollTop:Number(s?.scrollTop||0),
      scrollHeight:Number(s?.scrollHeight||0),
      clientHeight:Number(s?.clientHeight||0),
      canScroll:Number(s?.scrollHeight||0)>Number(s?.clientHeight||0)+2,
      htmlOverflowY:getComputedStyle(document.documentElement).overflowY,
      bodyOverflowY:getComputedStyle(document.body).overflowY,
      bodyTouchAction:getComputedStyle(document.body).touchAction,
      mainOverflowY:q("#v8Main")?getComputedStyle(q("#v8Main")).overflowY:null,
      overlayPointerEvents:q("#v8MobileOverlay")?getComputedStyle(q("#v8MobileOverlay")).pointerEvents:null,
      menuOpen:document.body.classList.contains("v8-mobile-menu-open"),
      modalOpen:hasVisibleModal(),
      locks:[...document.body.classList].filter(x=>/lock|busy|modal-open|touch-active/.test(x)),
      effectivePageSize:window.VescoV8?.debug?.().effectivePageSize||null
    };
  }

  function setupTopbar(){
    if(!isMobile()) return;
    const actions=q("#v8Topbar .v8-top-actions");
    if(!actions||actions.dataset.v1060Ready==="1") return;
    actions.dataset.v1060Ready="1";
    const search=q("#v8Search",actions),refresh=q("#v8Refresh",actions);
    const date=q("#v8Date",actions),month=q("#v8Month",actions),today=q("#v8Today",actions),clock=q("#v8Clock",actions);
    const quick=document.createElement("div");
    quick.className="v1060-mobile-quick";
    const panel=document.createElement("div");
    panel.className="v1060-filter-panel";
    panel.id="v1060FilterPanel";
    const toggle=document.createElement("button");
    toggle.type="button";
    toggle.id="v1060FiltersToggle";
    toggle.className="v8-btn secondary v1060-filter-toggle";
    toggle.setAttribute("aria-controls","v1060FilterPanel");
    toggle.innerHTML='<i class="fas fa-sliders"></i><span>Filtros</span>';
    if(search){search.placeholder="Buscar pedido, cliente ou endereço";quick.appendChild(search);}
    if(refresh){refresh.innerHTML='<i class="fas fa-rotate"></i><span>Atualizar</span>';quick.appendChild(refresh);}
    quick.appendChild(toggle);
    [date,month,today,clock].filter(Boolean).forEach(el=>panel.appendChild(el));
    actions.replaceChildren(quick,panel);
    const open=safeGet(sessionStorage,"vesco:v1060:filtersOpen")==="1";
    document.body.classList.toggle("v1060-filters-open",open);
    toggle.setAttribute("aria-expanded",open?"true":"false");
    toggle.addEventListener("click",()=>{
      const next=!document.body.classList.contains("v1060-filters-open");
      document.body.classList.toggle("v1060-filters-open",next);
      toggle.setAttribute("aria-expanded",next?"true":"false");
      safeSet(sessionStorage,"vesco:v1060:filtersOpen",next?"1":"0");
    });
  }

  function restoreDesktopTopbar(){
    const actions=q("#v8Topbar .v8-top-actions");
    if(!actions||actions.dataset.v1060Ready!=="1") return;
    const order=[q("#v8Date"),q("#v8Month"),q("#v8Today"),q("#v8Search"),q("#v8Refresh"),q("#v8Clock")].filter(Boolean);
    actions.replaceChildren(...order);
    delete actions.dataset.v1060Ready;
  }

  function forceExpandedMobileSidebar(){
    if(!isMobile()) return;
    document.body.classList.remove("v8-sidebar-collapsed");
    const sidebar=q("#v8Sidebar");
    sidebar?.classList.remove("collapsed");
  }

  function setupSidebar(){
    const sidebar=q("#v8Sidebar");
    if(!sidebar||sidebar.dataset.v1060Ready==="1") return;
    sidebar.dataset.v1060Ready="1";
    let close=q(".v1060-sidebar-close",sidebar);
    if(!close){
      close=document.createElement("button");
      close.type="button";
      close.className="v1060-sidebar-close";
      close.setAttribute("aria-label","Fechar menu");
      close.innerHTML='<i class="fas fa-xmark"></i>';
      q(".v8-brand",sidebar)?.appendChild(close);
    }
    close.addEventListener("click",()=>document.body.classList.remove("v8-mobile-menu-open"));
    forceExpandedMobileSidebar();
  }

  function labelTable(table){
    const heads=qa("thead th",table).map(x=>(x.textContent||"").trim());
    if(!heads.length) return;
    table.classList.add("v1060-card-table");
    qa("tbody tr",table).forEach(row=>qa(":scope > td",row).forEach((td,i)=>{
      if(td.colSpan>1||td.classList.contains("v8-empty")) return;
      td.dataset.label=heads[i]||"Informação";
    }));
  }

  function enhanceContent(){
    if(!isMobile()) return;
    qa("#v8Content table.v8-table").forEach(labelTable);
    qa("#v8Content button").forEach(btn=>{if(!btn.type) btn.type="button";});
    clearStaleLocks();
  }

  function bindAftercare(){
    if(document.documentElement.dataset.v1060Aftercare==="1") return;
    document.documentElement.dataset.v1060Aftercare="1";
    // Não usa preventDefault/stopPropagation e não captura eventos de toque.
    document.addEventListener("click",ev=>{
      if(!isMobile()) return;
      const nav=ev.target.closest?.("#v8MobileBar [data-tab],#v8Sidebar [data-tab]");
      if(nav&&nav.dataset.tab!=="menu"){
        document.body.classList.remove("v8-mobile-menu-open");
        setTimeout(resetScrollTop,0);
      }
      if(ev.target.closest?.("#v8MobileOverlay")) document.body.classList.remove("v8-mobile-menu-open");
      clearStaleLocks();
    },false);
    window.addEventListener("pageshow",clearStaleLocks,{passive:true});
    document.addEventListener("visibilitychange",()=>{if(!document.hidden) clearStaleLocks();},{passive:true});
  }

  function applyMode(){
    const mobile=isMobile();
    if(mobile){
      document.body.classList.add("v1060-native-mobile");
      document.body.classList.remove("v1059-mobile-scroller");
      setupTopbar();
      setupSidebar();
      forceExpandedMobileSidebar();
      clearStaleLocks();
      enhanceContent();
    }else{
      document.body.classList.remove("v1060-native-mobile","v1060-filters-open","v8-mobile-menu-open");
      restoreDesktopTopbar();
      const collapsed=!!window.VescoV8?.state?.sidebarCollapsed;
      document.body.classList.toggle("v8-sidebar-collapsed",collapsed);
    }
    if(lastMobile!==null&&lastMobile!==mobile&&window.VescoV8?.state){
      window.VescoV8.state.pageByTab={};
      requestAnimationFrame(()=>window.VescoV8.render?.());
    }
    lastMobile=mobile;
  }

  function queueMode(){clearTimeout(resizeTimer);resizeTimer=setTimeout(applyMode,80);}
  function boot(){
    if(!q("#v8Shell")){setTimeout(boot,60);return;}
    bindAftercare();
    applyMode();
  }

  MQ.addEventListener?.("change",queueMode);
  window.addEventListener("resize",queueMode,{passive:true});
  window.addEventListener("orientationchange",queueMode,{passive:true});
  window.visualViewport?.addEventListener("resize",queueMode,{passive:true});

  window.VescoMobileV1060={
    version:"V10.60-MOBILE-SCROLL-NATIVO",
    isMobile,nativeScroller,resetScrollTop,scrollDiagnostics,clearStaleLocks,enhanceContent,applyMode
  };
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",boot,{once:true});
  else boot();
  console.log("VESCO Mobile V10.60 ativo — rolagem nativa, sem bloqueio de toque ou clique.");
})();
