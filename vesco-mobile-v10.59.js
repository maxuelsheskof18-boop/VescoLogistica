// VESCO V10.59 — mobile com scroller único e paginação realmente responsiva.
// Nenhuma regra desta camada modifica o desktop acima de 899px.
(function(){
  "use strict";
  if(window.VescoMobileV1059) return;

  const MQ=window.matchMedia("(max-width: 899px)");
  const q=(s,r=document)=>r.querySelector(s);
  const qa=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const isMobile=()=>MQ.matches;
  const safeGet=(store,key)=>{try{return store.getItem(key)}catch(_e){return null}};
  const safeSet=(store,key,value)=>{try{store.setItem(key,value)}catch(_e){}};

  let shellReady=false;
  let enhanceTimer=null;
  let resizeTimer=null;
  let lastMobile=null;

  function mobileScroller(){
    return q("#v8Main") || document.scrollingElement || document.documentElement;
  }

  function hasVisibleModal(){
    return qa("#v92PedidoModal.open,.v8-modal.open,.v8-dialog.open,.v92-modal.open,[role=dialog][aria-modal=true]")
      .some(el=>{
        const st=getComputedStyle(el),r=el.getBoundingClientRect();
        return st.display!=="none"&&st.visibility!=="hidden"&&r.width>1&&r.height>1;
      });
  }

  function clearInteractionLocks(){
    if(!isMobile()) return;
    document.body.classList.remove("v1051-nav-busy","v1056-touch-active","v1051-scroll-lock");
    document.documentElement.classList.remove("v1051-scroll-lock");
    const content=q("#v8Content");
    if(content) content.setAttribute("aria-busy","false");
  }

  function resetScrollTop(){
    if(!isMobile()) return false;
    const scroller=mobileScroller();
    try{scroller.scrollTop=0;}catch(_e){}
    return true;
  }

  function scrollDiagnostics(){
    const scroller=mobileScroller();
    return {
      version:"V10.59-MOBILE-SCROLLER-UNICO",
      mobile:isMobile(),
      scroller:scroller?.id||scroller?.tagName||"document",
      scrollTop:Number(scroller?.scrollTop||0),
      scrollHeight:Number(scroller?.scrollHeight||0),
      clientHeight:Number(scroller?.clientHeight||0),
      canScroll:Number(scroller?.scrollHeight||0)>Number(scroller?.clientHeight||0)+2,
      overflowY:scroller?getComputedStyle(scroller).overflowY:null,
      modalOpen:hasVisibleModal(),
      viewportWidth:Math.round(window.visualViewport?.width||window.innerWidth||0),
      effectivePageSize:window.VescoV8?.debug?.().effectivePageSize||null
    };
  }

  function applyViewport(){
    const vv=window.visualViewport;
    const h=Math.max(320,Math.round(vv?.height||window.innerHeight||720));
    const w=Math.max(240,Math.round(vv?.width||window.innerWidth||390));
    document.documentElement.style.setProperty("--vesco-mobile-vh",`${h}px`);
    document.documentElement.style.setProperty("--vesco-mobile-vw",`${w}px`);
    const keyboard=isMobile()&&vv&&vv.height<window.innerHeight*.76;
    document.body.classList.toggle("v1059-keyboard-open",!!keyboard);
    document.body.classList.toggle("v1059-mobile-scroller",isMobile());
  }

  function setupTopbar(){
    if(!isMobile()) return;
    const actions=q("#v8Topbar .v8-top-actions");
    if(!actions||actions.dataset.v1059Ready==="1") return;
    actions.dataset.v1059Ready="1";

    const search=q("#v8Search",actions),refresh=q("#v8Refresh",actions);
    const date=q("#v8Date",actions),month=q("#v8Month",actions),today=q("#v8Today",actions),clock=q("#v8Clock",actions);
    const quick=document.createElement("div");
    quick.className="v1059-mobile-quick";
    const panel=document.createElement("div");
    panel.className="v1059-filter-panel";
    panel.id="v1059FilterPanel";
    const toggle=document.createElement("button");
    toggle.type="button";
    toggle.id="v1059FiltersToggle";
    toggle.className="v8-btn secondary v1059-filter-toggle";
    toggle.setAttribute("aria-controls","v1059FilterPanel");
    toggle.innerHTML='<i class="fas fa-sliders"></i><span>Filtros</span>';

    if(search){
      search.placeholder="Buscar pedido, cliente ou endereço";
      search.setAttribute("inputmode","search");
      search.setAttribute("enterkeyhint","search");
      quick.appendChild(search);
    }
    if(refresh){
      refresh.innerHTML='<i class="fas fa-rotate"></i><span>Atualizar</span>';
      quick.appendChild(refresh);
    }
    quick.appendChild(toggle);
    [date,month,today,clock].filter(Boolean).forEach(el=>panel.appendChild(el));
    actions.replaceChildren(quick,panel);

    const open=safeGet(sessionStorage,"vesco:v1059:filtersOpen")==="1";
    document.body.classList.toggle("v1059-filters-open",open);
    toggle.setAttribute("aria-expanded",open?"true":"false");
    toggle.addEventListener("click",()=>{
      const next=!document.body.classList.contains("v1059-filters-open");
      document.body.classList.toggle("v1059-filters-open",next);
      toggle.setAttribute("aria-expanded",next?"true":"false");
      safeSet(sessionStorage,"vesco:v1059:filtersOpen",next?"1":"0");
    });
  }

  function restoreDesktopTopbar(){
    const actions=q("#v8Topbar .v8-top-actions");
    if(!actions||actions.dataset.v1059Ready!=="1") return;
    const order=[q("#v8Date"),q("#v8Month"),q("#v8Today"),q("#v8Search"),q("#v8Refresh"),q("#v8Clock")].filter(Boolean);
    actions.replaceChildren(...order);
    delete actions.dataset.v1059Ready;
  }

  function forceExpandedMobileSidebar(){
    if(!isMobile()) return;
    // O estado recolhido pertence somente ao desktop. No celular a gaveta
    // precisa sempre abrir completa, com textos e botões em largura total.
    document.body.classList.remove("v8-sidebar-collapsed");
    const sidebar=q("#v8Sidebar");
    if(sidebar){
      sidebar.classList.remove("collapsed");
      sidebar.setAttribute("aria-hidden",document.body.classList.contains("v8-mobile-menu-open")?"false":"true");
    }
  }

  function restoreDesktopSidebarState(){
    if(isMobile()) return;
    const collapsed=!!window.VescoV8?.state?.sidebarCollapsed;
    document.body.classList.toggle("v8-sidebar-collapsed",collapsed);
  }

  function setupSidebar(){
    const sidebar=q("#v8Sidebar");
    if(!sidebar||sidebar.dataset.v1059Ready==="1") return;
    sidebar.dataset.v1059Ready="1";
    let close=q(".v1059-sidebar-close",sidebar);
    if(!close){
      close=document.createElement("button");
      close.type="button";
      close.className="v1059-sidebar-close";
      close.setAttribute("aria-label","Fechar menu");
      close.innerHTML='<i class="fas fa-xmark"></i>';
      q(".v8-brand",sidebar)?.appendChild(close);
    }
    close.addEventListener("click",()=>{
      document.body.classList.remove("v8-mobile-menu-open");
      sidebar.setAttribute("aria-hidden","true");
    });
    forceExpandedMobileSidebar();
  }

  function labelTable(table){
    const heads=qa("thead th",table).map(x=>(x.textContent||"").trim());
    if(!heads.length) return;
    table.classList.add("v1059-card-table");
    qa("tbody tr",table).forEach(row=>qa(":scope > td",row).forEach((td,i)=>{
      if(td.colSpan>1||td.classList.contains("v8-empty")) return;
      td.dataset.label=heads[i]||"Informação";
    }));
  }

  function enhanceContent(){
    enhanceTimer=null;
    if(!isMobile()) return;
    const root=q("#v8Content");
    if(!root) return;
    qa("table.v8-table",root).forEach(labelTable);
    qa("button",root).forEach(btn=>{if(!btn.type) btn.type="button";});
    clearInteractionLocks();
  }

  function queueEnhance(){
    clearTimeout(enhanceTimer);
    enhanceTimer=setTimeout(()=>requestAnimationFrame(enhanceContent),30);
  }

  function setupObserver(){
    const content=q("#v8Content");
    if(!content||content.dataset.v1059Observed==="1") return;
    content.dataset.v1059Observed="1";
    new MutationObserver(mutations=>{
      if(mutations.some(m=>m.addedNodes?.length)) queueEnhance();
    }).observe(content,{childList:true});
  }

  function bindNavigationAftercare(){
    if(document.documentElement.dataset.v1059NavAftercare==="1") return;
    document.documentElement.dataset.v1059NavAftercare="1";

    // O módulo principal continua sendo o único responsável pela navegação.
    // Esta camada apenas reposiciona o scroller depois que o módulo conclui.
    document.addEventListener("click",ev=>{
      if(!isMobile()) return;
      const nav=ev.target.closest?.("#v8MobileBar [data-tab],#v8Sidebar [data-tab]");
      if(!nav) return;
      if(nav.dataset.tab==="menu"){
        forceExpandedMobileSidebar();
        q("#v8Sidebar")?.setAttribute("aria-hidden","false");
      }else{
        document.body.classList.remove("v8-mobile-menu-open");
        q("#v8Sidebar")?.setAttribute("aria-hidden","true");
      }
      requestAnimationFrame(resetScrollTop);
      setTimeout(resetScrollTop,100);
    });

    document.addEventListener("pointerup",ev=>{
      if(!isMobile()) return;
      if(ev.target.closest?.(".v1057-page-btn[data-vpage]")){
        setTimeout(()=>{
          const scroller=mobileScroller();
          const pager=q("#v8Content .v1057-pager");
          if(!scroller||!pager) return;
          const topbar=q("#v8Topbar");
          const top=pager.getBoundingClientRect().top-scroller.getBoundingClientRect().top+scroller.scrollTop-(topbar?.offsetHeight||0)-8;
          try{scroller.scrollTo({top:Math.max(0,top),behavior:"auto"});}catch(_e){scroller.scrollTop=Math.max(0,top);}
        },40);
      }
    },{passive:true});
  }

  function applyMode(){
    const mobile=isMobile();
    applyViewport();
    if(mobile){
      document.body.classList.add("v1059-mobile-scroller");
      setupTopbar();
      setupSidebar();
      forceExpandedMobileSidebar();
      queueEnhance();
      clearInteractionLocks();
    }else{
      document.body.classList.remove("v1059-mobile-scroller","v1059-filters-open","v1059-keyboard-open","v8-mobile-menu-open");
      restoreDesktopTopbar();
      restoreDesktopSidebarState();
    }
    if(lastMobile!==null&&lastMobile!==mobile&&window.VescoV8?.state){
      window.VescoV8.state.pageByTab={};
      requestAnimationFrame(()=>window.VescoV8.render?.());
    }
    lastMobile=mobile;
  }

  function queueMode(){
    clearTimeout(resizeTimer);
    resizeTimer=setTimeout(applyMode,60);
  }

  function setupShell(){
    if(shellReady) return true;
    if(!q("#v8Shell")) return false;
    shellReady=true;
    setupObserver();
    bindNavigationAftercare();
    applyMode();
    return true;
  }

  function boot(){
    if(setupShell()) return;
    let attempts=0;
    const timer=setInterval(()=>{
      attempts++;
      if(setupShell()||attempts>160) clearInterval(timer);
    },50);
  }

  MQ.addEventListener?.("change",queueMode);
  window.addEventListener("resize",queueMode,{passive:true});
  window.addEventListener("orientationchange",queueMode,{passive:true});
  window.visualViewport?.addEventListener("resize",queueMode,{passive:true});
  window.addEventListener("pageshow",()=>{applyMode();clearInteractionLocks();},{passive:true});

  window.VescoMobileV1059={
    version:"V10.59-MOBILE-SCROLLER-UNICO",
    isMobile,mobileScroller,resetScrollTop,scrollDiagnostics,applyMode,enhanceContent,forceExpandedMobileSidebar
  };
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",boot,{once:true});
  else boot();
  console.log("VESCO Mobile V10.59 ativo — scroller único, paginação real e desktop intacto.");
})();
