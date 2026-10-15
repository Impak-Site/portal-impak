// assistente.js — o Assistente do ImpakOS (chat com ferramentas), 14/10/2026.
//
// Como funciona (pedido Ayslan: "sem token na base de dados"):
//   A IA NUNCA recebe a chave do banco nem os dados inteiros. Ela recebe só
//   a lista de FERRAMENTAS que o usuário logado pode usar (filtrada pelos
//   módulos da sessão — igual às telas) e pede "rode a ferramenta X com estes
//   filtros". Quem executa é este servidor, com a sessão do usuário, e devolve
//   só o resultado daquela consulta. Quem não tem Financeiro/Resultado nem vê
//   que a ferramenta de faturamento existe.
//
//   A única credencial envolvida é ANTHROPIC_API_KEY, que já era variável de
//   ambiente no Railway (não fica no banco nem no repositório).
//
// Uso (server.js):
//   const Assistente = require('./assistente.js');
//   Assistente.responder({ sessao, mensagens, ctx: { sb, carregarListas, log } })
//     → { texto, ferramentas: [{nome, input, resumo}], tokens }
const AgendaServidor = require('./agenda-servidor.js');

// 15/10/2026 (pedido Ayslan): Sonnet 5.5 — mais novo e ~33% mais barato
// (US$ 2 / US$ 10 por milhão). Se a API recusar o modelo, cai no anterior.
const MODELO = 'claude-sonnet-5-5';
const MODELO_RESERVA = 'claude-sonnet-4-6';
const MAX_RODADAS = 6;        // no máximo N chamadas de ferramenta por pergunta
const MAX_LINHAS = 60;        // linhas por resultado (a IA pede mais filtro se precisar)

// ── util ──────────────────────────────────────────────────────────────
const hojeISO = () => AgendaServidor.hojeISO();
function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim(); }
function num(v) { const n = parseFloat(v); return isNaN(n) ? null : n; }
function parseJson(v, dflt) { if (!v) return dflt; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch (e) { return dflt; } }
function dataOk(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
function temModulo(sessao, ...mods) { const m = (sessao && sessao.modulos) || []; return mods.some(x => m.includes(x)); }
function ehGerente(sessao) { return sessao && (sessao.role === 'gerente' || sessao.role === 'dono'); }

// Campos "públicos" de um processo (sem nada financeiro) — o que Operacional/
// Comercial já vê na tabela do Controle.
function resumoProcesso(p, fase) {
  return {
    referencia: p.referencia, cliente: p.cliente || null, fornecedor: p.fornecedor || null, marca: p.brand || null,
    fase: fase || p.fase || null, finalidade: p.finalidade || null,
    porto_destino: p.porto_destino || null, porto_origem: p.porto_origem || null, navio: p.navio || null,
    qtd_containers: p.qtd_containers_prevista || null, tipo_container: p.tipo_container || null,
    data_prontidao: p.data_prontidao || null, data_embarque: p.data_embarque || null, eta: p.eta || null,
    data_chegada: p.data_chegada || null, data_registro_di: p.data_registro_di || null,
    data_liberacao: p.data_liberacao || null, data_carregamento: p.data_carregamento || null,
    data_devolucao_vazio: p.data_devolucao_vazio || null, demurrage_vencimento: p.demurrage_vencimento || null,
  };
}
function filtrar(lista, f) {
  let r = lista;
  if (f.cliente) { const c = norm(f.cliente); r = r.filter(p => norm(p.cliente).includes(c) || (parseJson(p.vendas_json, []) || []).some(v => norm(v.cliente).includes(c))); }
  if (f.fornecedor) { const c = norm(f.fornecedor); r = r.filter(p => norm(p.fornecedor).includes(c) || norm(p.brand).includes(c)); }
  if (f.porto) { const c = norm(f.porto); r = r.filter(p => norm(p.porto_destino).includes(c)); }
  if (f.texto) { const c = norm(f.texto); r = r.filter(p => norm(p.referencia).includes(c) || norm(p.cliente).includes(c) || norm(p.fornecedor).includes(c) || norm(p.navio).includes(c) || norm(p.container).includes(c)); }
  return r;
}

// ── ferramentas ───────────────────────────────────────────────────────
// Cada ferramenta: { nome, modulos (quem pode), descricao, schema, executar(input, ctx) }
// ctx = { sb, sessao, motor, processos() (cache por pergunta), listas() }
const FERRAMENTAS = [
  {
    nome: 'buscar_processos',
    modulos: ['controle', 'conferencia', 'financeiro', 'resultado', 'narcelio', 'cambio', 'analises', 'tyredesk'],
    descricao: 'Lista processos de importação (embarques) com filtros. Use pra "quais processos do cliente X", "o que está em águas", "processos atrasados", "processos no porto Y". Devolve referência, cliente, fornecedor, fase, datas (embarque/ETA/chegada/liberação/carregamento) e porto. Fases: PI_RECEBIDA, AG_EMBARQUE, EMBARCADO, CHEGOU, DESEMBARACADO, LIBERADO, CARREGADO, FINALIZADO, CANCELADO.',
    schema: { type: 'object', properties: {
      cliente: { type: 'string', description: 'Parte do nome do cliente' },
      fornecedor: { type: 'string', description: 'Parte do nome do fornecedor ou da marca' },
      porto: { type: 'string', description: 'Porto de destino (ITJ, NVT, IOA, BRIBB...)' },
      fase: { type: 'string', description: 'Fase exata ou "ATIVOS" (tudo que não é FINALIZADO/CANCELADO)' },
      texto: { type: 'string', description: 'Busca livre em referência/cliente/fornecedor/navio/container' },
      eta_de: { type: 'string', description: 'ETA a partir de (AAAA-MM-DD)' }, eta_ate: { type: 'string', description: 'ETA até (AAAA-MM-DD)' },
      limite: { type: 'integer', description: 'Máximo de linhas (padrão 40, máx 60)' },
    } },
    async executar(input, ctx) {
      let r = filtrar(await ctx.processos(), input);
      if (input.fase) {
        const f = norm(input.fase);
        r = f === 'ATIVOS' ? r.filter(p => !['FINALIZADO', 'CANCELADO'].includes(p._fase)) : r.filter(p => p._fase === f);
      }
      if (dataOk(input.eta_de)) r = r.filter(p => p.eta && p.eta >= input.eta_de);
      if (dataOk(input.eta_ate)) r = r.filter(p => p.eta && p.eta <= input.eta_ate);
      const total = r.length;
      const lim = Math.min(MAX_LINHAS, parseInt(input.limite, 10) || 40);
      return { total, mostrando: Math.min(total, lim), processos: r.slice(0, lim).map(p => resumoProcesso(p, p._fase)) };
    },
  },
  {
    nome: 'detalhe_processo',
    modulos: ['controle', 'conferencia', 'financeiro', 'resultado', 'narcelio', 'cambio', 'analises', 'tyredesk'],
    descricao: 'Detalhe completo de UM processo pela referência: datas, containers, documentos (CI/PL/BL), demurrage, vendas (clientes e NFs de saída, sem valores se o usuário não tiver Financeiro), pagamentos ao fornecedor (só com Financeiro/Câmbio).',
    schema: { type: 'object', properties: { referencia: { type: 'string' } }, required: ['referencia'] },
    async executar(input, ctx) {
      const ref = norm(input.referencia);
      const p = (await ctx.processos()).find(x => norm(x.referencia) === ref) || (await ctx.processos()).find(x => norm(x.referencia).includes(ref));
      if (!p) return { erro: 'Processo não encontrado: ' + input.referencia };
      const podeFin = temModulo(ctx.sessao, 'financeiro', 'resultado', 'narcelio', 'cambio');
      const vendas = (parseJson(p.vendas_json, []) || []).map(v => ({ cliente: v.cliente, nf_numero: v.nf_saida_numero || null, nf_data: v.nf_saida_data || null,
        nf_valor: podeFin ? num(v.nf_saida_valor) : undefined, itens: (v.itens || []).map(i => ({ descricao: i.descricao, quantidade: i.quantidade })) }));
      const out = Object.assign(resumoProcesso(p, p._fase), {
        container: p.container || null, containers: (parseJson(p.containers_json, []) || []).map(c => ({ numero: c.numero || c.container, devolucao: c.data_devolucao_vazio || null })),
        numero_ci: p.numero_ci || null, numero_bl: p.numero_bl || null, numero_di: p.numero_di || p.numero_duimp || null, armador: p.armador || null,
        demurrage_dias_livres: p.demurrage_dias_livres || null, free_time_armazenagem_vencimento: p.armazenagem_vencimento || null,
        vendas, observacoes: p.observacoes || null,
      });
      if (podeFin && ctx.motor) {
        try {
          const pg = ctx.motor.listarPagamentosPI(p) || [];
          out.pagamentos_fornecedor = pg.map(x => ({ etapa: x.label || x.etapa, valor_usd: num(x.valorUsd || x.valor_usd), vencimento: x.vencimento || x.data_vencimento || null, pago: !!(x.pago || x.cambio), cambio: num(x.cambio) }));
        } catch (e) { out.pagamentos_fornecedor = 'indisponível: ' + e.message; }
      }
      return out;
    },
  },
  {
    nome: 'chegadas_por_periodo',
    modulos: ['controle', 'conferencia', 'financeiro', 'resultado', 'narcelio', 'cambio', 'analises'],
    descricao: 'Processos com chegada (ETA ou data de chegada) num período, agrupados por porto e cliente. Use pra "o que chega este mês/próximo mês". Sem datas = mês atual e o próximo.',
    schema: { type: 'object', properties: { de: { type: 'string', description: 'AAAA-MM-DD' }, ate: { type: 'string', description: 'AAAA-MM-DD' } } },
    async executar(input, ctx) {
      const hoje = hojeISO();
      const de = dataOk(input.de) ? input.de : hoje.slice(0, 8) + '01';
      let ate = input.ate;
      if (!dataOk(ate)) { const d = new Date(de + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 2); d.setUTCDate(0); ate = d.toISOString().slice(0, 10); }
      const r = (await ctx.processos()).filter(p => !['FINALIZADO', 'CANCELADO'].includes(p._fase)).map(p => ({ p, dt: p.data_chegada || p.eta })).filter(x => x.dt && x.dt >= de && x.dt <= ate);
      const porPorto = {};
      r.forEach(({ p, dt }) => { const k = p.porto_destino || '(sem porto)'; (porPorto[k] = porPorto[k] || []).push({ referencia: p.referencia, cliente: p.cliente, fornecedor: p.fornecedor, data: dt, chegou: !!p.data_chegada, containers: p.qtd_containers_prevista || null, fase: p._fase }); });
      Object.values(porPorto).forEach(l => l.sort((a, b) => a.data.localeCompare(b.data)));
      // Totais já contados aqui (por porto e por cliente) pra IA não estimar
      // ("~47") contando linha a linha — 15/10/2026.
      const porCliente = {}, totalPorPorto = {};
      r.forEach(({ p }) => { const c = p.cliente || '(sem cliente)'; porCliente[c] = (porCliente[c] || 0) + 1; const k = p.porto_destino || '(sem porto)'; totalPorPorto[k] = (totalPorPorto[k] || 0) + 1; });
      const totais_por_cliente = Object.entries(porCliente).sort((a, b) => b[1] - a[1]).map(([cliente, processos]) => ({ cliente, processos }));
      return { periodo: { de, ate }, total: r.length, containers_total: r.reduce((s, x) => s + (parseInt(x.p.qtd_containers_prevista, 10) || 0), 0), totais_por_porto: totalPorPorto, totais_por_cliente, por_porto: porPorto, aviso: 'Use os totais exatos de totais_por_cliente/totais_por_porto; não estime.' };
    },
  },
  {
    nome: 'listar_clientes',
    modulos: ['cadastros', 'controle', 'tyredesk', 'financeiro', 'resultado', 'narcelio', 'analises'],
    descricao: 'Lista empresas do cadastro (clientes, fornecedores, despachantes...) com filtro por UF, cidade, papel ou nome. Devolve razão social, UF, cidade, papéis e quantos processos cada uma tem.',
    schema: { type: 'object', properties: { uf: { type: 'string', description: 'Sigla da UF (SC, SP...)' }, texto: { type: 'string' }, papel: { type: 'string', description: 'cliente | fornecedor | despachante | agente | transportadora | armador' }, limite: { type: 'integer' } } },
    async executar(input, ctx) {
      const { data, error } = await ctx.sb().from('contatos_clientes').select('id,razao_social,nome_fantasia,uf,cidade,pais,papeis,ativo').limit(2000);
      if (error) return { erro: error.message };
      let r = (data || []).filter(c => c.ativo !== false);
      if (input.uf) r = r.filter(c => norm(c.uf) === norm(input.uf));
      if (input.texto) { const t = norm(input.texto); r = r.filter(c => norm(c.razao_social).includes(t) || norm(c.nome_fantasia).includes(t) || norm(c.cidade).includes(t)); }
      if (input.papel) { const t = norm(input.papel); r = r.filter(c => (c.papeis || []).some(x => norm(x).includes(t))); }
      const procs = await ctx.processos();
      const contagem = {}; procs.forEach(p => { [p.cliente_id, p.fornecedor_id].forEach(id => { if (id) contagem[id] = (contagem[id] || 0) + 1; }); });
      const lim = Math.min(MAX_LINHAS, parseInt(input.limite, 10) || 40);
      r.sort((a, b) => (contagem[b.id] || 0) - (contagem[a.id] || 0) || String(a.razao_social).localeCompare(b.razao_social));
      return { total: r.length, mostrando: Math.min(r.length, lim), empresas: r.slice(0, lim).map(c => ({ razao_social: c.razao_social, nome_fantasia: c.nome_fantasia || null, uf: c.uf || null, cidade: c.cidade || null, pais: c.pais || null, papeis: c.papeis || [], processos: contagem[c.id] || 0 })) };
    },
  },
  {
    nome: 'faturamento',
    modulos: ['financeiro', 'resultado', 'narcelio'],
    descricao: 'Faturamento (NFs de saída emitidas) num período, agrupado por cliente ou por mês, e o lucro real dos processos quando já apurado. Use pra "quanto faturamos no mês passado", "melhor cliente", "margem por cliente". Datas pela NF de saída (ou liberação, quando a NF não tem data).',
    schema: { type: 'object', properties: { de: { type: 'string', description: 'AAAA-MM-DD' }, ate: { type: 'string', description: 'AAAA-MM-DD' }, agrupar: { type: 'string', description: 'cliente | mes | processo (padrão cliente)' } } },
    async executar(input, ctx) {
      const hoje = hojeISO();
      const de = dataOk(input.de) ? input.de : (hoje.slice(0, 4) + '-01-01');
      const ate = dataOk(input.ate) ? input.ate : hoje;
      const grupos = {}; let totalNf = 0, totalLucro = 0, nLucro = 0;
      for (const p of await ctx.processos()) {
        if (p._fase === 'CANCELADO') continue;
        const vendas = parseJson(p.vendas_json, []) || [];
        const linhas = vendas.length ? vendas.map(v => ({ cliente: v.cliente || p.cliente, data: v.nf_saida_data || p.nf_saida_data || p.data_liberacao, valor: num(v.nf_saida_valor) }))
          : [{ cliente: p.cliente, data: p.nf_saida_data || p.data_liberacao, valor: num(p.nf_saida_valor) }];
        let fch = null;
        try { fch = ctx.motor ? ctx.motor.calcularFechamento(p) : null; } catch (e) { fch = null; }
        const lucro = fch && fch.temReal && fch.lucroReal != null ? fch.lucroReal : null;
        const somaNf = linhas.reduce((s, l) => s + (l.valor || 0), 0);
        linhas.forEach(l => {
          if (!l.valor || !l.data || l.data < de || l.data > ate) return;
          const chave = (input.agrupar === 'mes') ? String(l.data).slice(0, 7) : (input.agrupar === 'processo') ? p.referencia : (l.cliente || '(sem cliente)');
          const g = grupos[chave] = grupos[chave] || { faturamento: 0, processos: new Set(), lucro_real: 0, processos_com_lucro: 0 };
          g.faturamento += l.valor; g.processos.add(p.referencia); totalNf += l.valor;
          if (lucro != null && somaNf > 0) { const fatia = lucro * (l.valor / somaNf); g.lucro_real += fatia; g.processos_com_lucro++; totalLucro += fatia; nLucro++; }
        });
      }
      const lista = Object.entries(grupos).map(([k, g]) => ({ grupo: k, faturamento: Math.round(g.faturamento * 100) / 100, processos: g.processos.size, lucro_real: g.processos_com_lucro ? Math.round(g.lucro_real * 100) / 100 : null, margem_pct: g.processos_com_lucro && g.faturamento ? Math.round(10000 * g.lucro_real / g.faturamento) / 100 : null }))
        .sort((a, b) => b.faturamento - a.faturamento);
      return { periodo: { de, ate }, agrupado_por: input.agrupar || 'cliente', total_faturamento: Math.round(totalNf * 100) / 100, total_lucro_real_apurado: nLucro ? Math.round(totalLucro * 100) / 100 : null, grupos: lista.slice(0, MAX_LINHAS), observacao: 'lucro_real só existe nos processos com Custos Reais/Fechamento lançados; null = ainda não apurado.' };
    },
  },
  {
    nome: 'resultado_processo',
    modulos: ['resultado', 'narcelio', 'financeiro'],
    descricao: 'Fechamento de um processo: custo estimado x real, NF de saída, lucro real e margem %, e as linhas de custo real (adiantamento porto, ICMS ST, comissões, etc.).',
    schema: { type: 'object', properties: { referencia: { type: 'string' } }, required: ['referencia'] },
    async executar(input, ctx) {
      const ref = norm(input.referencia);
      const p = (await ctx.processos()).find(x => norm(x.referencia) === ref);
      if (!p) return { erro: 'Processo não encontrado: ' + input.referencia };
      if (!ctx.motor) return { erro: 'motor de cálculo indisponível' };
      const f = ctx.motor.calcularFechamento(p);
      const r2 = v => v == null || isNaN(v) ? null : Math.round(v * 100) / 100;
      return { referencia: p.referencia, cliente: p.cliente, fase: p._fase,
        estimado: { custo: r2(f.custoEstimado), faturamento: r2(f.faturamentoEstimado), lucro: r2(f.lucroEstimado), pct: r2((f.pctLucroEstimado || 0) * 100) },
        real: { nf_entrada: r2(f.nfEntrada), nf_saida: r2(f.nfSaida), custo_real_total: r2(f.custoRealTotal), lucro_real: r2(f.lucroReal), pct: r2((f.pctLucroReal || 0) * 100), apurado: !!f.temReal },
        custos_reais: f.custosReais && f.custosReais.itens ? f.custosReais.itens.filter(i => i.valor).map(i => ({ item: i.label, valor: r2(i.valor) })) : undefined };
    },
  },
  {
    nome: 'agenda_pendencias',
    modulos: ['controle', 'conferencia'],
    descricao: 'Tarefas da Agenda de atividades: o que está atrasado, vence hoje ou nos próximos dias, por pessoa/função. Analistas só veem as próprias tarefas; gerentes veem a equipe toda.',
    schema: { type: 'object', properties: { pessoa: { type: 'string', description: 'Login da pessoa (gerentes). Vazio = todas' }, status: { type: 'string', description: 'atrasada | hoje | proximos | todas (padrão: atrasada+hoje)' }, limite: { type: 'integer' } } },
    async executar(input, ctx) {
      const AgendaCore = require('./agenda-core.js');
      const { hoje, cfg, tarefas } = await AgendaServidor.gerarTarefas({ sb: ctx.sb, carregarListas: ctx.carregarListas });
      let abertas = tarefas.filter(t => t.status === 'aberta');
      const login = String(ctx.sessao.usuario || '').toLowerCase();
      if (!ehGerente(ctx.sessao)) { const fs = AgendaCore.funcoesDoUsuario(cfg, login); abertas = abertas.filter(t => fs.includes(t.funcao)); }
      else if (input.pessoa) { const fs = AgendaCore.funcoesDoUsuario(cfg, String(input.pessoa).toLowerCase()); abertas = abertas.filter(t => fs.includes(t.funcao)); }
      const st = input.status || 'atrasada+hoje';
      abertas = abertas.map(t => Object.assign({ _cls: AgendaCore.classificar(t, hoje) }, t)).filter(t => st === 'todas' || st.includes(t._cls) || (st === 'proximos' && t._cls !== 'atrasada'));
      abertas.sort((a, b) => (b.atraso || 0) - (a.atraso || 0));
      const lim = Math.min(MAX_LINHAS, parseInt(input.limite, 10) || 40);
      return { hoje, total: abertas.length, tarefas: abertas.slice(0, lim).map(t => ({ processo: t.referencia, atividade: t.nome, funcao: t.funcaoNome || t.funcao, responsaveis: t.responsaveis || [], prazo: t.prazo, situacao: t._cls, dias_atraso: t.atraso || 0 })) };
    },
  },
  {
    nome: 'pagamentos_previstos',
    modulos: ['financeiro', 'cambio', 'narcelio'],
    descricao: 'Pagamentos a fornecedor (parcelas da PI: entrada/saldo/parcelado) previstos ou vencidos num horizonte de dias, com câmbio fechado ou em aberto. Use pra "o que vence esta semana", "quanto precisamos de dólar".',
    schema: { type: 'object', properties: { dias: { type: 'integer', description: 'Horizonte em dias a partir de hoje (padrão 30)' }, incluir_pagos: { type: 'boolean' } } },
    async executar(input, ctx) {
      if (!ctx.motor) return { erro: 'motor de cálculo indisponível' };
      const hoje = hojeISO(); const d = new Date(hoje + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + (parseInt(input.dias, 10) || 30)); const ate = d.toISOString().slice(0, 10);
      const out = [];
      for (const p of await ctx.processos()) {
        if (['FINALIZADO', 'CANCELADO'].includes(p._fase)) continue;
        let pg = []; try { pg = ctx.motor.listarPagamentosPI(p) || []; } catch (e) { continue; }
        pg.forEach(x => {
          const venc = x.vencimento || x.data_vencimento || null; const pago = !!(x.pago || x.cambio);
          if (pago && !input.incluir_pagos) return;
          if (venc && venc > ate) return;
          out.push({ processo: p.referencia, cliente: p.cliente, fornecedor: p.fornecedor, etapa: x.label || x.etapa, valor_usd: num(x.valorUsd || x.valor_usd), vencimento: venc, vencido: !!(venc && venc < hoje && !pago), cambio_fechado: num(x.cambio) || null });
        });
      }
      out.sort((a, b) => String(a.vencimento || '9').localeCompare(String(b.vencimento || '9')));
      return { hoje, ate, total: out.length, total_usd: Math.round(out.reduce((s, x) => s + (x.valor_usd || 0), 0) * 100) / 100, pagamentos: out.slice(0, MAX_LINHAS) };
    },
  },
];

function ferramentasPara(sessao) {
  return FERRAMENTAS.filter(f => temModulo(sessao, ...f.modulos));
}

// ── chamada à API (com retry nos erros transitórios) ──────────────────
async function chamarAnthropic(body, apiKey) {
  const RETRY = [429, 500, 502, 503, 529];
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), 40000);
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(body),
      });
      clearTimeout(to);
      if (RETRY.includes(resp.status) && tentativa < 3) { await new Promise(r => setTimeout(r, 1000 * tentativa)); continue; }
      const data = await resp.json();
      if (data.error && body.model !== MODELO_RESERVA && /model/i.test(data.error.message || '') && (resp.status === 404 || resp.status === 400)) {
        console.warn('[assistente] modelo ' + body.model + ' recusado (' + data.error.message + '); usando ' + MODELO_RESERVA);
        body = Object.assign({}, body, { model: MODELO_RESERVA }); tentativa--; continue;
      }
      if (data.error) throw new Error(data.error.message || 'erro da API');
      return data;
    } catch (e) {
      clearTimeout(to);
      if (e.name === 'AbortError' && tentativa < 3) continue;
      throw e;
    }
  }
  throw new Error('API indisponível');
}

function systemPrompt(sessao, ferramentas) {
  const nome = sessao.displayName || sessao.nome || sessao.usuario;
  return `Você é o Assistente do ImpakOS, o sistema interno da IMPAK (importadora de pneus, SC). Responde em português do Brasil, direto e objetivo, como um colega experiente de operação/financeiro.

Hoje é ${hojeISO()}. Usuário: ${nome} (login ${sessao.usuario}, papel ${sessao.role || 'analista'}).
Módulos liberados: ${(sessao.modulos || []).join(', ') || 'nenhum'}.

REGRAS
- Você só sabe o que as ferramentas devolvem. Nunca invente processo, valor, data ou cliente. Se a ferramenta não trouxe, diga que não encontrou.
- Use as ferramentas sempre que a pergunta envolver dados; combine mais de uma se precisar (ex.: buscar_processos e depois detalhe_processo).
- Se a pergunta pede algo que exige um módulo que o usuário não tem (você não vê a ferramenta), diga que esse dado não está liberado para o perfil dele — não tente deduzir.
- Formato: respostas curtas. Listas de processos em tabela Markdown (Referência | Cliente | Fase | Data...). Valores em R$ com separador brasileiro (R$ 12.345,67) e US$ em dólar. Datas em dd/mm/aaaa.
- Quando houver muitos resultados, resuma (totais por porto/cliente) e ofereça detalhar.
- Contagens e totais sempre exatos, como vieram da ferramenta. Nunca use "~", "cerca de" ou estimativa em número de processos/containers/valores.
- A conversa tem histórico: use as mensagens anteriores como contexto (ex.: "e desse porto?" se refere ao porto citado antes).
- Nunca mostre percentuais de comissão de vendedores nem nomes de comissionados.
- Ferramentas disponíveis para este usuário: ${ferramentas.map(f => f.nome).join(', ')}.`;
}

// mensagens: [{role:'user'|'assistant', content: string}] (histórico simples, texto)
async function responder({ sessao, mensagens, ctx }) {
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada no servidor');
  const ferramentas = ferramentasPara(sessao);
  const tools = ferramentas.map(f => ({ name: f.nome, description: f.descricao, input_schema: f.schema }));

  // Cache por pergunta: os processos são lidos uma vez só, com a fase calculada
  // pelo mesmo motor do Controle (calcularFase), pra todas as ferramentas.
  let _procs = null;
  const motor = AgendaServidor.carregarMotor();
  const ctxFerr = {
    sb: ctx.sb, sessao, motor, carregarListas: ctx.carregarListas,
    processos: async () => {
      if (_procs) return _procs;
      const { data, error } = await ctx.sb().from('controle_processos').select('*').order('updated_at', { ascending: false });
      if (error) throw new Error(error.message);
      _procs = (data || []).map(p => { let f = p.fase; try { f = motor ? motor.calcularFase(p) : p.fase; } catch (e) {} return Object.assign({ _fase: f }, p); });
      return _procs;
    },
  };

  const msgs = (mensagens || []).slice(-20).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') }));
  const usadas = []; let tokens = 0; let texto = '';
  for (let rodada = 0; rodada <= MAX_RODADAS; rodada++) {
    const data = await chamarAnthropic({ model: MODELO, max_tokens: 2000, system: systemPrompt(sessao, ferramentas), tools, messages: msgs }, apiKey);
    tokens += ((data.usage || {}).input_tokens || 0) + ((data.usage || {}).output_tokens || 0);
    const blocos = data.content || [];
    const usos = blocos.filter(b => b.type === 'tool_use');
    texto = blocos.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if (!usos.length || data.stop_reason !== 'tool_use') break;
    msgs.push({ role: 'assistant', content: blocos });
    const resultados = [];
    for (const u of usos) {
      const f = ferramentas.find(x => x.nome === u.name);
      let saida;
      if (!f) saida = { erro: 'ferramenta não disponível para este usuário' };
      else { try { saida = await f.executar(u.input || {}, ctxFerr); } catch (e) { saida = { erro: e.message }; } }
      const json = JSON.stringify(saida);
      usadas.push({ nome: u.name, input: u.input, resumo: saida && saida.total != null ? `${saida.total} resultado(s)` : (saida && saida.erro ? 'erro: ' + saida.erro : 'ok') });
      resultados.push({ type: 'tool_result', tool_use_id: u.id, content: json.length > 60000 ? json.slice(0, 60000) + '…(cortado)' : json });
    }
    msgs.push({ role: 'user', content: resultados });
    if (rodada === MAX_RODADAS) texto = texto || 'Precisei de muitas consultas e parei antes de concluir. Tente uma pergunta mais específica.';
  }
  if (ctx.log) ctx.log(`[assistente] ${sessao.usuario}: ${usadas.map(u => u.nome).join(',') || 'sem ferramenta'} | ${tokens} tokens`);
  return { texto: texto || 'Não consegui montar uma resposta.', ferramentas: usadas, tokens };
}

module.exports = { responder, ferramentasPara, FERRAMENTAS, systemPrompt, resumoProcesso, filtrar };
