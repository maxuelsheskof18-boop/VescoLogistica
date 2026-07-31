// vesco-mobile-v10.36.js — responsividade universal: desktop, tablet, Android e iOS.
(function(){
  'use strict';
  if(window.VescoMobileV1036) return;

  const VERSION='V10.36';
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
    annotateTables();
    syncLayers();

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
    document.addEventListener('click',onClick,true);
    document.addEventListener('focusin',onFocus,true);
    setInterval(syncLayers,500);
  }

  window.VescoMobileV1036={
    version:VERSION,start,refresh:schedule,invalidateMaps,
    debug:()=>({
      version:VERSION,
      phone:isPhone(),tablet:isTablet(),desktop:!isPhone()&&!isTablet(),
      touch:isTouch(),ios:isIOS(),android:isAndroid(),
      width:width(),height:window.visualViewport?.height||window.innerHeight,
      filtersOpen:document.body?.classList.contains('vesco-filters-open')||false,
      keyboardOpen:document.body?.classList.contains('vesco-keyboard-open')||false,
      mapOpen:document.body?.classList.contains('vesco-map-open')||false,
      tables:document.querySelectorAll('.vesco-responsive-table').length
    })
  };
  // Compatibilidade com chamadas do núcleo V10.35.
  window.VescoMobileV1035=window.VescoMobileV1036;
  window.VescoMobileV1034=window.VescoMobileV1036;

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
