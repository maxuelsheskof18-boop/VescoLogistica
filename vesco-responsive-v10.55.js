// VESCO V10.55 — runtime responsivo universal, sem interceptar a navegação original.
(function(){
  "use strict";
  if(window.VescoResponsiveV1055) return;

  const q=(selector,root=document)=>root.querySelector(selector);
  const qa=(selector,root=document)=>Array.from(root.querySelectorAll(selector));
  const LOCK_CLASSES=[
    "v1025-modal-open","v1027-modal-open","v1034-modal-open",
    "vesco-modal-open","vesco-map-open","v1051-scroll-lock"
  ];
  let contentObserver=null;
  let resizeQueued=false;
  let enhancementQueued=false;
  let shellReady=false;

  function viewport(){
    const vv=window.visualViewport;
    const documentWidth=Math.max(240,document.documentElement.clientWidth||window.innerWidth||1280);
    const width=Math.max(240,Math.round(Math.min(documentWidth,vv?.width||documentWidth)));
    const height=Math.max(280,Math.round(vv?.height||window.innerHeight||720));
    return {width,height,keyboard:height<(window.innerHeight||height)*0.73};
  }

  function tierFor(width){
    if(width<320) return "xxs";
    if(width<480) return "xs";
    if(width<600) return "sm";
    if(width<900) return "md";
    if(width<1200) return "lg";
    return "xl";
  }

  function applyViewport(){
    resizeQueued=false;
    const {width,height,keyboard}=viewport();
    const root=document.documentElement;
    const body=document.body;
    root.style.setProperty("--vesco-vw",`${width}px`);
    root.style.setProperty("--vesco-vh",`${height}px`);
    root.style.setProperty("--vesco-dvh",`${height}px`);
    root.dataset.vescoViewport=tierFor(width);
    body?.classList.toggle("v1055-compact",width<900);
    body?.classList.toggle("v1055-phone",width<600);
    body?.classList.toggle("v1055-ultra-narrow",width<320);
    body?.classList.toggle("v1055-short",height<620);
    body?.classList.toggle("v1055-keyboard-open",keyboard);

    // Ao mudar orientação/largura, volta para a primeira página para não gerar página vazia.
    if(window.VescoV8?.state){
      const previous=Number(window.VescoV8.state.__v1055ViewportWidth||0);
      window.VescoV8.state.__v1055ViewportWidth=width;
      if(previous && Math.abs(previous-width)>120){
        window.VescoV8.state.pageByTab={};
        requestAnimationFrame(()=>window.VescoV8?.scheduleRender?.(true));
      }
    }
    unlockDocument(false);
  }

  function queueViewport(){
    if(resizeQueued) return;
    resizeQueued=true;
    requestAnimationFrame(applyViewport);
  }

  function isVisible(el){
    if(!el) return false;
    const style=getComputedStyle(el);
    if(style.display==="none"||style.visibility==="hidden"||Number(style.opacity)===0) return false;
    const rect=el.getBoundingClientRect();
    return rect.width>2&&rect.height>2;
  }

  function modalOpen(){
    const selectors=[
      "#v92PedidoModal.open", ".v8-modal.open", ".v8-dialog.open", ".v92-modal.open",
      "[role='dialog'][aria-modal='true']"
    ];
    return selectors.some(selector=>qa(selector).some(isVisible));
  }

  function unlockDocument(force=false){
    if(!force&&modalOpen()) return false;
    const html=document.documentElement;
    const body=document.body;
    if(!body) return false;

    LOCK_CLASSES.forEach(className=>{
      html.classList.remove(className);
      body.classList.remove(className);
    });

    // Limpa somente travas de scroll deixadas por modais/versões antigas.
    [html,body].forEach(node=>{
      node.style.removeProperty("top");
      node.style.removeProperty("left");
      node.style.removeProperty("right");
      node.style.removeProperty("bottom");
      node.style.removeProperty("width");
      node.style.removeProperty("height");
      node.style.removeProperty("max-height");
      node.style.removeProperty("position");
      node.style.removeProperty("overflow");
      node.style.removeProperty("overflow-y");
      node.style.removeProperty("touch-action");
    });
    [q("#v8Shell"),q("#v8Main"),q("#v8Content")].filter(Boolean).forEach(node=>{
      node.style.removeProperty("height");
      node.style.removeProperty("max-height");
      node.style.removeProperty("overflow-y");
      node.style.removeProperty("touch-action");
    });
    return true;
  }

  function prepareTopbar(){
    const actions=q("#v8Topbar .v8-top-actions");
    if(!actions||actions.dataset.v1055Prepared==="1") return;
    actions.dataset.v1055Prepared="1";

    const search=q("#v8Search",actions);
    const refresh=q("#v8Refresh",actions);
    const date=q("#v8Date",actions);
    const month=q("#v8Month",actions);
    const today=q("#v8Today",actions);
    const clock=q("#v8Clock",actions);

    const primary=document.createElement("div");
    primary.className="v1055-top-primary";
    const secondary=document.createElement("div");
    secondary.className="v1055-top-secondary";
    secondary.id="v1055TopSecondary";
    const toggle=document.createElement("button");
    toggle.type="button";
    toggle.id="v1055FilterToggle";
    toggle.className="v8-btn secondary v1055-filter-toggle";
    toggle.setAttribute("aria-controls",secondary.id);
    toggle.setAttribute("aria-expanded","false");
    toggle.innerHTML='<i class="fas fa-sliders"></i><span>Filtros</span>';

    if(search){
      search.placeholder="Buscar pedido, cliente ou endereço";
      search.autocomplete="off";
      search.setAttribute("enterkeyhint","search");
      search.setAttribute("aria-label","Buscar pedido, cliente ou endereço");
      primary.appendChild(search);
    }
    if(refresh){
      refresh.innerHTML='<i class="fas fa-rotate"></i><span>Atualizar</span>';
      refresh.setAttribute("aria-label","Atualizar dados");
      primary.appendChild(refresh);
    }
    primary.appendChild(toggle);
    [date,month,today,clock].filter(Boolean).forEach(el=>secondary.appendChild(el));
    actions.replaceChildren(primary,secondary);

    toggle.addEventListener("click",()=>{
      const open=!document.body.classList.contains("v1055-filters-open");
      document.body.classList.toggle("v1055-filters-open",open);
      toggle.setAttribute("aria-expanded",open?"true":"false");
    });
  }

  function prepareSidebar(){
    const sidebar=q("#v8Sidebar");
    if(!sidebar||sidebar.dataset.v1055Prepared==="1") return;
    sidebar.dataset.v1055Prepared="1";
    sidebar.setAttribute("aria-label","Menu principal");
    const brand=q(".v8-brand",sidebar);
    if(brand&&!q(".v1055-sidebar-close",brand)){
      const close=document.createElement("button");
      close.type="button";
      close.className="v1055-sidebar-close";
      close.setAttribute("aria-label","Fechar menu");
      close.innerHTML='<i class="fas fa-xmark"></i>';
      close.addEventListener("click",()=>document.body.classList.remove("v8-mobile-menu-open"));
      brand.appendChild(close);
    }
  }

  function labelTable(table){
    const headers=qa("thead th",table).map(th=>(th.textContent||"").trim());
    if(!headers.length) return;
    table.classList.add("v1055-responsive-table");
    qa("tbody tr",table).forEach(row=>{
      qa(":scope > td",row).forEach((cell,index)=>{
        if(cell.colSpan>1||cell.classList.contains("v8-empty")) return;
        cell.dataset.label=headers[index]||"Informação";
      });
    });
  }

  function enhanceContent(){
    enhancementQueued=false;
    const content=q("#v8Content");
    if(!content) return;
    qa("table.v8-table",content).forEach(labelTable);
    qa("button",content).forEach(button=>{ if(!button.type) button.type="button"; });
    qa("input,select,textarea",content).forEach(field=>{
      if(!field.getAttribute("aria-label")){
        const label=field.closest("label")?.textContent?.trim()||field.placeholder||field.title;
        if(label) field.setAttribute("aria-label",label);
      }
    });
    qa(".v8-map",content).forEach(map=>{
      map.setAttribute("role","region");
      map.setAttribute("aria-label","Mapa de pedidos");
    });
    unlockDocument(false);
  }

  function queueEnhancement(){
    if(enhancementQueued) return;
    enhancementQueued=true;
    requestAnimationFrame(()=>requestAnimationFrame(enhanceContent));
  }

  function observeContent(){
    const content=q("#v8Content");
    if(!content||contentObserver) return;
    contentObserver=new MutationObserver(queueEnhancement);
    contentObserver.observe(content,{childList:true});
  }

  function prepareShell(){
    if(shellReady) return true;
    if(!q("#v8Shell")) return false;
    shellReady=true;
    document.documentElement.classList.add("vesco-v1055-capable");
    document.body.classList.add("v1055-ready");
    prepareTopbar();
    prepareSidebar();
    observeContent();
    queueViewport();
    queueEnhancement();
    unlockDocument(true);

    // Não intercepta a navegação. Apenas fecha o drawer após o clique original.
    document.addEventListener("click",event=>{
      if(event.target.closest?.("#v8Sidebar [data-tab]")){
        document.body.classList.remove("v8-mobile-menu-open");
      }
      setTimeout(()=>unlockDocument(false),0);
    },{passive:true});
    return true;
  }

  function boot(){
    if(prepareShell()) return;
    let attempts=0;
    const timer=setInterval(()=>{
      attempts+=1;
      if(prepareShell()||attempts>200) clearInterval(timer);
    },40);
  }

  window.addEventListener("resize",queueViewport,{passive:true});
  window.addEventListener("orientationchange",()=>setTimeout(queueViewport,80),{passive:true});
  window.addEventListener("pageshow",()=>{queueViewport();unlockDocument(true);},{passive:true});
  window.visualViewport?.addEventListener("resize",queueViewport,{passive:true});
  document.addEventListener("visibilitychange",()=>{if(!document.hidden){queueViewport();unlockDocument(false);}});
  document.addEventListener("keydown",event=>{
    if(event.key!=="Escape") return;
    document.body.classList.remove("v8-mobile-menu-open","v1055-filters-open");
    q("#v1055FilterToggle")?.setAttribute("aria-expanded","false");
    unlockDocument(false);
  });

  window.VescoResponsiveV1055={
    version:"V10.55-RESPONSIVO-UNIVERSAL",
    viewport,applyViewport,enhanceContent,unlockDocument,
    diagnostics(){
      const scrolling=document.scrollingElement||document.documentElement;
      const shell=q("#v8Shell")?.getBoundingClientRect();
      const main=q("#v8Main")?.getBoundingClientRect();
      const content=q("#v8Content")?.getBoundingClientRect();
      return {
        version:this.version,
        viewport:viewport(),
        tier:document.documentElement.dataset.vescoViewport,
        modalOpen:modalOpen(),
        scrollTop:scrolling?.scrollTop||0,
        scrollHeight:scrolling?.scrollHeight||0,
        clientHeight:scrolling?.clientHeight||0,
        bodyOverflowY:getComputedStyle(document.body).overflowY,
        htmlOverflowY:getComputedStyle(document.documentElement).overflowY,
        shellWidth:shell?.width||0,
        mainWidth:main?.width||0,
        contentWidth:content?.width||0,
        horizontalOverflow:Math.max(0,(scrolling?.scrollWidth||0)-(scrolling?.clientWidth||0)),
        locks:LOCK_CLASSES.filter(name=>document.body.classList.contains(name)||document.documentElement.classList.contains(name))
      };
    }
  };

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",boot,{once:true});
  else boot();
  console.log("VESCO Responsive V10.55 ativo — qualquer largura, scroll nativo e navegação original preservada.");
})();
