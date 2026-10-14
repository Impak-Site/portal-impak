// agenda-core.js — Agenda de atividades por etapa (#675, 13/10/2026).
//
// Cada processo gera sozinho as tarefas da Matriz de Atividades (v2), a
// partir do que já está preenchido nele. Nada é gravado para "criar" uma
// tarefa: ela é calculada na hora (nasce quando o gatilho acontece e some
// quando o campo correspondente é preenchido). Só o que é MANUAL ("feito")
// ou "não se aplica" fica guardado (tabela agenda_conclusoes).
//
// Quem faz o quê: /cadastros → Listas → "Agenda — Funções" (função → logins)
// e "Agenda — Atividades" (função, prazo, prioridade, ativa). Os padrões
// estão em listas-padrao.js.
//
// UMD: navegador (<script src="/agenda-core.js">) e Node (testes).
(function () {
  const AGENDA_CORTE = '2026-10-01'; // tarefas com prazo antes disso = histórico (não aparecem)

  // ── datas (strings YYYY-MM-DD, sem fuso) ─────────────────────────────
  const iso = d => {
    if (!d) return null;
    const s = String(d).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  };
  const toDate = s => new Date(s + 'T12:00:00');
  const fmt = dt => dt.toISOString().slice(0, 10);
  function somaDias(s, n) { s = iso(s); if (!s) return null; const d = toDate(s); d.setDate(d.getDate() + (n || 0)); return fmt(d); }
  function somaUteis(s, n) {
    s = iso(s); if (!s) return null;
    const d = toDate(s); let k = n || 0; const passo = k < 0 ? -1 : 1;
    while (k !== 0) { d.setDate(d.getDate() + passo); const w = d.getDay(); if (w !== 0 && w !== 6) k -= passo; }
    return fmt(d);
  }
  const passou = (s, hoje) => !!iso(s) && iso(s) <= hoje;
  const maxData = (...ds) => ds.map(iso).filter(Boolean).sort().pop() || null;
  const diasEntre = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);

  const tem = v => v !== null && v !== undefined && String(v).trim() !== '';
  const sim = v => /^(sim|s|true|1)$/i.test(String(v || '').trim());
  function jsonArr(v) {
    if (Array.isArray(v)) return v;
    if (!v) return [];
    try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch (e) { return []; }
  }
  const qtdProdutos = p => jsonArr(p.produtos_json).reduce((s, x) => s + (parseFloat(x && x.quantidade) || 0), 0);
  const CFOP_SEM_VENDA = /^(5905|6905|5907|6907|5927|6927)$/;
  const vendasReais = p => jsonArr(p.vendas_json).filter(v => v && !CFOP_SEM_VENDA.test(String(v.nf_saida_cfop || '').replace(/\D/g, '')));
  const qtdVendida = p => vendasReais(p).reduce((s, v) => s + (v.itens || []).reduce((s2, it) => s2 + (parseFloat(it && it.quantidade) || 0), 0), 0);
  function ehLCL(p) { // mesma regra de controle-core.js
    const cs = jsonArr(p.containers_json);
    if (cs.length) return cs.every(c => String((c && c.tipo) || '').toUpperCase() === 'LCL');
    return String(p.tipo_container || '').toUpperCase() === 'LCL';
  }
  const ehAcomp = p => p.finalidade === 'ACOMPANHAMENTO';
  const ged = p => (p.ged_nomes || []).map(String);
  const temDoc = (p, re) => ged(p).some(n => re.test(n));
  const confPendentes = p => (p.conferencia_resumo && p.conferencia_resumo.pendentes) || 0;
  const chegou = (p, h) => passou(p.data_chegada, h) || passou(p.data_presenca, h);
  const liberado = p => tem(p.data_liberacao) || (String(p.canal || '').toUpperCase() === 'VERDE' && tem(p.data_parametrizacao));
  function temCustosReais(p) {
    const r = p.real_json && typeof p.real_json === 'object' ? p.real_json : null;
    if (!r) return false;
    return Object.keys(r).some(k => { const v = r[k]; if (v && typeof v === 'object') return Object.values(v).some(x => parseFloat(x) > 0); return parseFloat(v) > 0; });
  }

  // Parcelas de câmbio no formato "um pagamento por linha". No navegador usa
  // listarPagamentosPI (controle-core.js, regra oficial dos vencimentos); nos
  // testes cai nesta versão simples.
  function pagamentosDe(p, ctx) {
    if (ctx && typeof ctx.listarPagamentosPI === 'function') {
      try { return ctx.listarPagamentosPI([p]) || []; } catch (e) { /* cai no simples */ }
    }
    const out = [];
    if (p.pi_pagamento === 'PARCELADO') {
      jsonArr(p.pi_parcelas_json).forEach((pc, i) => { if (parseFloat(pc.valor_usd) > 0) out.push({ parcela: pc.label || ('parcela ' + (i + 1)), _tipo: 'parcelado', _parcelaIndex: i, vencimento: pc.data_vencimento || null, pago: !!pc.cambio_fechado }); });
    } else if (p.pi_pagamento === 'ENTRADA_SALDO') {
      out.push({ parcela: 'entrada', _tipo: 'entrada', vencimento: p.pi_data_entrada || null, pago: !!p.pi_cambio_entrada });
      out.push({ parcela: 'saldo', _tipo: 'saldo', vencimento: p.pi_data_saldo || null, pago: !!p.pi_pago });
    } else if (p.pi_pagamento === 'VISTA' || p.pi_pagamento === 'PRAZO') {
      out.push({ parcela: 'unico', _tipo: 'unico', vencimento: (p.pi_pagamento === 'PRAZO' ? p.pi_data_saldo : p.pi_data_entrada) || null, pago: !!p.pi_pago });
    }
    return out;
  }
  function grupoParcela(pg) {
    const l = String(pg.parcela || '').toLowerCase();
    if (l === 'inicial' || l === 'entrada') return 'A06';
    if (/pr[eé]-?embarque/.test(l)) return 'A13';
    return 'A15';
  }
  function parcelaRaw(p, pg) {
    if (pg._tipo !== 'parcelado') return null;
    return jsonArr(p.pi_parcelas_json)[pg._parcelaIndex] || null;
  }
  const nomeParcela = pg => ({ entrada: 'Entrada', saldo: 'Saldo', unico: 'Pagamento único', indefinido: 'Sem forma de pagamento' }[pg.parcela] || pg.parcela);

  // ── definição das atividades (por código; nome/função/prioridade vêm da Lista)
  // instancias(p, h, ctx) → [{ chave, detalhe, prazo, feito }]  (vazio = não nasceu)
  // base(p): data-marco; dias/uteis: prazo padrão em relação ao marco.
  const um = (feito, extra) => [Object.assign({ chave: '', feito: !!feito }, extra || {})];
  const ATIVIDADES = {
    A01: { auto: true, como: 'Finalidade + Cliente + Produtos + Forma de pagamento preenchidos',
      base: p => p.pi_data || p.created_at, dias: 1, uteis: true,
      instancias: p => um(tem(p.finalidade) && tem(p.cliente) && qtdProdutos(p) > 0 && tem(p.pi_pagamento)) },
    A02: { auto: false, como: 'Manual', semAcomp: true,
      base: p => p.pi_data || p.created_at, dias: 1, uteis: true, instancias: () => um(false) },
    A03: { auto: true, como: 'Campo "ID no Conexos" preenchido',
      base: p => p.pi_data || p.created_at, dias: 2, uteis: true, instancias: p => um(tem(p.conexos_id)) },
    A04: { auto: true, como: 'Vendas cobrindo todas as unidades do processo', semAcomp: true,
      base: p => p.etd || (p.pi_data ? somaDias(p.pi_data, 30) : null), dias: 0,
      // Encomenda / Conta e Ordem com cliente definido: a venda é o próprio cliente
      // do processo (não precisa de venda separada). Só cobra Importação própria.
      instancias: p => {
        if ((p.finalidade === 'ENCOMENDA' || p.finalidade === 'CONTA_E_ORDEM') && tem(p.cliente)) return um(true);
        const t = qtdProdutos(p); return um(t > 0 && qtdVendida(p) >= t, { detalhe: t ? `${Math.round(qtdVendida(p))} de ${Math.round(t)} un. vendidas` : '' });
      } },
    A05: { auto: true, como: '"Valor recebido do cliente" preenchido na parcela', semAcomp: true,
      aplica: p => p.finalidade === 'ENCOMENDA' || p.finalidade === 'CONTA_E_ORDEM',
      instancias: (p, h, ctx) => pagamentosDe(p, ctx).filter(pg => !pg.pago && pg.vencimento).map(pg => {
        const raw = parcelaRaw(p, pg);
        const recebido = raw ? tem(raw.valor_recebido_cliente) : tem(p.pi_valor_recebido_cliente);
        return { chave: String(pg.parcela), detalhe: nomeParcela(pg), prazo: somaDias(pg.vencimento, -2), feito: recebido };
      }) },
    A07: { auto: true, como: 'Data de Prontidão preenchida',
      base: p => p.previsao_prontidao, dias: 0,
      instancias: p => tem(p.previsao_prontidao) ? um(tem(p.data_prontidao) || tem(p.data_embarque)) : [] },
    A08: { auto: true, como: 'Nº Booking + ETD + Navio preenchidos',
      base: p => p.data_prontidao, dias: 3,
      instancias: p => tem(p.data_prontidao) ? um((tem(p.booking_numero) && tem(p.etd) && tem(p.navio)) || tem(p.data_embarque)) : [] },
    A09: { auto: true, como: 'CI, PL e Draft anexados + conferência sem divergência pendente',
      base: p => p.etd, dias: -3,
      instancias: (p, h) => {
        if (!tem(p.etd)) return [];
        const ci = temDoc(p, /\bci\b|invoice/i) || tem(p.ci_numero), pl = temDoc(p, /\bpl\b|packing/i), dr = temDoc(p, /draft|\bbl\b|hbl/i) || tem(p.hbl);
        const falta = [!ci && 'CI', !pl && 'PL', !dr && 'Draft'].filter(Boolean);
        const pend = confPendentes(p);
        // Já embarcou com HBL e CI registrados: os documentos existem (só não
        // foram anexados com nome reconhecível) — não fica cobrando depois.
        if (passou(p.data_embarque, h) && tem(p.hbl) && tem(p.ci_numero) && !pend) return um(true);
        return um(!falta.length && !pend, { detalhe: falta.length ? 'Falta: ' + falta.join(', ') : (pend ? pend + ' divergência(s) na conferência' : '') });
      } },
    A10: { auto: true, como: 'Aprovação HBL = Sim',
      base: p => p.etd, dias: 0,
      instancias: (p, h) => (temDoc(p, /draft/i) || tem(p.hbl) || passou(p.data_embarque, h)) && tem(p.etd) ? um(sim(p.aprovacao_hbl)) : [] },
    A11: { auto: true, como: '"Docs enviados à despachante" preenchido',
      base: p => p.data_embarque || p.etd, dias: 1, uteis: true,
      instancias: p => sim(p.aprovacao_hbl) ? um(tem(p.docs_enviados_despachante) || sim(p.solicitacao_li)) : [] },
    A12: { auto: true, como: 'Solicitação LI = Sim',
      base: p => p.docs_enviados_despachante, dias: 2, uteis: true,
      instancias: p => tem(p.docs_enviados_despachante) ? um(sim(p.solicitacao_li)) : [] },
    A14: { auto: true, como: 'Data de Embarque + HBL + Free Time preenchidos',
      base: p => p.etd, dias: 2,
      instancias: (p, h) => passou(p.etd, h) ? um(tem(p.data_embarque) && tem(p.hbl) && tem(p.free_time)) : [] },
    A16: { auto: true, como: 'Taxa + nº SWIFT preenchidos na parcela', semAcomp: true,
      instancias: p => jsonArr(p.pi_parcelas_json).map((pc, i) => ({ pc, i })).filter(x => x.pc && x.pc.tipo_cambio === 'FUTURO').map(({ pc, i }) => ({
        chave: String(i), detalhe: pc.label || ('Parcela ' + (i + 1)),
        prazo: somaUteis(pc.data_fechamento_cambio || pc.data_vencimento, 2), feito: tem(pc.cambio_fechado) && tem(pc.swift_id) })) },
    A17: { auto: true, como: 'Conferência do CE sem divergência pendente',
      base: p => p.eta, dias: 0,
      instancias: p => (tem(p.ce_master) || tem(p.ce_house)) ? um(!!p.conferencia_resumo && !confPendentes(p)) : [] },
    A18: { auto: true, como: 'Data de Chegada ou de Presença de Carga preenchida',
      base: p => p.eta, dias: 1,
      instancias: (p, h) => passou(p.eta, h) && tem(p.data_embarque) ? um(tem(p.data_chegada) || tem(p.data_presenca)) : [] },
    A19: { auto: true, como: 'Campo Armazém preenchido', aplica: ehLCL,
      base: p => p.data_chegada || p.data_presenca, dias: 1,
      instancias: (p, h) => chegou(p, h) ? um(tem(p.armazem)) : [] },
    A20: { auto: true, como: 'Nº DI/DUIMP + Data de Registro preenchidos',
      base: p => p.data_presenca || p.data_chegada, dias: 1, uteis: true,
      instancias: (p, h) => chegou(p, h) ? um(tem(p.numero_di) && tem(p.data_registro_di)) : [] },
    A21: { auto: false, como: 'Manual (some sozinha quando sai o canal)', semAcomp: true,
      base: p => p.data_registro_di, dias: 0,
      instancias: p => (tem(p.numero_di) && tem(p.data_registro_di)) ? um(tem(p.canal) || tem(p.data_parametrizacao) || liberado(p)) : [] },
    A22: { auto: true, como: 'Nº DUIMP preenchido nas parcelas com câmbio fechado', semAcomp: true,
      base: p => p.data_registro_di, dias: 5,
      instancias: p => {
        if (!tem(p.numero_di) || !tem(p.data_registro_di)) return [];
        if (p.pi_pagamento === 'PARCELADO') {
          const ant = jsonArr(p.pi_parcelas_json).filter(pc => pc && tem(pc.cambio_fechado) && pc.pagto_antecipado !== false);
          if (!ant.length) return [];
          return um(ant.every(pc => tem(pc.duimp_numero)));
        }
        if (!(tem(p.pi_cambio_entrada) || tem(p.pi_cambio_fechado))) return [];
        return um(tem(p.pi_duimp_numero));
      } },
    A23: { auto: true, como: 'Data de Liberação preenchida (ou canal VERDE)',
      base: p => p.data_parametrizacao || p.data_registro_di, dias: 2, uteis: true,
      instancias: p => tem(p.canal) ? um(liberado(p)) : [] },
    A24: { auto: true, como: 'Nº da NF de Entrada preenchido', semAcomp: true,
      base: p => maxData(p.data_liberacao || p.data_parametrizacao, p.data_chegada || p.data_presenca), dias: 1, uteis: true,
      instancias: (p, h) => liberado(p) && chegou(p, h) ? um(tem(p.nf_entrada_numero)) : [] },
    A25: { auto: true, como: 'NF de saída lançada em todas as vendas', semAcomp: true,
      base: p => p.nf_entrada_data, dias: 1, uteis: true,
      instancias: p => {
        const vs = vendasReais(p);
        if (!tem(p.nf_entrada_numero) || !vs.length) return [];
        const sem = vs.filter(v => !tem(v.nf_saida_numero)).length;
        return um(!sem, { detalhe: sem ? `${sem} venda(s) sem NF` : '' });
      } },
    A26: { auto: false, como: 'Manual (por venda)', semAcomp: true,
      instancias: p => vendasReais(p).filter(v => tem(v.nf_saida_numero) && v.forma_pagamento && v.forma_pagamento !== 'avista').map(v => {
        const nums = String(v.prazo_texto || '').match(/\d+/g) || [];
        const dias = nums.length ? Math.max.apply(null, nums.map(Number)) : 30;
        return { chave: String(v.nf_saida_numero).replace(/\D/g, ''), detalhe: `NF ${v.nf_saida_numero} · ${v.cliente || ''}${v.prazo_texto ? ' · ' + v.prazo_texto : ''}`, prazo: somaDias(v.nf_saida_data, dias), feito: false };
      }) },
    A27: { auto: true, como: 'Data de Agendamento + Transportadora preenchidas',
      base: p => maxData(p.data_liberacao || p.data_parametrizacao, p.data_chegada || p.data_presenca), dias: 1, uteis: true,
      instancias: (p, h) => liberado(p) && chegou(p, h) ? um((tem(p.data_agendamento) && tem(p.transportadora)) || tem(p.data_carregamento)) : [] },
    A28: { auto: true, como: 'Data de Carregamento preenchida',
      base: p => p.data_agendamento, dias: 0,
      instancias: p => tem(p.data_agendamento) && !p.agendamento_cancelado ? um(tem(p.data_carregamento) || tem(p.data_devolucao_vazio)) : [] },
    A29: { auto: true, como: 'Data de Devolução do Vazio preenchida', aplica: p => !ehLCL(p),
      base: p => p.demurrage_vencimento || (tem(p.free_time) && (p.data_chegada || p.data_presenca) ? somaDias(p.data_chegada || p.data_presenca, (parseInt(p.free_time, 10) || 0) - 1) : p.data_carregamento), dias: 0,
      instancias: p => tem(p.data_carregamento) ? um(tem(p.data_devolucao_vazio)) : [] },
    A30: { auto: true, como: 'Status RIC = Isento ou Pagamento da Lavagem preenchido', aplica: p => !ehLCL(p),
      base: p => p.data_devolucao_vazio, dias: 5,
      instancias: p => tem(p.data_devolucao_vazio) ? um(String(p.ric_status || '') === 'Isento' || tem(p.data_pagamento_lavagem)) : [] },
    A31: { auto: true, como: 'Custos Reais lançados', semAcomp: true,
      base: p => p.data_devolucao_vazio || p.data_carregamento, dias: 10,
      instancias: (p, h, ctx) => (ctx.fase(p) === 'FINALIZADO') ? um(temCustosReais(p)) : [] },
    // A36 (14/10/2026): trava de validação antes de Finalizado. Nasce quando
    // o processo está pronto pra finalizar (devolveu o vazio / LCL carregou)
    // mas ainda não foi validado por quem está em Listas → "Aprovação por
    // etapa". Processos finalizados antes da trava (fase gravada) não geram.
    A36: { auto: true, como: 'Botão "Validar e finalizar" no processo (Aprovação por etapa)',
      base: p => p.data_devolucao_vazio || p.data_carregamento, dias: 2,
      instancias: (p, h, ctx) => (p.data_devolucao_vazio || p.data_carregamento) && p.fase !== 'FINALIZADO' && ctx.fase(p) !== 'FINALIZADO' ? um(tem(p.finalizacao_validada_em)) : [] },
    A32: { auto: true, como: 'Processo marcado como Fechado', semAcomp: true,
      base: p => p.data_devolucao_vazio || p.data_carregamento, dias: 15,
      instancias: (p, h, ctx) => (ctx.fase(p) === 'FINALIZADO' && temCustosReais(p)) ? um(!!p.fechado) : [] },
  };
  // Câmbio (A06/A13/A15): uma tarefa por parcela, conforme o nome da parcela.
  ['A06', 'A13', 'A15'].forEach(cod => {
    ATIVIDADES[cod] = { auto: true, como: 'Câmbio fechado (taxa) registrado na parcela', semAcomp: true,
      instancias: (p, h, ctx) => pagamentosDe(p, ctx).filter(pg => grupoParcela(pg) === cod && pg.parcela !== 'indefinido').map(pg => ({
        chave: String(pg.parcela), detalhe: nomeParcela(pg), prazo: iso(pg.vencimento), feito: !!pg.pago })) };
  });
  // Recorrentes (não são de um processo).
  const RECORRENTES = {
    A33: { como: 'Manual (Controle Cambial → Exportar Pendências de DI)', periodo: 'mes', diaPrazo: 5 },
    A34: { como: 'Manual (tela Averbação Seguro)', periodo: 'mes', diaPrazo: 5 },
    A35: { como: 'Manual (tela Reciclagem)', periodo: 'trimestre', diaPrazo: 15 },
  };

  // ── configuração (Listas) ────────────────────────────────────────────
  function padroes() {
    const LP = (typeof window !== 'undefined' && window.ListasPadrao) || (typeof require === 'function' ? require('./listas-padrao.js') : null);
    return LP ? LP.listasPadrao() : { agenda_funcao: [], agenda_atividade: [] };
  }
  const splitLogins = s => String(s || '').split(/[,;\n]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
  function montarConfig(listas) {
    const pad = padroes();
    const porCod = (arrPad, arrDb) => {
      const m = {};
      (arrPad || []).forEach(x => { m[x.codigo] = x; });
      (arrDb || []).forEach(x => { if (x && x.codigo) m[x.codigo] = Object.assign({}, m[x.codigo] || {}, x, { dados: Object.assign({}, (m[x.codigo] || {}).dados || {}, x.dados || {}) }); });
      return m;
    };
    const fun = porCod(pad.agenda_funcao, listas && listas.agenda_funcao);
    const atv = porCod(pad.agenda_atividade, listas && listas.agenda_atividade);
    const funcoes = {};
    Object.keys(fun).forEach(c => { const f = fun[c]; funcoes[c] = { codigo: c, nome: f.nome || c, usuarios: splitLogins(f.dados.usuarios), substitutos: splitLogins(f.dados.substitutos), ativo: f.ativo !== false }; });
    const atividades = {};
    Object.keys(atv).forEach(c => {
      const a = atv[c], d = a.dados || {};
      const pd = d.prazo_dias === '' || d.prazo_dias == null ? null : parseInt(d.prazo_dias, 10);
      atividades[c] = { codigo: c, nome: a.nome, etapa: d.etapa || '', funcao: d.funcao || '', prioridade: d.prioridade || 'MEDIA', prazoDias: isNaN(pd) ? null : pd, ativo: a.ativo !== false, ordem: a.ordem || 0, observacao: d.observacao || '' };
    });
    return { funcoes, atividades };
  }
  function funcoesDoUsuario(cfg, login) {
    const l = String(login || '').toLowerCase();
    return Object.values(cfg.funcoes).filter(f => f.ativo && (f.usuarios.includes(l) || f.substitutos.includes(l))).map(f => f.codigo);
  }

  // ── geração ──────────────────────────────────────────────────────────
  // opts: { hoje, listas, conclusoes:[{chave,tipo,usuario,em,obs}], fase(p), listarPagamentosPI, incluirFeitas, corte }
  function chaveTarefa(codigo, procId, inst) { return [codigo, procId || '-', inst || ''].join('|'); }
  function gerarTarefas(processos, opts) {
    opts = opts || {};
    const hoje = iso(opts.hoje) || fmt(new Date());
    const corte = iso(opts.corte) || AGENDA_CORTE;
    const cfg = opts.cfg || montarConfig(opts.listas);
    const concl = {};
    (opts.conclusoes || []).forEach(c => { if (c && c.chave) concl[c.chave] = c; });
    const ctx = { fase: opts.fase || (p => p.fase || ''), listarPagamentosPI: opts.listarPagamentosPI };
    const out = [];
    const push = (codigo, p, inst, base) => {
      const a = cfg.atividades[codigo]; if (!a || !a.ativo) return;
      const def = ATIVIDADES[codigo] || RECORRENTES[codigo] || {};
      const chave = chaveTarefa(codigo, p && p.id, inst.chave);
      const c = concl[chave];
      const status = inst.feito ? 'feita' : (c ? (c.tipo === 'nao_aplica' ? 'nao_aplica' : 'feita') : 'aberta');
      const prazo = iso(inst.prazo);
      if (prazo && prazo < corte && status === 'aberta') return; // histórico
      // Sem prazo calculável: só entra se o processo é recente (senão é histórico).
      if (!prazo && p && status === 'aberta' && (!iso(p.created_at) || iso(p.created_at) < corte) && !(iso(p.pi_data) >= corte)) return;
      if (status !== 'aberta' && !opts.incluirFeitas) return;
      const f = cfg.funcoes[a.funcao] || { nome: a.funcao, usuarios: [], substitutos: [] };
      out.push({
        chave, codigo, nome: a.nome, etapa: a.etapa, funcao: a.funcao, funcaoNome: f.nome,
        responsaveis: f.usuarios, substitutos: f.substitutos, prioridade: a.prioridade,
        processoId: p ? p.id : null, referencia: p ? p.referencia : null, cliente: p ? p.cliente : null,
        detalhe: inst.detalhe || '', prazo, atraso: prazo ? diasEntre(prazo, hoje) : null,
        auto: def.auto !== false && !RECORRENTES[codigo], como: def.como || '',
        status, conclusao: c || null, automatica: !!inst.feito,
      });
    };
    (processos || []).forEach(p => {
      if (!p || p.cancelado || p.fechado && !opts.incluirFeitas) return;
      Object.keys(ATIVIDADES).forEach(codigo => {
        const def = ATIVIDADES[codigo];
        if (def.semAcomp && ehAcomp(p)) return;
        if (def.aplica && !def.aplica(p)) return;
        const a = cfg.atividades[codigo]; if (!a || !a.ativo) return;
        let insts = [];
        try { insts = def.instancias(p, hoje, ctx) || []; } catch (e) { insts = []; }
        insts.forEach(inst => {
          let prazo = inst.prazo;
          if (prazo === undefined && def.base) {
            const b = iso(def.base(p));
            const dias = a.prazoDias != null ? a.prazoDias : (def.dias || 0);
            prazo = b ? (def.uteis ? somaUteis(b, dias) : somaDias(b, dias)) : null;
          } else if (prazo && a.prazoDias != null && inst._baseParaOverride) {
            prazo = somaDias(inst._baseParaOverride, a.prazoDias);
          }
          push(codigo, p, Object.assign({}, inst, { prazo }), def);
        });
      });
    });
    // Recorrentes: mês/trimestre corrente (o anterior, se ainda não feito, também aparece).
    Object.keys(RECORRENTES).forEach(codigo => {
      const r = RECORRENTES[codigo]; const a = cfg.atividades[codigo]; if (!a || !a.ativo) return;
      const [y, m] = hoje.split('-').map(Number);
      const periodos = [];
      if (r.periodo === 'mes') {
        // tarefa do mês M (referente a M-1) vence no dia 5 de M
        [0, -1].forEach(k => { const d = new Date(y, m - 1 + k, 1); const ref = new Date(d.getFullYear(), d.getMonth() - 1, 1);
          periodos.push({ chave: `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}`, detalhe: 'Referente a ' + ref.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }), prazo: fmt(new Date(d.getFullYear(), d.getMonth(), r.diaPrazo, 12)) }); });
      } else {
        const tAtual = Math.floor((m - 1) / 3);
        [0, -1].forEach(k => { let t = tAtual - 1 + k, yy = y; while (t < 0) { t += 4; yy--; }
          const fimTri = new Date(yy, t * 3 + 3, 0, 12); const prazo = new Date(fimTri); prazo.setDate(prazo.getDate() + r.diaPrazo);
          periodos.push({ chave: `${yy}-T${t + 1}`, detalhe: `${t + 1}º trimestre de ${yy}`, prazo: fmt(prazo) }); });
      }
      periodos.forEach(per => push(codigo, null, Object.assign({ feito: false }, per)));
    });
    out.sort((x, y) => (x.prazo || '9999').localeCompare(y.prazo || '9999') || String(x.referencia || '').localeCompare(String(y.referencia || '')));
    return out;
  }
  function filtrarPorUsuario(tarefas, cfg, login) {
    const fs = funcoesDoUsuario(cfg, login);
    return tarefas.filter(t => fs.includes(t.funcao));
  }
  function classificar(t, hoje) {
    if (t.status !== 'aberta') return 'concluida';
    if (!t.prazo) return 'sem_prazo';
    if (t.prazo < hoje) return 'atrasada';
    if (t.prazo === hoje) return 'hoje';
    if (diasEntre(hoje, t.prazo) <= 7) return 'semana';
    return 'futura';
  }

  const AgendaCore = { AGENDA_CORTE, ATIVIDADES, RECORRENTES, gerarTarefas, montarConfig, funcoesDoUsuario, filtrarPorUsuario, classificar, chaveTarefa, somaUteis, somaDias };
  if (typeof module !== 'undefined' && module.exports) module.exports = AgendaCore;
  if (typeof window !== 'undefined') window.AgendaCore = AgendaCore;
})();
