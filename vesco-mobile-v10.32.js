// vesco-mobile-v10.32.js — tabelas em cartões, viewport seguro e mapas responsivos.
(function(){
  'use strict';

  if(window.VescoMobileV1032) return;

  const VERSION='V10.32';
  let observer=null;
  let scheduled=false;
  let lastMobile=null;

  function isMobile(){
    return !!(window.matchMedia && window.matchMedia('(max-width: 760px)').matches);
  }

  function clean(value){
    return String(value == null ? '' : value).replace(/\s+/g,' ').trim();
  }

  function annotateTable(table){
    if(!table) return;

    const headers=Array.from(table.querySelectorAll('thead th')).map(th=>clean(th.textContent));
    table.classList.add('v1032-mobile-table');

    // Reaplica em cada render. O núcleo pode trocar apenas o tbody mantendo a mesma tabela.
    Array.from(table.querySelectorAll('tbody tr')).forEach(row=>{
      const cells=Array.from(row.children).filter(el=>el.tagName==='TD');
      cells.forEach((cell,index)=>{
        const colspan=Number(cell.getAttribute('colspan')||'1');
        if(colspan>1 || cell.classList.contains('v8-empty')){
          cell.classList.add('v1032-empty-cell');
          cell.setAttribute('data-label','');
          return;
        }
        cell.setAttribute('data-label',headers[index] || `Campo ${index+1}`);
      });
    });

    table.dataset.v1032Annotated=String(Date.now());
  }

  function annotateTables(root){
    const scope=root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('table.v8-table').forEach(annotateTable);
  }

  function invalidateMaps(){
    const core=window.VescoV8;
    const maps=core && core.state && core.state.maps;
    if(!maps || typeof maps!=='object') return;
    setTimeout(()=>{
      Object.values(maps).forEach(map=>{
        try{ if(map && typeof map.invalidateSize==='function') map.invalidateSize(true); }catch(e){}
      });
    },180);
  }

  function applyMode(){
    const mobile=isMobile();
    document.body.classList.toggle('v1032-mobile',mobile);
    document.documentElement.classList.toggle('v1032-mobile',mobile);

    if(lastMobile!==mobile){
      lastMobile=mobile;
      invalidateMaps();
    }

    annotateTables(document);
  }

  function schedule(){
    if(scheduled) return;
    scheduled=true;
    requestAnimationFrame(()=>{
      scheduled=false;
      applyMode();
    });
  }

  function startObserver(){
    const target=document.getElementById('v8Content') || document.body;
    if(observer) observer.disconnect();
    observer=new MutationObserver(schedule);
    observer.observe(target,{childList:true,subtree:true});
  }

  function start(){
    applyMode();
    startObserver();

    window.addEventListener('resize',schedule,{passive:true});
    window.addEventListener('orientationchange',()=>{
      schedule();
      invalidateMaps();
    },{passive:true});
    window.addEventListener('pageshow',schedule,{passive:true});

    if(window.visualViewport){
      window.visualViewport.addEventListener('resize',schedule,{passive:true});
    }

    // O núcleo é criado depois do DOM; troca o alvo do observer quando estiver pronto.
    let tries=0;
    const timer=setInterval(()=>{
      tries++;
      if(document.getElementById('v8Content')){
        clearInterval(timer);
        startObserver();
        schedule();
      }else if(tries>80){
        clearInterval(timer);
      }
    },250);
  }

  window.VescoMobileV1032={
    version:VERSION,
    start,
    refresh:schedule,
    annotateTables:()=>annotateTables(document),
    debug:()=>({
      version:VERSION,
      mobile:isMobile(),
      width:window.innerWidth,
      tables:document.querySelectorAll('table.v1032-mobile-table').length,
      content:!!document.getElementById('v8Content')
    })
  };

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
