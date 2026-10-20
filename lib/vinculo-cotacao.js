'use strict';
/**
 * REGRA ÚNICA DO VÍNCULO COTAÇÃO ↔ PROCESSO
 * ════════════════════════════════════════════════════════════════
 * Pedido do Ayslan (20/10/2026): "o vínculo e tudo mais tem que ficar tudo
 * de acordo processo x calculador e calculador x processo". Antes cada rota
 * gravava um lado só (ou do seu jeito) e os dois lados se desencontravam:
 * cotação dizendo "aprovada, processo X" com o processo sem saber dela,
 * várias cotações apontando pro mesmo processo, cotação apontando pra
 * processo excluído. Todas as rotas agora decidem por estas funções puras
 * (sem banco — testadas em testes_aprovacao.js):
 *
 *  1. Uma cotação tem no máximo UM processo e um processo no máximo UMA
 *     cotação. O vínculo vale nos dois lados: processo.cotacao_id = id da
 *     cotação E cotação.resumo.processo_id = id do processo (com a
 *     referência).
 *  2. O vínculo nasce ao aprovar (cria o processo), ao vincular a um
 *     processo que já existe (Calculador, tela Cotações ou o próprio
 *     processo) e ao salvar a cotação criada a partir do processo. A
 *     cotação fica Aprovada (sai o motivo de perda) e o processo recebe a
 *     estimativa (o "cotado"), os comissionados (somam aos que já tinha) e,
 *     só se ainda não tiver Custos Reais, os valores "Cobrado" iniciais.
 *  3. Processo que já tem outra cotação não troca calado: o servidor recusa
 *     (409, dizendo qual é a atual) e só troca com "substituir"; a antiga
 *     volta a Rascunho com a nota de onde saiu.
 *  4. Salvar de novo uma cotação vinculada atualiza a estimativa do processo
 *     junto (fica no Histórico do processo). Processo fechado ou cancelado
 *     não muda: a cotação dele fica só leitura (para outra conta, Duplicar).
 *  5. Desvincular tira dos dois lados: a cotação volta a Rascunho e o
 *     processo perde a estimativa — Custos Reais ficam como estão.
 *  6. Cotação vinculada não pode ser rejeitada nem excluída (desvincule
 *     antes). Excluir o processo desvincula a cotação dele.
 *  7. "Simular venda no Calculador (dados reais)" não vincula: é simulação,
 *     salvar lá cria uma cotação separada.
 */

const { extrairEstimativa, gerarRealJsonInicial, CAMPOS_RESUMO_CICLO } = require('../mapeamento_cotacao_processo.js');

const r2 = v => (v === null || v === undefined || v === '' || !isFinite(Number(v))) ? null : Math.round(Number(v) * 100) / 100;

function processoIdDaCotacao(cot) {
  const r = cot && cot.resumo;
  return (r && r.processo_id) || null;
}

function cotacaoAtiva(cot) { return !!cot && cot.ativo !== false; }

// Processo fechado/cancelado não aceita mudança de vínculo nem de estimativa.
function bloqueioDoProcesso(proc) {
  if (!proc) return null;
  const ref = proc.referencia ? ' ' + proc.referencia : '';
  if (proc.fechado) return `O processo${ref} está fechado — reabra antes de mudar a cotação dele.`;
  if (proc.cancelado) return `O processo${ref} está cancelado — reative antes de mudar a cotação dele.`;
  return null;
}

function temCustosReais(realJson) {
  let rj = realJson;
  if (typeof rj === 'string') {
    const t = rj.trim();
    if (!t || t === 'null' || t === '{}') return false;
    try { rj = JSON.parse(t); } catch (e) { return true; }
  }
  return !!rj && typeof rj === 'object' && Object.keys(rj).some(k => k !== '_conf');
}

// Comissionados escolhidos no Calculador (dados.comissionados) → códigos
// limpos pra gravar em controle_processos.comissoes_json.selecionados.
function comissionadosDaCotacao(dados) {
  const l = dados && Array.isArray(dados.comissionados) ? dados.comissionados : [];
  return [...new Set(l.filter(x => typeof x === 'string').map(x => x.trim().toUpperCase().slice(0, 60)).filter(Boolean))].slice(0, 30);
}

// Soma os comissionados da cotação aos que o processo já tem (não apaga nada
// nem mexe nos pagamentos). null = nada a acrescentar.
function somarComissionados(atual, novos) {
  if (!novos || !novos.length) return null;
  const base = (atual && typeof atual === 'object' && !Array.isArray(atual)) ? atual : {};
  const sel = Array.isArray(base.selecionados) ? base.selecionados.map(x => String(x).toUpperCase()) : [];
  const juntos = [...new Set([...sel, ...novos])];
  if (juntos.length === sel.length) return null;
  return { ...base, selecionados: juntos, pagamentos: Array.isArray(base.pagamentos) ? base.pagamentos : [] };
}

function estimativasIguais(a, b) {
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const campos = ['custo_total', 'faturamento', 'lucro_bruto'];
  if (campos.every(k => r2(a[k]) === null && r2(b[k]) === null)) return false;
  return campos.every(k => r2(a[k]) === r2(b[k]));
}

function brl(v) {
  const n = r2(v);
  return n === null ? '—' : 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Texto curto da estimativa pro Histórico do processo.
function textoEstimativa(e) {
  if (!e || typeof e !== 'object' || !Object.keys(e).length) return '—';
  const pct = r2(e.pct_lucro) !== null ? ` (${Number(e.pct_lucro).toFixed(1).replace('.', ',')}%)` : '';
  return `custo ${brl(e.custo_total)} · faturamento ${brl(e.faturamento)} · lucro ${brl(e.lucro_bruto)}${pct}`;
}

function rotuloCotacao(cot) {
  if (!cot) return '—';
  const r = cot.resumo || {};
  const tipoUf = [r.tipo, r.uf].filter(Boolean).join('/');
  return `${cot.cliente || 'sem cliente'}${tipoUf ? ' · ' + tipoUf : ''} · ${String(cot.id || '').slice(0, 8)}`;
}

// Resumo da cotação depois de vinculada ao processo `proc`. Mantém a data de
// aprovação original quando já estava aprovada no mesmo processo.
function resumoVinculado(resumo, proc, opts) {
  const o = opts || {};
  const r = { ...(resumo || {}) };
  const jaEraDele = r.processo_id === proc.id && r.status === 'aprovada' && r.data_aprovacao;
  r.status = 'aprovada';
  r.processo_id = proc.id;
  r.processo_referencia = proc.referencia || null;
  if (!jaEraDele) { r.data_aprovacao = o.agora || new Date().toISOString(); r.aprovado_por = o.usuario || null; }
  ['motivo_perda', 'data_rejeicao', 'rejeitado_por', 'desvinculado_em', 'desvinculado_por', 'desvinculado_de', 'desvinculado_motivo']
    .forEach(k => { delete r[k]; });
  return r;
}

// Resumo da cotação depois de desvinculada: volta a Rascunho e guarda de onde saiu.
function resumoDesvinculado(resumo, opts) {
  const o = opts || {};
  const r = { ...(resumo || {}) };
  const de = o.referencia || r.processo_referencia || r.processo_id || '';
  ['status', 'processo_id', 'processo_referencia', 'data_aprovacao', 'aprovado_por'].forEach(k => { delete r[k]; });
  r.desvinculado_em = o.agora || new Date().toISOString();
  r.desvinculado_por = o.usuario || null;
  r.desvinculado_de = de;
  r.desvinculado_motivo = o.motivo || '';
  return r;
}

// O que o processo recebe da cotação. inicial=true no vínculo (cotacao_id e,
// sem Custos Reais, os "Cobrado" iniciais); false quando a cotação vinculada
// é salva de novo (só estimativa e comissionados).
function patchProcessoComCotacao(cot, proc, opts) {
  const inicial = !!(opts && opts.inicial);
  const patch = {};
  if (inicial) patch.cotacao_id = cot.id;
  const est = extrairEstimativa(cot.resumo);
  if (est) patch.estimativa_json = est;
  if (inicial && !temCustosReais(proc && proc.real_json)) {
    const ini = gerarRealJsonInicial(cot.resumo && cot.resumo.custos_cotados_json);
    if (ini) patch.real_json = ini;
  }
  const com = somarComissionados(proc && proc.comissoes_json, comissionadosDaCotacao(cot.dados));
  if (com) patch.comissoes_json = com;
  return patch;
}

// Linhas pro Histórico do processo (controle_log: campo/valor_antes/valor_depois).
function logVinculo(acao, info) {
  const i = info || {};
  const linhas = [];
  const estAntes = textoEstimativa(i.estAntes), estDepois = textoEstimativa(i.estDepois);
  if (acao === 'vinculou') {
    linhas.push({ campo: 'Cotação vinculada', valor_antes: i.cotAntiga ? rotuloCotacao(i.cotAntiga) : '—', valor_depois: rotuloCotacao(i.cot) });
    if (estAntes !== estDepois) linhas.push({ campo: 'Estimativa (cotação)', valor_antes: estAntes, valor_depois: estDepois });
  } else if (acao === 'atualizou') {
    if (estAntes !== estDepois) linhas.push({ campo: 'Estimativa (cotação salva de novo: ' + rotuloCotacao(i.cot) + ')', valor_antes: estAntes, valor_depois: estDepois });
  } else if (acao === 'desvinculou') {
    linhas.push({ campo: 'Cotação vinculada', valor_antes: rotuloCotacao(i.cot), valor_depois: '— (desvinculada' + (i.motivo ? ': ' + i.motivo : '') + ')' });
    if (estAntes !== '—') linhas.push({ campo: 'Estimativa (cotação)', valor_antes: estAntes, valor_depois: '—' });
  }
  return linhas;
}

/**
 * Vincular uma cotação a um processo que já existe.
 * @param {object} p
 * @param {object} p.cot      linha completa da cotação (id, cliente, dados, resumo, ativo)
 * @param {object} p.proc     linha do processo (id, referencia, cotacao_id, estimativa_json, real_json, comissoes_json, fechado, cancelado)
 * @param {Array}  p.outras   outras cotações ATIVAS ligadas ao processo (as que apontam pra ele e a do processo.cotacao_id)
 * @param {boolean} p.substituir  troca a cotação atual do processo por esta
 * @returns {{status:number, erro:string, conflito?:object}|{patchProcesso, resumoCotacao, desvincular, log}}
 */
function planoVincular(p) {
  const { cot, proc, outras, substituir, usuario, agora } = p || {};
  if (!cot) return { status: 404, erro: 'Cotação não encontrada.' };
  if (!cotacaoAtiva(cot)) return { status: 409, erro: 'Esta cotação foi excluída — restaure-a antes de vincular.' };
  if (!proc) return { status: 404, erro: 'Processo não encontrado.' };
  const bloqueio = bloqueioDoProcesso(proc);
  if (bloqueio) return { status: 409, erro: bloqueio };
  const atualDaCot = processoIdDaCotacao(cot);
  if (atualDaCot && atualDaCot !== proc.id) {
    return { status: 409, erro: `Esta cotação já está vinculada ao processo ${(cot.resumo && cot.resumo.processo_referencia) || atualDaCot} — desvincule antes de vincular a outro.` };
  }
  if (!extrairEstimativa(cot.resumo)) {
    return { status: 400, erro: 'Esta cotação ainda não tem números (não foi calculada) — abra no Calculador, calcule e salve antes de vincular.' };
  }
  const concorrentes = (outras || []).filter(o => o && o.id !== cot.id && cotacaoAtiva(o));
  if (concorrentes.length && !substituir) {
    const o = concorrentes[0];
    return {
      status: 409,
      erro: `O processo ${proc.referencia || ''} já tem a cotação ${rotuloCotacao(o)}. Confirme para trocar — a atual volta a Rascunho.`,
      conflito: { cotacao_id: o.id, cliente: o.cliente || '', rotulo: rotuloCotacao(o) },
    };
  }
  const desvincular = concorrentes
    .filter(o => processoIdDaCotacao(o) === proc.id)
    .map(o => ({ id: o.id, resumo: resumoDesvinculado(o.resumo, { usuario, agora, referencia: proc.referencia, motivo: 'trocada pela cotação ' + rotuloCotacao(cot) }) }));
  const patchProcesso = { ...patchProcessoComCotacao(cot, proc, { inicial: true }), updated_at: agora || new Date().toISOString() };
  const resumoCotacao = resumoVinculado(cot.resumo, proc, { usuario, agora });
  const jaVinculada = proc.cotacao_id === cot.id && atualDaCot === proc.id;
  const log = jaVinculada
    ? logVinculo('atualizou', { cot, estAntes: proc.estimativa_json, estDepois: patchProcesso.estimativa_json || proc.estimativa_json })
    : logVinculo('vinculou', { cot, cotAntiga: concorrentes[0] || null, estAntes: proc.estimativa_json, estDepois: patchProcesso.estimativa_json || proc.estimativa_json });
  return { patchProcesso, resumoCotacao, desvincular, log };
}

/**
 * Desvincular a cotação do processo (os dois lados).
 * proc pode ser null (processo não existe mais) — aí só a cotação muda.
 */
function planoDesvincular(p) {
  const { cot, proc, usuario, agora, motivo } = p || {};
  if (!cot) return { status: 404, erro: 'Cotação não encontrada.' };
  const pid = processoIdDaCotacao(cot);
  const processoApontaEla = !!(proc && proc.cotacao_id === cot.id);
  if (!pid && !processoApontaEla) return { status: 409, erro: 'Esta cotação não está vinculada a nenhum processo.' };
  if (proc) {
    const b = bloqueioDoProcesso(proc);
    if (b) return { status: 409, erro: b };
  }
  const resumoCotacao = resumoDesvinculado(cot.resumo, { usuario, agora, motivo, referencia: proc ? proc.referencia : null });
  let patchProcesso = null, log = [];
  // O processo só perde a estimativa se ela era DESTA cotação (ele aponta pra
  // ela, ou — vínculo antigo, só de um lado — a estimativa é a dela).
  const estDela = !!(proc && !proc.cotacao_id && estimativasIguais(proc.estimativa_json, extrairEstimativa(cot.resumo)));
  if (proc && (processoApontaEla || estDela)) {
    patchProcesso = { cotacao_id: null, estimativa_json: null, updated_at: agora || new Date().toISOString() };
    log = logVinculo('desvinculou', { cot, estAntes: proc.estimativa_json, motivo });
  }
  return { resumoCotacao, patchProcesso, log };
}

/**
 * Cotação vinculada salva de novo no Calculador.
 * @param {object} p.cotNova  { id, cliente, dados, resumo } — resumo JÁ mesclado com o do banco
 * @param {object|null} p.proc processo do resumo.processo_id (null = não existe mais)
 * @returns {{status, erro}|{resumoCotacao, patchProcesso, log, desvinculada?:true}}
 */
function planoResalvar(p) {
  const { cotNova, proc, usuario, agora } = p || {};
  const pid = processoIdDaCotacao(cotNova);
  if (!pid) return { resumoCotacao: cotNova.resumo, patchProcesso: null, log: [] };
  if (!proc) {
    return { resumoCotacao: resumoDesvinculado(cotNova.resumo, { usuario, agora, motivo: 'o processo não existe mais' }), patchProcesso: null, log: [], desvinculada: true };
  }
  if (proc.cotacao_id && proc.cotacao_id !== cotNova.id) {
    // Vínculo antigo só de um lado: o processo é de OUTRA cotação.
    return { resumoCotacao: resumoDesvinculado(cotNova.resumo, { usuario, agora, referencia: proc.referencia, motivo: 'o processo está vinculado a outra cotação' }), patchProcesso: null, log: [], desvinculada: true };
  }
  const b = bloqueioDoProcesso(proc);
  if (b) return { status: 409, erro: b.replace(/ — .*$/, '') + ` — a cotação dele fica só para leitura. Use "Duplicar" para fazer outra conta.` };
  const patch = patchProcessoComCotacao(cotNova, proc, { inicial: false });
  if (!proc.cotacao_id) patch.cotacao_id = cotNova.id; // completa vínculo antigo (só do lado da cotação)
  if (patch.estimativa_json && estimativasIguais(patch.estimativa_json, proc.estimativa_json)
      && JSON.stringify(patch.estimativa_json) === JSON.stringify(proc.estimativa_json)) delete patch.estimativa_json;
  const log = patch.estimativa_json ? logVinculo('atualizou', { cot: cotNova, estAntes: proc.estimativa_json, estDepois: patch.estimativa_json }) : [];
  const mudou = Object.keys(patch).length > 0;
  return {
    resumoCotacao: resumoVinculado(cotNova.resumo, proc, { usuario, agora }),
    patchProcesso: mudou ? { ...patch, updated_at: agora || new Date().toISOString() } : null,
    log,
  };
}

// Cliente que claramente não é nome de empresa (lido errado da planilha no
// piloto de 23/08/2026: "NÃO", "SIM"...).
function clienteInvalido(nome) {
  const t = String(nome || '').trim();
  return !t || /^(n[ãa]o|sim|novos?|-+|x+|\?+)$/i.test(t);
}

function maisRecentePrimeiro(a, b) { return String(b.updated_at || '').localeCompare(String(a.updated_at || '')); }

/**
 * Conferência dos vínculos (tela Cotações) + o que a correção automática faz.
 * @param {Array} cotacoes  [{ id, cliente, resumo, ativo, updated_at, updated_by }]
 * @param {Array} processos [{ id, referencia, cliente, cotacao_id, estimativa_json, fechado, cancelado }]
 * @param {object} [opts] { usuario, agora, excluirCopias: soft-delete das cópias idênticas soltas }
 * @returns {{ porCotacao, problemas, acoes, contagem }}
 *   porCotacao[id] = { estado, texto } — estado: ok | sem_vinculo | ... (ver ESTADOS)
 *   acoes: [{ alvo:'processo', id, patch, log } | { alvo:'cotacao', id, resumo?, cliente?, ativo? }]
 */
function diagnosticarVinculos(cotacoes, processos, opts) {
  const o = opts || {};
  const usuario = o.usuario || null, agora = o.agora || new Date().toISOString();
  const procPorId = new Map((processos || []).map(p => [p.id, p]));
  const cotPorId = new Map((cotacoes || []).map(c => [c.id, c]));
  const ativas = (cotacoes || []).filter(cotacaoAtiva);
  const porCotacao = {}, problemas = [], acoes = [];
  const marcar = (c, estado, texto) => { porCotacao[c.id] = { estado, texto: texto || '' }; };
  const problema = (tipo, texto, extra) => problemas.push({ tipo, texto, automatico: true, ...(extra || {}) });

  // Quem aponta pra quem.
  const pedidos = new Map();
  ativas.forEach(c => {
    const pid = processoIdDaCotacao(c);
    if (!pid) return;
    if (!pedidos.has(pid)) pedidos.set(pid, []);
    pedidos.get(pid).push(c);
  });
  const desvinculadas = new Set();
  const desvincular = (c, proc, motivo, estado, texto) => {
    desvinculadas.add(c.id);
    marcar(c, estado, texto);
    acoes.push({ alvo: 'cotacao', id: c.id, resumo: resumoDesvinculado(c.resumo, { usuario, agora, referencia: proc ? proc.referencia : null, motivo }) });
  };

  for (const [pid, lista] of pedidos) {
    const proc = procPorId.get(pid);
    if (!proc) {
      lista.forEach(c => {
        const ref = (c.resumo && c.resumo.processo_referencia) || pid;
        desvincular(c, null, 'o processo ' + ref + ' não existe mais', 'processo_inexistente', `Aponta para o processo ${ref}, que não existe mais — volta a Rascunho.`);
        problema('processo_inexistente', `Cotação ${rotuloCotacao(c)} aponta para o processo ${ref}, que não existe mais.`, { cotacao_id: c.id });
      });
      continue;
    }
    // Qual cotação é a do processo: a que ele aponta (se ela existe e não é
    // de outro processo); senão a que tem a estimativa igual à do processo
    // (a mais recente); senão, sendo uma só, ela.
    const c2 = proc.cotacao_id ? cotPorId.get(proc.cotacao_id) : null;
    const c2Valida = !!(c2 && cotacaoAtiva(c2) && (!processoIdDaCotacao(c2) || processoIdDaCotacao(c2) === proc.id));
    let principal = null;
    if (c2Valida) {
      principal = c2;
      if (!lista.includes(c2)) {
        // O processo aponta pra uma cotação que não apontava de volta: o
        // lado dela é completado abaixo (resumo do principal).
        problema('so_no_processo', `Processo ${proc.referencia} aponta para a cotação ${rotuloCotacao(c2)}, que não apontava de volta.`, { cotacao_id: c2.id, processo_id: proc.id, referencia: proc.referencia });
      }
    } else {
      if (proc.cotacao_id) {
        problema('processo_aponta_cotacao_ausente', `O processo ${proc.referencia} apontava para uma cotação ${c2 ? (cotacaoAtiva(c2) ? 'de outro processo' : 'excluída') : 'que não existe'}.`, { processo_id: proc.id, referencia: proc.referencia });
      }
      const batem = lista.filter(c => estimativasIguais(proc.estimativa_json, c.resumo)).sort(maisRecentePrimeiro);
      principal = batem[0] || (lista.length === 1 ? lista[0] : null);
    }
    if (!principal) {
      lista.forEach(c => marcar(c, 'conferir', `O processo ${proc.referencia} tem ${lista.length} cotações e a estimativa dele não bate com nenhuma — escolha a certa (vincular) e desvincule as outras.`));
      problemas.push({ tipo: 'varias_sem_estimativa_igual', automatico: false, processo_id: proc.id, referencia: proc.referencia,
        texto: `Processo ${proc.referencia}: ${lista.length} cotações apontam para ele e nenhuma tem a estimativa igual à do processo — escolher à mão.` });
      continue;
    }
    // Principal: completa o lado do processo e acerta a referência/status.
    const patch = {};
    if (proc.cotacao_id !== principal.id) patch.cotacao_id = principal.id;
    // Processo fechado: só completa o vínculo, não mexe na estimativa.
    if (!proc.fechado && (!proc.estimativa_json || !Object.keys(proc.estimativa_json).length)) {
      const est = extrairEstimativa(principal.resumo);
      if (est) patch.estimativa_json = est;
    }
    const r = principal.resumo || {};
    const precisaResumo = r.status !== 'aprovada' || r.processo_id !== proc.id || r.processo_referencia !== proc.referencia;
    const precisaCliente = clienteInvalido(principal.cliente) && !clienteInvalido(proc.cliente);
    if (Object.keys(patch).length) {
      const log = [];
      if (patch.cotacao_id) {
        log.push({ campo: 'Cotação vinculada', valor_antes: proc.cotacao_id ? String(proc.cotacao_id).slice(0, 8) + ' (inválida)' : '—', valor_depois: rotuloCotacao(principal) + ' (vínculo completado)' });
        problema('so_na_cotacao', `Cotação ${rotuloCotacao(principal)} apontava para o processo ${proc.referencia}, mas o processo não sabia dela.`, { cotacao_id: principal.id, processo_id: proc.id, referencia: proc.referencia });
      }
      if (patch.estimativa_json) {
        log.push({ campo: 'Estimativa (cotação)', valor_antes: '—', valor_depois: textoEstimativa(patch.estimativa_json) });
        problema('estimativa_ausente', `Processo ${proc.referencia} estava sem a estimativa da cotação vinculada — gravada.`, { cotacao_id: principal.id, processo_id: proc.id, referencia: proc.referencia });
      }
      acoes.push({ alvo: 'processo', id: proc.id, referencia: proc.referencia, patch: { ...patch, updated_at: agora }, log });
    }
    if (precisaResumo || precisaCliente) {
      const acao = { alvo: 'cotacao', id: principal.id };
      if (precisaResumo) acao.resumo = resumoVinculado(principal.resumo, proc, { usuario, agora });
      if (precisaCliente) {
        acao.cliente = String(proc.cliente).trim();
        problema('cliente_invalido', `Cotação ${rotuloCotacao(principal)} tinha o cliente "${principal.cliente || ''}" — passa a ${acao.cliente} (cliente do processo ${proc.referencia}).`, { cotacao_id: principal.id });
      }
      if (precisaResumo && r.processo_referencia !== proc.referencia && r.status === 'aprovada') {
        problema('referencia_antiga', `Cotação ${rotuloCotacao(principal)}: referência ${r.processo_referencia || '—'} → ${proc.referencia}.`, { cotacao_id: principal.id });
      }
      acoes.push(acao);
    }
    if (proc.estimativa_json && Object.keys(proc.estimativa_json).length && !estimativasIguais(proc.estimativa_json, principal.resumo)) {
      marcar(principal, 'estimativa_diferente', `A estimativa do processo ${proc.referencia} (${textoEstimativa(proc.estimativa_json)}) é diferente desta cotação (${textoEstimativa(principal.resumo)}). Salvar a cotação de novo no Calculador passa os números dela para o processo.`);
      problemas.push({ tipo: 'estimativa_diferente', automatico: false, cotacao_id: principal.id, processo_id: proc.id, referencia: proc.referencia,
        texto: `Processo ${proc.referencia}: a estimativa gravada no processo é diferente da cotação vinculada — mantida a do processo; conferir.` });
    } else if (!porCotacao[principal.id]) {
      marcar(principal, 'ok', '');
    }
    lista.filter(c => c.id !== principal.id).forEach(c => {
      desvincular(c, proc, `o processo ${proc.referencia} é da cotação ${rotuloCotacao(principal)}`, 'duplicada',
        `Mais de uma cotação apontava para o processo ${proc.referencia}; a dele é ${rotuloCotacao(principal)} — esta volta a Rascunho.`);
      problema('duplicada', `Processo ${proc.referencia}: a cotação ${rotuloCotacao(c)} também apontava para ele (a dele é ${rotuloCotacao(principal)}).`, { cotacao_id: c.id, processo_id: proc.id, referencia: proc.referencia });
    });
  }

  // Processo apontando pra cotação que não aponta pra ninguém (e ninguém aponta pro processo).
  const completadas = new Set();
  (processos || []).forEach(proc => {
    if (!proc.cotacao_id || pedidos.has(proc.id)) return;
    const c = cotPorId.get(proc.cotacao_id);
    if (c && completadas.has(c.id)) {
      problemas.push({ tipo: 'cotacao_em_dois_processos', automatico: false, processo_id: proc.id, referencia: proc.referencia, cotacao_id: c.id,
        texto: `A cotação ${rotuloCotacao(c)} é apontada por mais de um processo (${proc.referencia} e outro) — conferir à mão.` });
      return;
    }
    if (c && cotacaoAtiva(c) && !processoIdDaCotacao(c)) {
      completadas.add(c.id);
      acoes.push({ alvo: 'cotacao', id: c.id, resumo: resumoVinculado(c.resumo, proc, { usuario, agora }) });
      marcar(c, 'so_no_processo', `O processo ${proc.referencia} aponta para ela — vínculo completado.`);
      problema('so_no_processo', `Processo ${proc.referencia} aponta para a cotação ${rotuloCotacao(c)}, que não apontava de volta.`, { cotacao_id: c.id, processo_id: proc.id, referencia: proc.referencia });
    } else if (!c || !cotacaoAtiva(c) || (processoIdDaCotacao(c) && processoIdDaCotacao(c) !== proc.id)) {
      problemas.push({ tipo: 'processo_aponta_cotacao_ausente', automatico: false, processo_id: proc.id, referencia: proc.referencia,
        texto: `O processo ${proc.referencia} aponta para uma cotação ${c ? (cotacaoAtiva(c) ? 'ligada a outro processo' : 'excluída') : 'que não existe'} — conferir à mão.` });
    }
  });

  // Status incoerente: aprovada sem processo.
  ativas.forEach(c => {
    const r = c.resumo || {};
    if (r.status === 'aprovada' && !r.processo_id && !acoes.some(a => a.alvo === 'cotacao' && a.id === c.id)) {
      marcar(c, 'aprovada_sem_processo', 'Marcada como aprovada, mas sem processo — volta a Rascunho.');
      acoes.push({ alvo: 'cotacao', id: c.id, resumo: resumoDesvinculado(c.resumo, { usuario, agora, motivo: 'estava aprovada sem processo' }) });
      problema('aprovada_sem_processo', `Cotação ${rotuloCotacao(c)} estava "aprovada" sem processo.`, { cotacao_id: c.id });
    }
    if (!porCotacao[c.id]) marcar(c, r.processo_id ? 'ok' : 'sem_vinculo', '');
  });

  // Cópias idênticas soltas (mesmo cliente/tipo/UF/números de outra cotação
  // ativa que fica): excluir (reversível — "Excluídas" → Restaurar).
  if (o.excluirCopias) {
    const ficam = ativas.filter(c => !desvinculadas.has(c.id) && processoIdDaCotacao(c));
    const soltas = ativas.filter(c => desvinculadas.has(c.id) || !processoIdDaCotacao(c));
    const chave = c => { const r = c.resumo || {}; return [String(c.cliente || '').trim().toUpperCase(), r.tipo || '', r.uf || '', r2(r.custo_total), r2(r.faturamento), r2(r.lucro_bruto)].join('|'); };
    const vistas = new Map(ficam.map(c => [chave(c), c]));
    soltas.slice().sort(maisRecentePrimeiro).reverse().forEach(c => {
      if (r2((c.resumo || {}).custo_total) === null) return;
      const k = chave(c);
      const original = vistas.get(k);
      if (!original) { vistas.set(k, c); return; }
      porCotacao[c.id] = { estado: 'copia_excluida', texto: `Cópia idêntica de ${rotuloCotacao(original)} — excluída (dá para restaurar).` };
      const resumoBase = (acoes.find(a => a.alvo === 'cotacao' && a.id === c.id && a.resumo) || {}).resumo || c.resumo || {};
      const acao = acoes.find(a => a.alvo === 'cotacao' && a.id === c.id);
      const resumoExcl = { ...resumoBase, excluida_em: agora, excluida_por: usuario, excluida_motivo: 'cópia idêntica de ' + rotuloCotacao(original) };
      if (acao) { acao.resumo = resumoExcl; acao.ativo = false; }
      else acoes.push({ alvo: 'cotacao', id: c.id, resumo: resumoExcl, ativo: false });
      problema('copia_identica', `Cotação ${rotuloCotacao(c)} é cópia idêntica de ${rotuloCotacao(original)} — excluída (reversível).`, { cotacao_id: c.id });
    });
  }

  const contagem = {
    cotacoes: ativas.length,
    ok: Object.values(porCotacao).filter(x => x.estado === 'ok').length,
    problemas: problemas.length,
    automaticos: problemas.filter(x => x.automatico).length,
    manuais: problemas.filter(x => !x.automatico).length,
    acoes: acoes.length,
  };
  return { porCotacao, problemas, acoes, contagem };
}

module.exports = {
  CAMPOS_RESUMO_CICLO,
  processoIdDaCotacao,
  bloqueioDoProcesso,
  temCustosReais,
  comissionadosDaCotacao,
  somarComissionados,
  estimativasIguais,
  textoEstimativa,
  rotuloCotacao,
  resumoVinculado,
  resumoDesvinculado,
  patchProcessoComCotacao,
  logVinculo,
  planoVincular,
  planoDesvincular,
  planoResalvar,
  clienteInvalido,
  diagnosticarVinculos,
};
