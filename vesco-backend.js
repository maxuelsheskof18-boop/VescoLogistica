(function () {
  'use strict';

  const CONFIG = {
    apiUrl: 'https://atendente-vesco-worker.2cwhzy.easypanel.host/api',
    eventsUrl: 'https://atendente-vesco-worker.2cwhzy.easypanel.host/events',
    refreshFallbackMs: 60000,
  };

  let eventSource = null;
  let refreshTimer = null;
  let carregando = false;
  let ultimaCarga = null;

  function parseResposta(texto) {
    let dados = texto;

    // Aceita JSON normal ou JSON serializado duas vezes.
    for (let i = 0; i < 2; i++) {
      if (typeof dados !== 'string') break;

      try {
        dados = JSON.parse(dados);
      } catch {
        break;
      }
    }

    if (!dados || typeof dados !== 'object') {
      throw new Error('Resposta inválida do VESCO Worker.');
    }

    return dados;
  }

  async function chamarApi(action, parametros = {}) {
    const url = new URL(CONFIG.apiUrl);

    url.searchParams.set('action', action);

    Object.entries(parametros).forEach(([chave, valor]) => {
      if (valor !== undefined && valor !== null && valor !== '') {
        url.searchParams.set(chave, String(valor));
      }
    });

    const resposta = await fetch(url.toString(), {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
      },
    });

    const texto = await resposta.text();

    if (!resposta.ok) {
      throw new Error(
        `VESCO Worker respondeu ${resposta.status}: ${texto.slice(0, 300)}`
      );
    }

    const dados = parseResposta(texto);

    if (dados.success === false) {
      throw new Error(dados.error || 'Falha retornada pelo VESCO Worker.');
    }

    return dados;
  }

  async function carregarTudo() {
    if (carregando) return ultimaCarga;

    carregando = true;

    try {
      const dados = await chamarApi('loadVesco');

      ultimaCarga = dados;

      // Estado global para compatibilidade com módulos antigos.
      window.VESCO_DATA = dados;
      window.VESCO_PEDIDOS = dados.pedidos || [];
      window.VESCO_SEPARACAO = dados.separacao || [];
      window.VESCO_LOGISTICA = dados.logistica || [];
      window.VESCO_RETIRADAS = dados.retiradas || [];
      window.VESCO_ENTREGUES = dados.entregues || [];
      window.VESCO_SEPARADOS_HOJE = dados.separadosHoje || [];
      window.VESCO_COMPROVANTES =
        dados.comprovantesMotorista || dados.comprovantes || [];

      // Avisa todos os módulos que chegaram dados novos.
      window.dispatchEvent(
        new CustomEvent('vesco:data', {
          detail: dados,
        })
      );

      return dados;
    } catch (erro) {
      console.error('[VESCO Backend] Falha ao carregar:', erro);

      window.dispatchEvent(
        new CustomEvent('vesco:error', {
          detail: erro,
        })
      );

      throw erro;
    } finally {
      carregando = false;
    }
  }

  function agendarAtualizacao() {
    clearTimeout(refreshTimer);

    refreshTimer = setTimeout(() => {
      carregarTudo().catch(() => {});
    }, 300);
  }

  function iniciarRealtime() {
    if (eventSource) {
      eventSource.close();
    }

    eventSource = new EventSource(CONFIG.eventsUrl);

    eventSource.onopen = function () {
      console.log('[VESCO Backend] Realtime conectado.');
    };

    eventSource.onmessage = function () {
      agendarAtualizacao();
    };

    [
      'sync',
      'update',
      'pedido',
      'orders',
      'route',
      'delivery',
      'firebase',
    ].forEach((evento) => {
      eventSource.addEventListener(evento, agendarAtualizacao);
    });

    eventSource.onerror = function () {
      console.warn(
        '[VESCO Backend] Realtime desconectado. O navegador tentará reconectar.'
      );
    };
  }

  function iniciar() {
    carregarTudo().catch(() => {});
    iniciarRealtime();

    // Segurança caso o SSE fique temporariamente indisponível.
    setInterval(() => {
      carregarTudo().catch(() => {});
    }, CONFIG.refreshFallbackMs);
  }

  window.VescoBackend = {
    config: CONFIG,
    iniciar,
    carregarTudo,
    chamarApi,
    getDados: () => ultimaCarga,
  };
})();