// vesco-firebase-realtime.js — V10.31 LIGHT
// Compatibilidade enxuta: o núcleo V10.31 controla os listeners de pedidos, rotas e entregas.
// Não regrava rotas ao receber eventos e não cria loops de sincronização/renderização.

(function(){
  'use strict';
  if(window.__vescoFirebaseRealtimeV1031) return;
  window.__vescoFirebaseRealtimeV1031=true;

  let timer=null;
  let attempts=0;
  let started=false;

  function start(){
    if(started) return true;
    attempts++;
    if(window.VescoV8 && typeof window.VescoV8.startRealtimeSync==='function'){
      clearInterval(timer);
      timer=null;
      const result=window.VescoV8.startRealtimeSync();
      started=true;
      window.VescoFirebaseRealtime={
        version:'V10.31-light',
        start:()=>window.VescoV8.startRealtimeSync(),
        stop:()=>window.VescoV8.stopRealtimeSync(),
        status:()=>window.VescoV8.realtimeStatus(),
        result
      };
      console.log('VESCO Firebase Realtime V10.31 Light ativo — inicialização única e sem sincronização duplicada.');
      return true;
    }
    if(attempts>80){
      clearInterval(timer);
      timer=null;
      console.warn('VESCO Firebase Realtime V10.31: núcleo VescoV8 não encontrado.');
    }
    return false;
  }

  if(!start()) timer=setInterval(start,250);
  window.addEventListener('pageshow',()=>{try{if(!started) start();}catch(e){}});
})();
