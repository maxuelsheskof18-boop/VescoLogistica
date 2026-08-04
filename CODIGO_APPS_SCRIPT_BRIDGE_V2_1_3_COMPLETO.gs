/**
 * VESCO PLANILHA BRIDGE — SEM GOOGLE CLOUD
 * Versão: 2.1.4-ENTREGA-POR-TRANSPORTADORA
 *
 * Substitua TODO o Código.gs do Web App da planilha por este conteúdo.
 *
 * Funções:
 * - Recebe pedidos do vesco-worker e grava na aba Pedidos.
 * - Permite o painel ler a aba Pedidos via action=loadVesco.
 * - Suporta JSONP via callback para o navegador.
 * - Preserva campos operacionais já preenchidos.
 */

var VESCO_BRIDGE_VERSION = '2.1.4-ENTREGA-POR-TRANSPORTADORA';

var VESCO_CONFIG = {
  SPREADSHEET_ID: '1wMrr-OZCpuh_xJEHoWL_lw2iYjzI8DOjB5K51_9D5io',
  SHEET_NAME: 'Pedidos',
  SECRET: '1329269',
  TIMEZONE: 'America/Sao_Paulo'
};

var CABECALHO_LOGISTICA = [
  'id','numero','data_pedido','data_prevista','cliente_nome','situacao_tiny','valor','endereco_completo','forma_pagamento','instrucao_entrega','status_logistica','observacao_logistica','alarme','tempo_separacao','tipo_entrega','id_forma_envio','forma_envio_nome','transportadora','forma_envio','forma_frete','observacoes_tiny','observacoes_internas','prioridade_operacional','prioridade_label','lat','lon','conta_tiny','id_tiny','pedido_key','numero_ecommerce','observacao_pedido','link_pedido','nome_recebedor','doc_recebedor','data_entrega_realizada','entregue_em','ultima_sincronizacao'
];

var CAMPOS_PRESERVAR = [
  'status_logistica','observacao_logistica','alarme','tempo_separacao','observacao_pedido','link_pedido','nome_recebedor','doc_recebedor','data_entrega_realizada','entregue_em'
];

function doGet(e) {
  try {
    var params = (e && e.parameter) ? e.parameter : {};
    var action = String(params.action || '').trim();

    if (
      action === 'loadVesco' ||
      action === 'listarPedidos' ||
      action === 'pedidos' ||
      action === 'snapshot' ||
      action === 'snapshot-lite'
    ) {
      return responderJson_(e, listarPedidosParaPainel_(params));
    }

    return responderJson_(e, {
      ok: true,
      success: true,
      service: 'VESCO Planilha Bridge',
      version: VESCO_BRIDGE_VERSION,
      message: 'Web App online. Use action=loadVesco para carregar a aba Pedidos.',
      sheet: VESCO_CONFIG.SHEET_NAME,
      timestamp: agora_()
    });
  } catch (err) {
    return responderJson_(e, {
      ok: false,
      success: false,
      error: err && err.message ? err.message : String(err),
      version: VESCO_BRIDGE_VERSION
    });
  }
}

function doPost(e) {
  try {
    var payload = parsePayload_(e);
    var action = String(payload.action || '').trim();

    if (
      action === 'importPedidosWorker' ||
      action === 'syncPedidosWorker' ||
      action === 'bridgePedidosWorker' ||
      payload.rows ||
      payload.pedidos ||
      payload.data
    ) {
      return responderJson_(e, importarPedidosWorker_(payload));
    }

    return responderJson_(e, {
      ok: false,
      success: false,
      error: 'ACAO_POST_INVALIDA',
      action: action,
      version: VESCO_BRIDGE_VERSION,
      expectedActions: ['importPedidosWorker','syncPedidosWorker','bridgePedidosWorker']
    });
  } catch (err) {
    return responderJson_(e, {
      ok: false,
      success: false,
      error: err && err.message ? err.message : String(err),
      version: VESCO_BRIDGE_VERSION
    });
  }
}

function listarPedidosParaPainel_(params) {
  params = params || {};
  var sheet = garantirAbaPedidos_();
  var values = sheet.getDataRange().getValues();

  if (!values || values.length < 2) {
    return {
      ok: true,
      success: true,
      action: 'loadVesco',
      version: VESCO_BRIDGE_VERSION,
      sheet: VESCO_CONFIG.SHEET_NAME,
      total: 0,
      pedidos: [],
      rows: [],
      data: [],
      orders: [],
      counts: { pedidos: 0 },
      updatedAt: agora_()
    };
  }

  var headers = values[0].map(function(h) { return String(h || '').trim(); });
  var rows = [];

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var vazio = row.every(function(v) { return String(v || '').trim() === ''; });
    if (vazio) continue;

    var obj = {};
    headers.forEach(function(h, idx) {
      var val = row[idx];
      if (val instanceof Date) {
        if (h === 'data_pedido' || h === 'data_prevista' || h === 'data_entrega_realizada') {
          val = Utilities.formatDate(val, VESCO_CONFIG.TIMEZONE, 'dd/MM/yyyy');
        } else {
          val = Utilities.formatDate(val, VESCO_CONFIG.TIMEZONE, 'dd/MM/yyyy HH:mm:ss');
        }
      }
      obj[h] = val;
    });

    obj.pedido = obj.numero || obj.id || '';
    obj.num = obj.numero || obj.id || '';
    obj.status = obj.status_logistica || obj.situacao_tiny || '';
    obj.situacao = obj.situacao_tiny || obj.status_logistica || '';
    obj.cliente = obj.cliente_nome || '';
    obj.customer = obj.cliente_nome || '';
    obj.endereco = obj.endereco_completo || '';
    obj.pagamento = obj.forma_pagamento || '';
    obj.source = 'planilha_bridge';
    obj.__source = 'planilha_bridge';
    obj.__v8source = 'erp';
    rows.push(obj);
  }

  return {
    ok: true,
    success: true,
    action: 'loadVesco',
    version: VESCO_BRIDGE_VERSION,
    source: 'planilha_pedidos',
    sheet: VESCO_CONFIG.SHEET_NAME,
    total: rows.length,
    pedidos: rows,
    rows: rows,
    data: rows,
    orders: rows,
    counts: classificarCounts_(rows),
    updatedAt: agora_()
  };
}

function importarPedidosWorker_(payload) {
  payload = payload || {};

  var secretRecebido = String(payload.secret || payload.token || '').trim();
  if (secretRecebido !== VESCO_CONFIG.SECRET) {
    return { ok: false, success: false, error: 'SECRET_INVALIDO', version: VESCO_BRIDGE_VERSION };
  }

  var pedidos = payload.rows || payload.pedidos || payload.data || [];
  if (!Array.isArray(pedidos)) {
    return { ok: false, success: false, error: 'PEDIDOS_PRECISA_SER_ARRAY', version: VESCO_BRIDGE_VERSION };
  }

  var lock = LockService.getScriptLock();
  var lockObtido = false;

  try {
    lock.waitLock(30000);
    lockObtido = true;

    var sheet = garantirAbaPedidos_();
    var antigos = lerPedidosAntigos_(sheet);
    var vistos = {};
    var linhas = [];
    var created = 0;
    var updated = 0;

    pedidos.forEach(function(pedidoOriginal) {
      var obj = normalizarPedido_(pedidoOriginal);
      var chave = chavePedido_(obj);
      if (!chave) return;
      if (vistos[chave]) return;
      vistos[chave] = true;

      var antigo = antigos.porPedidoKey[String(obj.pedido_key || '').trim()] ||
        antigos.porId[String(obj.id || '').trim()] ||
        antigos.porContaIdTiny[String(obj.conta_tiny || '').trim() + '__' + String(obj.id_tiny || '').trim()] ||
        null;

      if (antigo) {
        updated++;
        CAMPOS_PRESERVAR.forEach(function(campo) {
          if (antigo[campo] !== undefined && antigo[campo] !== null && String(antigo[campo]).trim() !== '') {
            obj[campo] = antigo[campo];
          }
        });
      } else {
        created++;
      }

      obj.ultima_sincronizacao = agora_();
      linhas.push(CABECALHO_LOGISTICA.map(function(campo) { return obj[campo] !== undefined && obj[campo] !== null ? obj[campo] : ''; }));
    });

    sheet.clear();
    sheet.getRange(1, 1, 1, CABECALHO_LOGISTICA.length)
      .setValues([CABECALHO_LOGISTICA])
      .setFontWeight('bold')
      .setBackground('#004f9f')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);

    if (linhas.length > 0) {
      sheet.getRange(2, 1, linhas.length, CABECALHO_LOGISTICA.length).setValues(linhas);
    }

    try { sheet.autoResizeColumns(1, CABECALHO_LOGISTICA.length); } catch (e) {}
    SpreadsheetApp.flush();

    return {
      ok: true,
      success: true,
      action: 'importPedidosWorker',
      version: VESCO_BRIDGE_VERSION,
      sheet: VESCO_CONFIG.SHEET_NAME,
      receivedRows: pedidos.length,
      sentRows: pedidos.length,
      writtenRows: linhas.length,
      totalRows: linhas.length,
      created: created,
      updated: updated,
      skipped: Math.max(0, pedidos.length - linhas.length),
      updatedAt: agora_()
    };
  } finally {
    if (lockObtido) { try { lock.releaseLock(); } catch (e) {} }
  }
}

function parsePayload_(e) {
  var raw = '';
  if (e && e.postData && e.postData.contents) raw = String(e.postData.contents || '');
  if (!raw && e && e.parameter && e.parameter.payload) raw = String(e.parameter.payload || '');
  if (!raw) return {};
  return JSON.parse(raw);
}

function responderJson_(e, obj) {
  var callback = e && e.parameter ? String(e.parameter.callback || '') : '';
  var json = JSON.stringify(obj);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function abrirPlanilha_() {
  if (VESCO_CONFIG.SPREADSHEET_ID) return SpreadsheetApp.openById(VESCO_CONFIG.SPREADSHEET_ID);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Nenhuma planilha ativa encontrada e SPREADSHEET_ID está vazio.');
  return ss;
}

function garantirAbaPedidos_() {
  var ss = abrirPlanilha_();
  var sheet = ss.getSheetByName(VESCO_CONFIG.SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(VESCO_CONFIG.SHEET_NAME);
  if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0 || String(sheet.getRange(1, 1).getValue() || '').trim() === '') {
    sheet.getRange(1, 1, 1, CABECALHO_LOGISTICA.length).setValues([CABECALHO_LOGISTICA]).setFontWeight('bold').setBackground('#004f9f').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function lerPedidosAntigos_(sheet) {
  var out = { porId: {}, porPedidoKey: {}, porContaIdTiny: {} };
  var values = sheet.getDataRange().getValues();
  if (!values || values.length < 2) return out;

  var headers = values[0].map(function(h) { return String(h || '').trim(); });
  var idxId = headers.indexOf('id');
  var idxPedidoKey = headers.indexOf('pedido_key');
  var idxConta = headers.indexOf('conta_tiny');
  var idxIdTiny = headers.indexOf('id_tiny');

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var obj = {};
    headers.forEach(function(h, idx) { obj[h] = row[idx]; });
    var id = idxId >= 0 ? String(row[idxId] || '').trim() : '';
    var pedidoKey = idxPedidoKey >= 0 ? String(row[idxPedidoKey] || '').trim() : '';
    var conta = idxConta >= 0 ? String(row[idxConta] || '').trim() : '';
    var idTiny = idxIdTiny >= 0 ? String(row[idxIdTiny] || '').trim() : '';
    if (id) out.porId[id] = obj;
    if (pedidoKey) out.porPedidoKey[pedidoKey] = obj;
    if (conta && idTiny) out.porContaIdTiny[conta + '__' + idTiny] = obj;
  }
  return out;
}


function transportadoraReal_(p) {
  var candidatos = [
    p.transportadora,
    p.transportador,
    p.nomeTransportador,
    p.nome_transportador,
    p.carrier,
    p.shipping_carrier,
    caminho_(p, 'raw.nome_transportador'),
    caminho_(p, 'raw.transportadora'),
    caminho_(p, 'raw.transportador'),
    caminho_(p, 'raw.transporte.nome_transportador'),
    caminho_(p, 'raw.transporte.transportadora'),
    caminho_(p, 'raw.transportador.nome'),
    caminho_(p, 'raw.transportadora.nome')
  ];
  for (var i = 0; i < candidatos.length; i++) {
    var v = String(candidatos[i] || '').trim();
    var n = normalizar_(v);
    if (!v || n === '0' || n === '-' || n === 'nao definida' || n === 'nao definido' || n === 'sem transportadora') continue;
    if (/^[txrd]$/i.test(v)) continue;
    return v;
  }
  return '';
}

function tipoEntregaPorTransportadora_(p) {
  var carrier = transportadoraReal_(p);
  if (carrier) return 'Entrega';
  var tipo = String(p.tipo_entrega || '').trim();
  if (normalizar_(tipo).indexOf('sem endereco') >= 0) return 'Sem endereço';
  return 'Retirada';
}

function normalizarPedido_(p) {
  p = p || {};
  var contaTiny = primeiroValor_([p.conta_tiny, p.conta_label, nomeContaPorChave_(p.conta), nomeContaPorChave_(p.account), p.conta, p.account]);
  var idTiny = primeiroValor_([p.id_tiny, p.tiny_order_id, p.order_id, p.pedido_id, p.id]);
  var id = primeiroValor_([p.id, idTiny]);
  var numero = primeiroValor_([p.numero, p.num, p.tiny_number, p.pedido]);
  var pedidoKey = primeiroValor_([p.pedido_key, montarPedidoKey_(contaTiny, idTiny, p.account || p.conta)]);
  var clienteNome = primeiroValor_([p.cliente_nome, p.cliente, p.customer, p.destinatario, caminho_(p, 'raw.cliente.nome')]);
  var valor = primeiroValor_([p.valor, p.total_pedido, caminho_(p, 'raw.total_pedido')]);
  var formaPagamento = primeiroValor_([p.forma_pagamento, p.pagamento, caminho_(p, 'raw.forma_pagamento')]);
  var endereco = primeiroValor_([p.endereco_completo, p.endereco]);
  var situacao = primeiroValor_([p.situacao_tiny, p.situacao, p.status, caminho_(p, 'raw.situacao')]);
  var numeroEcommerce = primeiroValor_([p.numero_ecommerce, p.ecommerce_order_id, p.numeroPedidoEcommerce, caminho_(p, 'raw.numero_ecommerce'), caminho_(p, 'raw.ecommerce.numeroPedidoEcommerce')]);
  var idFormaEnvio = primeiroValor_([p.id_forma_envio, p.idFormaEnvio, p.forma_envio_id, caminho_(p, 'raw.id_forma_envio')]) || '0';
  var carrierReal = transportadoraReal_(p);
  var formaEnvioNome = primeiroValor_([p.forma_envio_nome, p.nome_forma_envio, carrierReal, p.forma_envio]) || 'Não definida';

  return {
    id: id,
    numero: numero,
    data_pedido: formatarDataBr_(primeiroValor_([p.data_pedido, p.data, p.created_date])),
    data_prevista: formatarDataBr_(p.data_prevista),
    cliente_nome: clienteNome,
    situacao_tiny: situacao,
    valor: valor,
    endereco_completo: endereco,
    forma_pagamento: formaPagamento,
    instrucao_entrega: primeiroValor_([p.instrucao_entrega, gerarInstrucaoPagamento_(formaPagamento, valor)]),
    status_logistica: p.status_logistica || 'A Separar',
    observacao_logistica: p.observacao_logistica || '',
    alarme: p.alarme || '',
    tempo_separacao: p.tempo_separacao || '',
    tipo_entrega: tipoEntregaPorTransportadora_(p),
    id_forma_envio: idFormaEnvio,
    forma_envio_nome: formaEnvioNome,
    transportadora: carrierReal,
    forma_envio: primeiroValor_([p.forma_envio, formaEnvioNome]),
    forma_frete: primeiroValor_([p.forma_frete, caminho_(p, 'raw.frete_por_conta')]),
    observacoes_tiny: primeiroValor_([p.observacoes_tiny, p.observacao_tiny, p.observacoes, caminho_(p, 'raw.obs')]),
    observacoes_internas: primeiroValor_([p.observacoes_internas, p.obs_interna, caminho_(p, 'raw.obs_interna')]),
    prioridade_operacional: p.prioridade_operacional || 4,
    prioridade_label: p.prioridade_label || '4 - Sem forma definida',
    lat: p.lat || '',
    lon: p.lon || '',
    conta_tiny: contaTiny,
    id_tiny: idTiny,
    pedido_key: pedidoKey,
    numero_ecommerce: numeroEcommerce,
    observacao_pedido: p.observacao_pedido || '',
    link_pedido: p.link_pedido || '',
    nome_recebedor: p.nome_recebedor || '',
    doc_recebedor: p.doc_recebedor || '',
    data_entrega_realizada: p.data_entrega_realizada || '',
    entregue_em: p.entregue_em || '',
    ultima_sincronizacao: agora_()
  };
}

function classificarCounts_(rows) {
  var counts = { pedidos: rows.length, separacao: 0, pronto: 0, logistica: 0, retiradas: 0, entregues: 0 };
  rows.forEach(function(p) {
    var status = normalizar_(p.status_logistica || p.situacao_tiny || p.status || p.situacao || '');
    var tipo = normalizar_(p.tipo_entrega || '');
    if (tipo.indexOf('retirada') >= 0) counts.retiradas++;
    if (status.indexOf('entreg') >= 0 || status.indexOf('retirado') >= 0 || status.indexOf('finaliz') >= 0) counts.entregues++;
    else if (status.indexOf('pronto') >= 0 || status.indexOf('separado') >= 0) counts.pronto++;
    else if (status.indexOf('rota') >= 0 || status.indexOf('enviado') >= 0) counts.logistica++;
    else counts.separacao++;
  });
  return counts;
}

function chavePedido_(obj) {
  return String(obj.pedido_key || (String(obj.conta_tiny || '').trim() + '__' + String(obj.id_tiny || '').trim()) || obj.id || '').trim();
}

function montarPedidoKey_(contaTiny, idTiny, contaRaw) {
  idTiny = String(idTiny || '').trim();
  if (!idTiny) return '';
  var conta = String(contaRaw || contaTiny || '').trim().toUpperCase();
  if (conta.indexOf('COM') >= 0 || conta.indexOf('COMERCIO') >= 0 || conta.indexOf('COMÉRCIO') >= 0) return 'COMERCIO__' + idTiny;
  if (conta.indexOf('DIST') >= 0) return 'DISTRIBUIDORA__' + idTiny;
  if (conta.indexOf('SUP') >= 0) return 'SUPRIMENTOS__' + idTiny;
  return conta.replace(/\s+/g, '_') + '__' + idTiny;
}

function nomeContaPorChave_(conta) {
  var s = String(conta || '').trim().toLowerCase();
  if (!s) return '';
  if (s === 'comercio' || s === 'comércio') return 'Comércio';
  if (s === 'distribuidora') return 'Distribuidora';
  if (s === 'suprimentos') return 'Suprimentos';
  return conta;
}

function primeiroValor_(lista) {
  for (var i = 0; i < lista.length; i++) {
    var v = lista[i];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return '';
}

function caminho_(obj, path) {
  try {
    if (!obj) return '';
    var partes = String(path || '').split('.');
    var atual = obj;
    for (var i = 0; i < partes.length; i++) {
      if (atual === null || atual === undefined) return '';
      atual = atual[partes[i]];
    }
    return atual === undefined || atual === null ? '' : atual;
  } catch (e) { return ''; }
}

function formatarDataBr_(valor) {
  if (!valor) return '';
  if (valor instanceof Date) return Utilities.formatDate(valor, VESCO_CONFIG.TIMEZONE, 'dd/MM/yyyy');
  var s = String(valor || '').trim();
  if (!s) return '';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    var p = s.substring(0, 10).split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }
  return s;
}

function gerarInstrucaoPagamento_(formaPagamento, valor) {
  var fp = String(formaPagamento || '').toUpperCase();
  var n = Number(String(valor || 0).replace(',', '.')) || 0;
  var valorFmt = 'R$ ' + n.toFixed(2).replace('.', ',');
  if (fp.indexOf('CARTAO') >= 0 || fp.indexOf('CARTÃO') >= 0) return 'MAQUININHA — ' + valorFmt;
  if (fp.indexOf('DINHEIRO') >= 0) return 'DINHEIRO — TROCO PARA ' + valorFmt;
  if (fp.indexOf('BOLETO') >= 0 || fp.indexOf('PIX') >= 0 || fp.indexOf('LINK') >= 0) return 'JÁ PAGO';
  if (!formaPagamento) return 'VERIFICAR PAGAMENTO';
  return 'CONFERIR: ' + formaPagamento + ' — ' + valorFmt;
}

function normalizar_(v) {
  return String(v || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function agora_() {
  return Utilities.formatDate(new Date(), VESCO_CONFIG.TIMEZONE, 'dd/MM/yyyy HH:mm:ss');
}

function configurarBridgeVesco() {
  var sheet = garantirAbaPedidos_();
  sheet.getRange(1, 1, 1, CABECALHO_LOGISTICA.length)
    .setValues([CABECALHO_LOGISTICA])
    .setFontWeight('bold')
    .setBackground('#004f9f')
    .setFontColor('#ffffff');
  sheet.setFrozenRows(1);
  try { sheet.autoResizeColumns(1, CABECALHO_LOGISTICA.length); } catch (e) {}
  return 'Bridge configurado com sucesso: ' + VESCO_BRIDGE_VERSION;
}
