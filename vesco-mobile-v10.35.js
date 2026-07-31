// vesco-mobile-v10.35.js — camada móvel universal Android/iOS com mapa estável.
(function(){
  'use strict';
  if(window.VescoMobileV1035) return;

  const VERSION='V10.35';
  const BREAKPOINT=1024;
  let observer=null;
  let raf=0;
  let lastViewportKey='';
  let started=false;

  function ua(){ return String(navigator.userAgent||''); }
  function isIOS(){
    return /iPad|iPhone|iPod/i.test(ua()) ||
      (navigator.platform==='MacIntel' && Number(navigator.maxTouchPoints||0)>1);
  }
  function isAndroid(){ return /Android/i.test(ua()); }
  function coarse(){ return !!window.matchMedia?.('(pointer: coarse)').matches; }
  function isMobile(){
    const width=Math.min(
      Number(window.innerWidth||9999),
      Number(window.visualViewport?.width||9999),
      Number(window.screen?.width||9999)
    );
    return width<=BREAKPOINT || (coarse() && width<=1366);
  }
  function clean(value){ return String(value==null?'':value).replace(/\s+/g,' ').trim(); }

  function setViewportVars(){
    const vv=window.visualViewport;
    const height=Math.max(320,Math.round(vv?.height||window.innerHeight||720));
    const width=Math.max(280,Math.round(vv?.width||window.innerWidth||390));
    const top=Math.max(0,Math.round(vv?.offsetTop||0));
    const left=Math.max(0,Math.round(vv?.offsetLeft||0));
    const keyboard=isMobile() && !!vv && Math.max(0,window.innerHeight-vv.height)>150;

    document.documentElement.style.setProperty('--vesco-vvh',height+'px');
    document.documentElement.style.setProperty('--vesco-vvw',width+'px');
    document.documentElement.style.setProperty('--vesco-vvtop',top+'px');
    document.documentElement.style.setProperty('--vesco-vvleft',left+'px');
    document.body?.classList.toggle('v1034-keyboard-open',keyboard);
    return {height,width,top,left,keyboard};
  }

  function ensureFilterButton(){
    const title=document.querySelector('#v8Topbar .v8-title');
    if(!title || document.getElementById('v1034MobileFilters')) return;
    const btn=document.createElement('button');
    btn.id='v1034MobileFilters';
    btn.type='button';
    btn.className='v8-btn secondary v1034-filter-toggle';
    btn.setAttribute('aria-expanded','false');
    btn.innerHTML='<i class="fas fa-sliders"></i><span>Filtros</span>';
    btn.addEventListener('click',()=>{
      const open=!document.body.classList.contains('v1034-filters-open');
      document.body.classList.toggle('v1034-filters-open',open);
      btn.setAttribute('aria-expanded',open?'true':'false');
      invalidateMaps();
    });
    title.appendChild(btn);
  }

  function annotateTable(table){
    if(!table || table.dataset.v1034Ready==='1') return;
    const headers=Array.from(table.querySelectorAll('thead th')).map(th=>clean(th.textContent));
    table.classList.add('v1034-mobile-table');
    table.dataset.v1034Ready='1';

    Array.from(table.querySelectorAll('tbody tr')).forEach(row=>{
      row.classList.add('v1034-mobile-row');
      const cells=Array.from(row.children).filter(el=>el.tagName==='TD');
      cells.forEach((cell,index)=>{
        const empty=Number(cell.getAttribute('colspan')||1)>1 || cell.classList.contains('v8-empty');
        cell.dataset.label=empty?'':(headers[index]||`Campo ${index+1}`);
        cell.classList.toggle('v1034-empty-cell',empty);
      });
    });
  }

  function annotateTables(){
    document.querySelectorAll('table.v8-table,.v91-separacao-table,.v92-separacao-table').forEach(annotateTable);
  }

  function syncOpenLayers(){
    const modalOpen=!!document.querySelector(
      '#v92PedidoModal.open,#v95ShareModal.open,#v1027RouteEditModal.open,[role="dialog"][open]'
    );
    const mapOpen=!!document.querySelector('.v1034-map-fullscreen,.v1033-map-fullscreen');

    document.body.classList.toggle('v1034-modal-open',modalOpen);
    document.documentElement.classList.toggle('v1034-modal-open',modalOpen);
    document.body.classList.toggle('v1034-map-open',mapOpen);
    document.documentElement.classList.toggle('v1034-map-open',mapOpen);

    if(!mapOpen){
      document.body.classList.remove('v1033-map-open');
    }
  }

  function invalidateMaps(){
    [0,120,360].forEach(delay=>setTimeout(()=>{
      try{
        const maps=window.VescoV8?.state?.maps||{};
        Object.values(maps).forEach(map=>map?.invalidateSize?.({pan:false,animate:false}));
      }catch(e){}
    },delay));
  }

  function closeSidebarAfterNavigation(event){
    const button=event.target.closest?.('#v8Sidebar [data-tab]');
    if(button && isMobile()){
      document.body.classList.remove('v8-mobile-menu-open');
    }
  }

  function focusField(event){
    const el=event.target;
    if(!isMobile() || !el?.matches?.('input,select,textarea')) return;
    setTimeout(()=>{
      try{ el.scrollIntoView({block:'center',inline:'nearest',behavior:'smooth'}); }catch(e){}
    },isIOS()?360:220);
  }

  function apply(){
    raf=0;
    const mobile=isMobile();
    const root=document.documentElement;
    const body=document.body;
    if(!body) return;

    root.classList.toggle('v1034-mobile',mobile);
    body.classList.toggle('v1034-mobile',mobile);
    root.classList.toggle('v1034-ios',mobile&&isIOS());
    body.classList.toggle('v1034-ios',mobile&&isIOS());
    root.classList.toggle('v1034-android',mobile&&isAndroid());
    body.classList.toggle('v1034-android',mobile&&isAndroid());
    body.classList.toggle('v1034-touch',mobile&&coarse());

    const viewport=setViewportVars();
    ensureFilterButton();

    if(mobile){
      annotateTables();
    }else{
      body.classList.remove(
        'v1034-filters-open','v1034-keyboard-open','v1034-modal-open',
        'v1034-map-open','v8-mobile-menu-open'
      );
    }

    syncOpenLayers();

    const key=[mobile,viewport.width,viewport.height,viewport.keyboard].join('|');
    if(key!==lastViewportKey){
      lastViewportKey=key;
      invalidateMaps();
    }
  }

  function schedule(){
    if(raf) return;
    raf=requestAnimationFrame(apply);
  }

  function startObserver(){
    observer?.disconnect();
    observer=new MutationObserver(schedule);
    observer.observe(document.body,{
      childList:true,
      subtree:true,
      attributes:true,
      attributeFilter:['class']
    });
  }

  function start(){
    if(started) return;
    started=true;
    apply();
    startObserver();

    window.addEventListener('resize',schedule,{passive:true});
    window.addEventListener('orientationchange',()=>{
      schedule();
      setTimeout(invalidateMaps,280);
      setTimeout(invalidateMaps,700);
    },{passive:true});
    window.addEventListener('pageshow',schedule,{passive:true});
    window.visualViewport?.addEventListener('resize',schedule,{passive:true});
    window.visualViewport?.addEventListener('scroll',schedule,{passive:true});
    document.addEventListener('focusin',focusField,true);
    document.addEventListener('click',closeSidebarAfterNavigation,true);
  }

  window.VescoMobileV1035={
    version:VERSION,
    start,
    refresh:schedule,
    invalidateMaps,
    debug:()=>({
      version:VERSION,
      mobile:isMobile(),
      ios:isIOS(),
      android:isAndroid(),
      coarse:coarse(),
      innerWidth:window.innerWidth,
      innerHeight:window.innerHeight,
      visualViewport:{
        width:window.visualViewport?.width||null,
        height:window.visualViewport?.height||null,
        top:window.visualViewport?.offsetTop||0
      },
      keyboardOpen:document.body?.classList.contains('v1034-keyboard-open')||false,
      filtersOpen:document.body?.classList.contains('v1034-filters-open')||false,
      modalOpen:document.body?.classList.contains('v1034-modal-open')||false,
      mapOpen:document.body?.classList.contains('v1034-map-open')||false,
      tables:document.querySelectorAll('.v1034-mobile-table').length
    })
  };

  // Alias para páginas que ainda consultam o nome da versão anterior.
  window.VescoMobileV1034=window.VescoMobileV1035;

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',start,{once:true});
  }else{
    start();
  }
})();
