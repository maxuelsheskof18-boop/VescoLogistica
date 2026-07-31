// vesco-mobile-v10.38.js — responsividade universal: desktop, tablet, Android e iOS.
(function(){
  'use strict';
  if(window.VescoMobileV1038) return;

  const VERSION='V10.38';
  const PHONE_MAX=767;
  const TABLET_MAX=1180;
  let mutationObserver=null;
  let resizeObserver=null;
  let rafId=0;
  let lastViewport='';
  let started=false;

  const $=(s,root=document)=>root.querySelector(s);
  const $$=(s,root=document)=>Array.from(root.querySelectorAll(s));
  const clean=v=>String(v==null?'':v).replace(/\s+/g,' ').trim();
  const width=()=>Math.max(280,Math.round(window.visualViewport?.width||window.innerWidth||document.documentElement.clientWidth||390));
  const isPhone=()=>width()<=PHONE_MAX;
  const isTablet=()=>width()>PHONE_MAX && width()<=TABLET_MAX;
  const isTouch=()=>!!window.matchMedia?.('(pointer:coarse)').matches || Number(navigator.maxTouchPoints||0)>0;
  const isIOS=()=>/iPhone|iPad|iPod/i.test(navigator.userAgent||'') || (navigator.platform==='MacIntel' && Number(navigator.maxTouchPoints||0)>1);
  const isAndroid=()=>/Android/i.test(navigator.userAgent||'');

  function setViewportVars(){
    const vv=window.visualViewport;
    const w=Math.max(280,Math.round(vv?.width||window.innerWidth||390));
    const h=Math.max(320,Math.round(vv?.height||window.innerHeight||720));
    const top=Math.max(0,Math.round(vv?.offsetTop||0));
    const left=Math.max(0,Math.round(vv?.offsetLeft||0));
    const keyboard=!!vv && isPhone() && Math.max(0,(window.innerHeight||h)-vv.height)>140;
    const root=document.documentElement;
    root.style.setProperty('--vesco-vvw',w+'px');
    root.style.setProperty('--vesco-vvh',h+'px');
    root.style.setProperty('--vesco-vvtop',top+'px');
    root.style.setProperty('--vesco-vvleft',left+'px');
    document.body?.classList.toggle('vesco-keyboard-open',keyboard);
    return {w,h,top,left,keyboard};
  }

  function ensureFilterButton(){
    const title=$('#v8Topbar .v8-title');
    if(!title) return;
    let btn=$('#vescoResponsiveFilters');
    if(!btn){
      btn=document.createElement('button');
      btn.id='vescoResponsiveFilters';
      btn.type='button';
      btn.className='v8-btn secondary vesco-responsive-filter-btn';
      btn.innerHTML='<i class="fas fa-sliders"></i><span>Filtros</span>';
      btn.addEventListener('click',()=>{
        const open=!document.body.classList.contains('vesco-filters-open');
        document.body.classList.toggle('vesco-filters-open',open);
        btn.setAttribute('aria-expanded',open?'true':'false');
        invalidateMaps();
      });
      title.appendChild(btn);
    }
    btn.setAttribute('aria-expanded',document.body.classList.contains('vesco-filters-open')?'true':'false');
  }

  function annotateTable(table){
    if(!table) return;
    const headers=$$('thead th',table).map(th=>clean(th.textContent));
    table.classList.add('vesco-responsive-table');
    $$('tbody tr',table).forEach(row=>{
      const cells=Array.from(row.children).filter(el=>el.tagName==='TD');
      cells.forEach((cell,index)=>{
        const empty=Number(cell.getAttribute('colspan')||1)>1 || cell.classList.contains('v8-empty');
        cell.dataset.label=empty?'':(headers[index]||`Campo ${index+1}`);
        cell.classList.toggle('vesco-empty-cell',empty);
      });
    });
  }

  function annotateTables(){
    $$('table.v8-table,.v91-separacao-table,.v92-separacao-table').forEach(annotateTable);
  }

  function normalizePendingForm(){
    const modal=$('#v92PedidoModal.open');
    if(!modal || !isPhone()) return;
    modal.classList.add('v1038-pending-open');
    $$('.v1038-control,#v92PedidoModal input.v8-input,#v92PedidoModal select.v8-input,#v92PedidoModal textarea.v8-input',modal).forEach(control=>{
      control.hidden=false;
      control.removeAttribute('hidden');
      control.setAttribute('aria-hidden','false');
      control.style.setProperty('display','block','important');
      control.style.setProperty('visibility','visible','important');
      control.style.setProperty('opacity','1','important');
      control.style.setProperty('width','100%','important');
      control.style.setProperty('max-width','100%','important');
      control.style.setProperty('min-width','0','important');
      control.style.setProperty('color','#0f172a','important');
      control.style.setProperty('-webkit-text-fill-color','#0f172a','important');
      control.style.setProperty('background-color','#f8fbff','important');
      control.style.setProperty('border','2px solid #b8c7da','important');
    });
  }

  function syncLayers(){
    const modal=!!$('#v92PedidoModal.open,#v95ShareModal.open,#v1027RouteEditModal.open,[role="dialog"][open]');
    const map=!!$('.v1034-map-fullscreen,.v1033-map-fullscreen');
    document.body.classList.toggle('vesco-modal-open',modal);
    document.documentElement.classList.toggle('vesco-modal-open',modal);
    document.body.classList.toggle('vesco-map-open',map);
    document.documentElement.classList.toggle('vesco-map-open',map);
  }

  function invalidateMaps(){
    [0,120,350].forEach(delay=>setTimeout(()=>{
      try{
        Object.values(window.VescoV8?.state?.maps||{}).forEach(map=>map?.invalidateSize?.({pan:false,animate:false}));
      }catch(_e){}
    },delay));
  }

  function applyClasses(){
    rafId=0;
    const body=document.body;
    if(!body) return;
    const phone=isPhone();
    const tablet=isTablet();
    const desktop=!phone&&!tablet;

    // Remove classes de camadas anteriores que ativavam regras conflitantes.
    document.documentElement.classList.remove('v1033-mobile','v1034-mobile');
    body.classList.remove('v1033-mobile','v1034-mobile');

    for(const el of [document.documentElement,body]){
      el.classList.toggle('vesco-phone',phone);
      el.classList.toggle('vesco-tablet',tablet);
      el.classList.toggle('vesco-desktop',desktop);
      el.classList.toggle('vesco-touch',isTouch());
      el.classList.toggle('vesco-ios',isIOS());
      el.classList.toggle('vesco-android',isAndroid());
    }

    if(!phone){
      body.classList.remove('vesco-filters-open','v8-mobile-menu-open','vesco-keyboard-open');
    }
    if(desktop){
      body.classList.remove('vesco-modal-open','vesco-map-open');
    }

    const vp=setViewportVars();
    ensureFilterButton();
    normalizeButtons();
    annotateTables();
    syncLayers();
    normalizePendingForm();

    const key=[phone,tablet,vp.w,vp.h,vp.keyboard].join('|');
    if(key!==lastViewport){
      lastViewport=key;
      invalidateMaps();
    }
  }

  function schedule(){
    if(rafId) return;
    rafId=requestAnimationFrame(applyClasses);
  }

  function watchContent(){
    mutationObserver?.disconnect();
    mutationObserver=new MutationObserver(schedule);
    mutationObserver.observe(document.body,{childList:true,subtree:true});

    resizeObserver?.disconnect();
    if(window.ResizeObserver){
      resizeObserver=new ResizeObserver(()=>invalidateMaps());
      const content=$('#v8Content');
      if(content) resizeObserver.observe(content);
    }
  }

  function onClick(event){
    const nav=event.target.closest?.('#v8Sidebar [data-tab],#v8MobileBar [data-tab]');
    if(nav && isPhone()) document.body.classList.remove('v8-mobile-menu-open');
  }

  function onFocus(event){
    if(!isPhone() || !event.target?.matches?.('input,select,textarea')) return;
    setTimeout(()=>{
      try{event.target.scrollIntoView({block:'center',inline:'nearest',behavior:'smooth'});}catch(_e){}
    },isIOS()?320:180);
  }


  const tapState={target:null,x:0,y:0,pointerId:null,syntheticAt:0,syntheticTarget:null,syntheticX:0,syntheticY:0};

  function actionableTarget(node){
    const el=node?.closest?.('button,a.v8-btn,[role="button"]');
    if(!el || el.disabled || el.getAttribute('aria-disabled')==='true') return null;
    if(el.matches('input,select,textarea,label')) return null;
    // Navegação, menu e filtros já têm listeners nativos estáveis. O fallback é
    // reservado aos botões de ação dentro do conteúdo, onde o rerender pode
    // cancelar o click em Android/iOS.
    if(el.closest('#v8MobileBar,#v8Sidebar,#v8Topbar')) return null;
    return el;
  }

  function normalizeButtons(){
    $$('button:not([type])').forEach(btn=>{ try{btn.type='button';}catch(_e){} });
    $$('button,.v8-btn,[role="button"]').forEach(btn=>{
      btn.classList.add('vesco-tap-ready');
      if(!btn.hasAttribute('tabindex') && btn.tagName!=='BUTTON' && btn.tagName!=='A') btn.tabIndex=0;
    });
  }

  function onPointerDown(event){
    if(!isTouch() || event.pointerType==='mouse') return;
    const target=actionableTarget(event.target);
    if(!target) return;
    tapState.target=target;
    tapState.x=event.clientX;
    tapState.y=event.clientY;
    tapState.pointerId=event.pointerId;
  }

  function onPointerCancel(){
    tapState.target=null;
    tapState.pointerId=null;
  }

  function onPointerUp(event){
    if(!isTouch() || event.pointerType==='mouse') return;
    const target=actionableTarget(event.target);
    const same=target && target===tapState.target && (tapState.pointerId==null || tapState.pointerId===event.pointerId);
    const moved=Math.hypot(event.clientX-tapState.x,event.clientY-tapState.y);
    onPointerCancel();
    if(!same || moved>12) return;

    // Safari/Chrome mobile podem perder o click em cartões, áreas roláveis e após
    // rerender do Firebase. Executamos um único click controlado no pointerup.
    event.preventDefault();
    tapState.syntheticAt=Date.now();
    tapState.syntheticTarget=target;
    tapState.syntheticX=event.clientX;
    tapState.syntheticY=event.clientY;
    target.click();
  }

  function suppressDuplicateNativeClick(event){
    if(!event.isTrusted || !tapState.syntheticTarget) return;
    const elapsed=Date.now()-tapState.syntheticAt;
    const distance=Math.hypot((event.clientX||0)-tapState.syntheticX,(event.clientY||0)-tapState.syntheticY);
    // O primeiro click confiável após o click sintético é o ghost-click do
    // navegador. O DOM pode ter sido rerenderizado, então o alvo pode ser outro.
    if(elapsed>700 || distance>48) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    tapState.syntheticTarget=null;
  }

  function onKeyActivate(event){
    if(event.key!=='Enter' && event.key!==' ') return;
    const target=actionableTarget(event.target);
    if(!target || target.tagName==='BUTTON' || target.tagName==='A') return;
    event.preventDefault();
    target.click();
  }

  function start(){
    if(started) return;
    started=true;
    applyClasses();
    watchContent();
    window.addEventListener('resize',schedule,{passive:true});
    window.addEventListener('orientationchange',()=>{schedule();setTimeout(invalidateMaps,250);setTimeout(invalidateMaps,650);},{passive:true});
    window.addEventListener('pageshow',schedule,{passive:true});
    window.visualViewport?.addEventListener('resize',schedule,{passive:true});
    window.visualViewport?.addEventListener('scroll',schedule,{passive:true});
    document.addEventListener('pointerdown',onPointerDown,{capture:true,passive:true});
    document.addEventListener('pointerup',onPointerUp,{capture:true,passive:false});
    document.addEventListener('pointercancel',onPointerCancel,{capture:true,passive:true});
    document.addEventListener('click',suppressDuplicateNativeClick,true);
    document.addEventListener('click',onClick,true);
    document.addEventListener('keydown',onKeyActivate,true);
    document.addEventListener('focusin',onFocus,true);
    setInterval(syncLayers,500);
  }

  window.VescoMobileV1038={
    version:VERSION,start,refresh:schedule,invalidateMaps,
    debug:()=>({
      version:VERSION,
      phone:isPhone(),tablet:isTablet(),desktop:!isPhone()&&!isTablet(),
      touch:isTouch(),ios:isIOS(),android:isAndroid(),
      width:width(),height:window.visualViewport?.height||window.innerHeight,
      filtersOpen:document.body?.classList.contains('vesco-filters-open')||false,
      keyboardOpen:document.body?.classList.contains('vesco-keyboard-open')||false,
      mapOpen:document.body?.classList.contains('vesco-map-open')||false,
      pendingFormFixed:true,pendingControls:document.querySelectorAll('#v92PedidoModal .v1038-control').length,tables:document.querySelectorAll('.vesco-responsive-table').length,buttons:document.querySelectorAll('.vesco-tap-ready').length,tapFallback:true
    })
  };
  // Compatibilidade com chamadas do núcleo V10.35.
  window.VescoMobileV1037=window.VescoMobileV1038;
  window.VescoMobileV1035=window.VescoMobileV1038;
  window.VescoMobileV1034=window.VescoMobileV1038;

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
