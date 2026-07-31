// vesco-mobile-v10.33.js — layout mobile forçado, filtros compactos e mapa Flex otimizado.
(function(){
  'use strict';
  if(window.VescoMobileV1033) return;
  const VERSION='V10.33';
  const BREAKPOINT=900;
  let observer=null, scheduled=false, mobileMode=false;

  function isMobile(){
    const w=Math.min(Number(window.innerWidth||9999),Number(window.screen?.width||9999));
    return w<=BREAKPOINT || !!window.matchMedia?.(`(max-width:${BREAKPOINT}px)`).matches;
  }
  function clean(v){ return String(v==null?'':v).replace(/\s+/g,' ').trim(); }
  function imp(el,prop,value){ if(el) el.style.setProperty(prop,value,'important'); }
  function clearImp(el,props){ if(!el)return; props.forEach(p=>el.style.removeProperty(p)); }

  function ensureFilterButton(){
    const title=document.querySelector('#v8Topbar .v8-title');
    if(!title || document.getElementById('v1033MobileFilters')) return;
    const btn=document.createElement('button');
    btn.id='v1033MobileFilters';
    btn.className='v8-btn secondary v1033-filter-toggle';
    btn.type='button';
    btn.innerHTML='<i class="fas fa-sliders"></i><span>Filtros</span>';
    btn.addEventListener('click',()=>{
      document.body.classList.toggle('v1033-filters-open');
      setTimeout(invalidateMaps,120);
    });
    title.appendChild(btn);
  }

  function annotateAndForceTable(table){
    if(!table) return;
    const headers=Array.from(table.querySelectorAll('thead th')).map(th=>clean(th.textContent));
    table.classList.add('v1033-mobile-table');
    imp(table,'display','block'); imp(table,'width','100%'); imp(table,'min-width','0'); imp(table,'max-width','100%');
    const head=table.querySelector('thead'); if(head) imp(head,'display','none');
    const body=table.querySelector('tbody'); if(body){ imp(body,'display','grid'); imp(body,'grid-template-columns','minmax(0,1fr)'); imp(body,'gap','10px'); imp(body,'width','100%'); }
    Array.from(table.querySelectorAll('tbody tr')).forEach(row=>{
      imp(row,'display','block'); imp(row,'width','100%'); imp(row,'min-width','0'); imp(row,'max-width','100%'); imp(row,'box-sizing','border-box');
      const cells=Array.from(row.children).filter(x=>x.tagName==='TD');
      cells.forEach((cell,i)=>{
        const empty=Number(cell.getAttribute('colspan')||1)>1 || cell.classList.contains('v8-empty');
        cell.dataset.label=empty?'':(headers[i]||`Campo ${i+1}`);
        cell.classList.toggle('v1033-empty-cell',empty);
        imp(cell,'display',empty?'block':'grid');
        if(!empty) imp(cell,'grid-template-columns','minmax(96px,35%) minmax(0,1fr)');
        imp(cell,'width','100%'); imp(cell,'min-width','0'); imp(cell,'max-width','100%'); imp(cell,'box-sizing','border-box'); imp(cell,'white-space','normal'); imp(cell,'overflow','visible');
      });
    });
    const wrap=table.closest('.v8-table-wrap'); if(wrap){ imp(wrap,'width','100%'); imp(wrap,'min-width','0'); imp(wrap,'max-width','100%'); imp(wrap,'overflow','visible'); }
  }

  function clearTable(table){
    if(!table) return;
    table.classList.remove('v1033-mobile-table');
    clearImp(table,['display','width','min-width','max-width']);
    clearImp(table.querySelector('thead'),['display']);
    clearImp(table.querySelector('tbody'),['display','grid-template-columns','gap','width']);
    table.querySelectorAll('tbody tr').forEach(row=>clearImp(row,['display','width','min-width','max-width','box-sizing']));
    table.querySelectorAll('tbody td').forEach(cell=>clearImp(cell,['display','grid-template-columns','width','min-width','max-width','box-sizing','white-space','overflow']));
  }

  function forceViewport(){
    const shell=document.getElementById('v8Shell'), main=document.getElementById('v8Main'), content=document.getElementById('v8Content');
    [document.documentElement,document.body,shell,main,content].forEach(el=>{imp(el,'width','100%');imp(el,'min-width','0');imp(el,'max-width','100%');imp(el,'box-sizing','border-box');});
    imp(document.documentElement,'overflow-x','hidden'); imp(document.body,'overflow-x','hidden');
    if(content){imp(content,'overflow-x','hidden');}
    document.querySelectorAll('.v8-card,.v8-grid,.v9-dashboard-grid,.v9-bottom-grid,.v9-route-grid,.v8-flex-layout').forEach(el=>{imp(el,'min-width','0');imp(el,'max-width','100%');imp(el,'box-sizing','border-box');});
  }

  function invalidateMaps(){
    const maps=window.VescoV8?.state?.maps||{};
    setTimeout(()=>Object.values(maps).forEach(m=>{try{m?.invalidateSize?.(true);}catch(e){}}),160);
  }

  function apply(){
    mobileMode=isMobile();
    document.documentElement.classList.toggle('v1033-mobile',mobileMode);
    document.body.classList.toggle('v1033-mobile',mobileMode);
    ensureFilterButton();
    if(mobileMode){
      forceViewport();
      document.querySelectorAll('table.v8-table').forEach(annotateAndForceTable);
    }else{
      document.body.classList.remove('v1033-filters-open');
      document.querySelectorAll('table.v8-table').forEach(clearTable);
    }
    invalidateMaps();
  }

  function schedule(){ if(scheduled)return; scheduled=true; requestAnimationFrame(()=>{scheduled=false;apply();}); }
  function startObserver(){
    observer?.disconnect();
    observer=new MutationObserver(schedule);
    observer.observe(document.body,{childList:true,subtree:true});
  }
  function start(){
    apply(); startObserver();
    window.addEventListener('resize',schedule,{passive:true});
    window.addEventListener('orientationchange',()=>{schedule();setTimeout(invalidateMaps,250);},{passive:true});
    window.addEventListener('pageshow',schedule,{passive:true});
    window.visualViewport?.addEventListener('resize',schedule,{passive:true});
  }
  window.VescoMobileV1033={version:VERSION,start,refresh:schedule,debug:()=>({version:VERSION,mobile:isMobile(),innerWidth:window.innerWidth,screenWidth:window.screen?.width,filtersOpen:document.body.classList.contains('v1033-filters-open'),tables:document.querySelectorAll('.v1033-mobile-table').length})};
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true}); else start();
})();
