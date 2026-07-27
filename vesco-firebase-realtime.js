// vesco-firebase-realtime.js — V10.29 LIGHT
// Compatibilidade enxuta: o núcleo V10.29 controla os listeners de pedidos, rotas e entregas.
// Não regrava rotas ao receber eventos e não cria loops de sincronização/renderização.

(function(){
  'use strict';
  if(window.__vescoFirebaseRealtimeV1029) return;
  window.__vescoFirebaseRealtimeV1029=true;

  let timer=null;
  let attempts=0;

  function start(){
    attempts++;
    if(window.VescoV8 && typeof window.VescoV8.startRealtimeSync==='function'){
      clearInterval(timer);
      timer=null;
      const result=window.VescoV8.startRealtimeSync();
      window.VescoFirebaseRealtime={
        version:'V10.29-light',
        start:()=>window.VescoV8.startRealtimeSync(),
        stop:()=>window.VescoV8.stopRealtimeSync(),
        status:()=>window.VescoV8.realtimeStatus(),
        result
      };
      console.log('VESCO Firebase Realtime V10.29 Light ativo — sem sincronização duplicada de rotas.');
      return true;
    }
    if(attempts>80){
      clearInterval(timer);
      timer=null;
      console.warn('VESCO Firebase Realtime V10.29: núcleo VescoV8 não encontrado.');
    }
    return false;
  }

  if(!start()) timer=setInterval(start,250);
  window.addEventListener('pageshow',()=>{try{start();}catch(e){}});
})();
