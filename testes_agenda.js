/**
 * TESTES — agenda-core.js (Agenda de atividades por etapa, #675)
 * Roda com: node testes_agenda.js   (valores fictícios)
 */
const assert = require('assert');
const A = require('./agenda-core.js');
let passou = 0, falhou = 0;
function teste(nome, fn) { try { const r = fn(); if (r && r.then) { r.then(() => { passou++; console.log(`  ✓ ${nome}`); }).catch(e => { falhou++; console.log(`  ✗ ${nome}`); console.log(`    ${e.message}`); }); return; } passou++; console.log(`  ✓ ${nome}`); } catch (e) { falhou++; console.log(`  ✗ ${nome}`); console.log(`    ${e.message}`); } }
const HOJE = '2026-10-13';
const gerar = (ps, extra) => A.gerarTarefas(ps, Object.assign({ hoje: HOJE }, extra || {}));
const cods = (ts, ref) => ts.filter(t => !ref || t.referencia === ref).map(t => t.codigo);

console.log('\n── datas ──');
teste('somaUteis pula fim de semana (sex + 1 útil = seg)', () => assert.strictEqual(A.somaUteis('2026-10-16', 1), '2026-10-19'));
teste('somaUteis negativo', () => assert.strictEqual(A.somaUteis('2026-10-19', -1), '2026-10-16'));

console.log('\n── configuração ──');
const cfg = A.montarConfig(null);
teste('47 atividades padrão (36 + 6 de faturas + 5 de dados para conferir) e 8 funções', () => { assert.strictEqual(Object.keys(cfg.atividades).length, 47); assert.strictEqual(Object.keys(cfg.funcoes).length, 8); });
teste('funções do usuário vêm da lista (Importação + Logística)', () => assert.deepStrictEqual(A.funcoesDoUsuario(cfg, 'emanuelly').sort(), ['IMPORTACAO', 'LOGISTICA']));
teste('override da Lista troca função e prazo só da atividade editada', () => {
  const c = A.montarConfig({ agenda_atividade: [{ codigo: 'A03', nome: 'X', dados: { funcao: 'FISCAL', prazo_dias: 5 } }] });
  assert.strictEqual(c.atividades.A03.funcao, 'FISCAL'); assert.strictEqual(c.atividades.A03.prazoDias, 5);
  assert.strictEqual(c.atividades.A04.funcao, 'COMERCIAL');
});
teste('atividade desativada na Lista não aparece', () => {
  const c = A.montarConfig({ agenda_atividade: [{ codigo: 'A03', nome: 'X', ativo: false, dados: {} }] });
  const ts = A.gerarTarefas([{ id: '1', referencia: 'P1', pi_data: '2026-10-10' }], { hoje: HOJE, cfg: c });
  assert.ok(!cods(ts).includes('A03'));
});
teste('substituto vê as tarefas da função', () => {
  const c = A.montarConfig({ agenda_funcao: [{ codigo: 'FISCAL', nome: 'Fiscal', dados: { usuarios: 'italo', substitutos: 'maria' } }] });
  assert.ok(A.funcoesDoUsuario(c, 'maria').includes('FISCAL'));
});

console.log('\n── geração ──');
const novo = { id: '1', referencia: 'P1', pi_data: '2026-10-09', created_at: '2026-10-09' };
teste('processo novo gera cadastro, conferência PI e Conexos', () => { const c = cods(gerar([novo])); ['A01', 'A02', 'A03'].forEach(x => assert.ok(c.includes(x), x)); });
teste('prazo em dias úteis (PI sexta 09/10 + 1 útil = 12/10)', () => assert.strictEqual(gerar([novo]).find(t => t.codigo === 'A01').prazo, '2026-10-12'));
teste('conclusão automática: campo preenchido some a tarefa', () => assert.ok(!cods(gerar([Object.assign({}, novo, { conexos_id: '123' })])).includes('A03')));
teste('processo antigo (prazo antes do corte) não gera histórico', () => assert.strictEqual(gerar([{ id: '2', referencia: 'OLD', pi_data: '2026-03-01', created_at: '2026-03-01' }]).filter(t => t.referencia).length, 0));
teste('cancelado não gera tarefa', () => assert.strictEqual(gerar([Object.assign({}, novo, { cancelado: true })]).filter(t => t.referencia).length, 0));
teste('Acompanhamento: sem tarefas de Financeiro/Comercial', () => {
  const ts = gerar([Object.assign({}, novo, { finalidade: 'ACOMPANHAMENTO' })]).filter(t => t.referencia);
  assert.ok(!ts.some(t => ['FINANCEIRO', 'COMERCIAL', 'FISCAL'].includes(t.funcao)));
});
teste('câmbio: uma tarefa por parcela em aberto, na função Financeiro', () => {
  const p = Object.assign({}, novo, { pi_pagamento: 'PARCELADO', pi_valor_usd: 1000, pi_parcelas_json: JSON.stringify([{ label: 'Inicial', valor_usd: 300, data_vencimento: '2026-10-15' }, { label: 'Final', valor_usd: 700, data_vencimento: '2026-11-30' }]) });
  const ts = gerar([p]).filter(t => ['A06', 'A15'].includes(t.codigo));
  assert.deepStrictEqual(ts.map(t => t.codigo + ':' + t.prazo), ['A06:2026-10-15', 'A15:2026-11-30']);
});
teste('câmbio fechado conclui a tarefa da parcela', () => {
  const p = Object.assign({}, novo, { pi_pagamento: 'PARCELADO', pi_valor_usd: 1000, pi_parcelas_json: JSON.stringify([{ label: 'Inicial', valor_usd: 300, data_vencimento: '2026-10-15', cambio_fechado: '5.40' }]) });
  assert.ok(!cods(gerar([p])).includes('A06'));
});
teste('Encomenda: tarefa de receber do cliente 2 dias antes do câmbio', () => {
  const p = Object.assign({}, novo, { finalidade: 'ENCOMENDA', pi_pagamento: 'PARCELADO', pi_valor_usd: 1000, pi_parcelas_json: JSON.stringify([{ label: 'Inicial', valor_usd: 300, data_vencimento: '2026-10-20' }]) });
  assert.strictEqual(gerar([p]).find(t => t.codigo === 'A05').prazo, '2026-10-18');
});
const chegado = { id: '3', referencia: 'P3', created_at: '2026-08-01', etd: '2026-09-01', data_embarque: '2026-09-01', hbl: 'H1', free_time: '14', aprovacao_hbl: 'Sim', docs_enviados_despachante: '2026-09-02', solicitacao_li: 'Sim', eta: '2026-10-10', data_chegada: '2026-10-10' };
teste('chegou sem DUIMP: despachante registra a DUIMP (1 útil após a chegada)', () => {
  const t = gerar([chegado]).find(x => x.codigo === 'A20'); assert.ok(t); assert.strictEqual(t.funcao, 'DESPACHANTE'); assert.strictEqual(t.prazo, '2026-10-12');
});
teste('liberado e chegado: Fiscal emite NF de entrada e Logística agenda retirada', () => {
  const p = Object.assign({}, chegado, { numero_di: '26BR1', data_registro_di: '2026-10-10', canal: 'VERDE', data_parametrizacao: '2026-10-10', data_liberacao: '2026-10-10' });
  const c = cods(gerar([p])); assert.ok(c.includes('A24')); assert.ok(c.includes('A27')); assert.ok(!c.includes('A20'));
});
teste('DUIMP antecipada liberada, navio ainda não chegou: NF de entrada NÃO nasce', () => {
  const p = { id: '4', referencia: 'P4', created_at: '2026-08-01', data_embarque: '2026-09-01', etd: '2026-09-01', eta: '2026-10-20', numero_di: '26BR2', data_registro_di: '2026-10-09', canal: 'VERDE', data_parametrizacao: '2026-10-09', data_liberacao: '2026-10-09' };
  assert.ok(!cods(gerar([p])).includes('A24'));
});
teste('LCL não gera devolução de vazio; FCL gera', () => {
  const base = Object.assign({}, chegado, { data_carregamento: '2026-10-12' });
  assert.ok(cods(gerar([base])).includes('A29'));
  assert.ok(!cods(gerar([Object.assign({}, base, { containers_json: JSON.stringify([{ numero: 'X', tipo: 'LCL' }]) })])).includes('A29'));
});

console.log('\n── manuais / recorrentes ──');
teste('atividade manual marcada como feita some (e volta com incluirFeitas)', () => {
  const ch = A.chaveTarefa('A02', '1', '');
  assert.ok(!cods(gerar([novo], { conclusoes: [{ chave: ch, tipo: 'feita' }] })).includes('A02'));
  const t = gerar([novo], { conclusoes: [{ chave: ch, tipo: 'feita' }], incluirFeitas: true }).find(x => x.codigo === 'A02');
  assert.strictEqual(t.status, 'feita');
});
teste('"não se aplica" também tira da lista', () => assert.ok(!cods(gerar([novo], { conclusoes: [{ chave: A.chaveTarefa('A03', '1', ''), tipo: 'nao_aplica' }] })).includes('A03')));
teste('mensais: Pendências de DI e averbação vencem dia 5', () => {
  const ts = gerar([]); const pend = ts.find(t => t.codigo === 'A33');
  assert.strictEqual(pend.prazo, '2026-10-05'); assert.ok(ts.some(t => t.codigo === 'A34'));
});
teste('trimestral: reciclagem do 3º tri vence 15/10', () => assert.strictEqual(gerar([]).find(t => t.codigo === 'A35').prazo, '2026-10-15'));
teste('classificar: atrasada / hoje / semana / futura', () => {
  assert.strictEqual(A.classificar({ status: 'aberta', prazo: '2026-10-10' }, HOJE), 'atrasada');
  assert.strictEqual(A.classificar({ status: 'aberta', prazo: HOJE }, HOJE), 'hoje');
  assert.strictEqual(A.classificar({ status: 'aberta', prazo: '2026-10-18' }, HOJE), 'semana');
  assert.strictEqual(A.classificar({ status: 'aberta', prazo: '2026-11-30' }, HOJE), 'futura');
});

// ── servidor (agenda-servidor.js): motor do front no sandbox + histórico ──
console.log('\n── servidor: histórico e resumo ──');
const S = require('./agenda-servidor.js');
teste('motor do front carrega no sandbox (calcularFase/listarPagamentosPI)', () => {
  const m = S.carregarMotor();
  assert.ok(m && typeof m.calcularFase === 'function' && typeof m.listarPagamentosPI === 'function');
  assert.strictEqual(m.calcularFase({ etd: '2026-01-01', data_embarque: '2026-01-02' }), 'EMBARCADO');
});
// sb() falso em memória: só o que atualizarHistorico usa (select/upsert/update/order/gte).
function sbFalso(estado) {
  const q = (tabela) => {
    const api = { _f: [] };
    api.select = () => api; api.order = () => api; api.gte = () => api; api.range = () => api; api.eq = (c, v) => { api._f.push([c, v]); return api; };
    api.neq = (c, v) => { api._f.push([c, x => x !== v]); return api; };
    api.then = (res) => res({ data: (estado[tabela] || []).filter(r => api._f.every(([c, v]) => typeof v === 'function' ? v(r[c]) : r[c] === v)), error: null });
    api.upsert = (rows) => { (Array.isArray(rows) ? rows : [rows]).forEach(r => { const i = (estado[tabela] = estado[tabela] || []).findIndex(x => x.chave === r.chave); if (i >= 0) Object.assign(estado[tabela][i], r); else estado[tabela].push(Object.assign({}, r)); }); return { then: (res) => res({ error: null }) }; };
    api.update = (patch) => ({ eq: (c, v) => { (estado[tabela] || []).filter(r => r[c] === v).forEach(r => Object.assign(r, patch)); return { then: (res) => res({ error: null }) }; } });
    return api;
  };
  return () => ({ from: q });
}
teste('histórico: dia 1 abre, dia 2 (campo preenchido) fecha com data e tipo auto', async () => {
  const estado = { controle_processos: [{ id: 'p1', referencia: 'P1', pi_data: '2026-10-09', created_at: '2026-10-09' }], agenda_conclusoes: [], agenda_historico: [] };
  const ctx = { sb: sbFalso(estado), carregarListas: async () => ({ listas: null }) };
  const r1 = await S.atualizarHistorico(ctx, { hoje: '2026-10-13' });
  assert.ok(r1.abertas >= 3 && r1.novas === r1.abertas && r1.fechadas === 0);
  const a03 = estado.agenda_historico.find(h => h.codigo === 'A03');
  assert.strictEqual(a03.aberta_em, '2026-10-13'); assert.strictEqual(a03.fechada_em, null);
  estado.controle_processos[0].conexos_id = '999'; // Conexos cadastrado
  const r2 = await S.atualizarHistorico(ctx, { hoje: '2026-10-14' });
  assert.strictEqual(r2.fechadas, 1);
  assert.strictEqual(estado.agenda_historico.find(h => h.codigo === 'A03').fechada_em, '2026-10-14');
  assert.strictEqual(estado.agenda_historico.find(h => h.codigo === 'A03').tipo, 'auto');
  const r3 = await S.atualizarHistorico(ctx, { hoje: '2026-10-14' }); // idempotente
  assert.strictEqual(r3.novas, 0); assert.strictEqual(r3.fechadas, 0);
});
teste('histórico: lote com tarefa nova + tarefa que mudou de prazo não manda aberta_em vazio (NOT NULL)', async () => {
  const estado = { controle_processos: [{ id: 'p1', referencia: 'P1', pi_data: '2026-10-09', created_at: '2026-10-09' }], agenda_conclusoes: [], agenda_historico: [] };
  const sbBase = sbFalso(estado);
  // como o PostgREST: no lote, coluna presente em alguma linha e ausente/nula em outra = null → viola NOT NULL
  const sbNotNull = () => { const c = sbBase(); return { from: (t) => { const q = c.from(t); const up = q.upsert; q.upsert = (rows) => { const arr = Array.isArray(rows) ? rows : [rows]; if (t === 'agenda_historico' && arr.some(r => r.aberta_em == null)) return { then: (res) => res({ error: { message: 'null value in column "aberta_em" violates not-null constraint' } }) }; return up(rows); }; return q; } }; };
  const ctx = { sb: sbNotNull, carregarListas: async () => ({ listas: null }) };
  await S.atualizarHistorico(ctx, { hoje: '2026-10-13' });
  const h = estado.agenda_historico[0]; h.prazo = '2000-01-01'; // força "mudou de prazo"
  estado.controle_processos.push({ id: 'p2', referencia: 'P2', pi_data: '2026-10-14', created_at: '2026-10-14' }); // tarefas novas
  const r = await S.atualizarHistorico(ctx, { hoje: '2026-10-14' });
  assert.ok(r.novas > 0, 'tarefas novas gravadas');
  assert.strictEqual(estado.agenda_historico.find(x => x.chave === h.chave).aberta_em, '2026-10-13', 'mantém a data em que abriu');
});
teste('histórico: marcada "Não se aplica" fecha com tipo nao_aplica', async () => {
  const estado = { controle_processos: [{ id: 'p1', referencia: 'P1', pi_data: '2026-10-09', created_at: '2026-10-09' }], agenda_conclusoes: [], agenda_historico: [] };
  const ctx = { sb: sbFalso(estado), carregarListas: async () => ({ listas: null }) };
  await S.atualizarHistorico(ctx, { hoje: '2026-10-13' });
  estado.agenda_conclusoes.push({ chave: A.chaveTarefa('A02', 'p1', ''), codigo: 'A02', tipo: 'nao_aplica' });
  await S.atualizarHistorico(ctx, { hoje: '2026-10-14' });
  assert.strictEqual(estado.agenda_historico.find(h => h.codigo === 'A02').tipo, 'nao_aplica');
});
teste('resumo por pessoa: atrasadas, mais antiga e fechadas da semana (com atraso)', () => {
  const c = A.montarConfig(null);
  const abertas = A.gerarTarefas([{ id: 'p1', referencia: 'P1', pi_data: '2026-10-01', created_at: '2026-10-01' }], { hoje: '2026-10-13', cfg: c });
  const hist = [{ chave: 'x', funcao: 'IMPORTACAO', prazo: '2026-10-08', fechada_em: '2026-10-10' }, { chave: 'y', funcao: 'IMPORTACAO', prazo: '2026-10-12', fechada_em: '2026-10-10' }, { chave: 'z', funcao: 'IMPORTACAO', prazo: '2026-09-01', fechada_em: '2026-09-05' }];
  const r = S.resumoPorPessoa(c, abertas, hist, '2026-10-13', 7);
  const em = r.linhas.find(l => l.login === 'emanuelly');
  assert.ok(em.atrasadas >= 1 && em.maisAntiga >= 1, 'deveria ter atrasada');
  assert.strictEqual(em.fechadas, 2); assert.strictEqual(em.comAtraso, 1); assert.strictEqual(em.pctNoPrazo, 50);
  assert.ok(r.piores.length >= 1 && r.piores[0].atraso >= r.piores[r.piores.length - 1].atraso);
});

console.log('\n── RIC em andamento / validação só após RIC (Emanuelly 15/10/2026) ──');
const devolvido = { id: '90', referencia: 'PX', created_at: '2026-08-01', data_carregamento: '2026-10-01', data_devolucao_vazio: '2026-10-02', ric_status: 'Termo' };
teste('RIC pendente passado do prazo fica "andamento", não "atrasada"', () => {
  const t = gerar([devolvido]).find(x => x.codigo === 'A30');
  assert.ok(t); assert.strictEqual(A.classificar(t, HOJE), 'andamento');
});
teste('Validar e finalizar NÃO nasce enquanto o RIC não foi resolvido', () => {
  assert.ok(!cods(gerar([devolvido])).includes('A36'));
});
teste('Validar nasce após lavagem paga, com prazo de 2 dias do pagamento', () => {
  const t = gerar([Object.assign({}, devolvido, { data_pagamento_lavagem: '2026-10-12' })]).find(x => x.codigo === 'A36');
  assert.ok(t); assert.strictEqual(t.prazo, '2026-10-14');
});
teste('Validar nasce com RIC Isento (sem prazo, não fica atrasada)', () => {
  const t = gerar([Object.assign({}, devolvido, { ric_status: 'Isento' })]).find(x => x.codigo === 'A36');
  assert.ok(t); assert.strictEqual(A.classificar(t, HOJE), 'sem_prazo');
});

teste('Confirmar booking (A08) conclui com Nº Booking + ETD, sem exigir navio (TKH2605B-3, 16/10/2026)', () => {
  const p = { id: '91', referencia: 'PY', created_at: '2026-09-01', data_prontidao: '2026-09-29', booking_numero: 'BK1', etd: '2026-11-10' };
  const t = gerar([p], { incluirFeitas: true }).find(x => x.codigo === 'A08');
  assert.ok(t); assert.strictEqual(t.status, 'feita');
});

// ── Faturas na agenda (fase 2, 21/10/2026) — valores fictícios ──────────
console.log('\n── faturas: tarefas por responsável ──');
const FC = require('./faturas-core.js');
const HF = '2026-10-21'; // quarta
const PF = { id: 'pf1', referencia: 'TESTE-FAT-1', cliente: 'CLIENTE FICTICIO LTDA', created_at: '2026-10-01', pi_data: '2026-10-01' };
const DESP = 'DESPACHANTE FICTICIO LTDA';
const fat = (x) => Object.assign({ tipo: 'pagar', status: 'aberta', moeda: 'BRL', empresa_nome: 'AGENTE FICTICIO SA', created_at: '2026-10-15T12:00:00Z',
  itens: [{ processo_id: 'pf1', referencia: 'TESTE-FAT-1', taxa: 'frete', valor: x.valor || 1000 }], anexos: [], pagamentos: [] }, x);
const doc = em => [{ id: 'ax', tipo: 'fatura', em }];
const chk = { nivel: 'erro', tipo: 'valor', item: 0, msg: 'Frete: R$ 1.000,00 × sistema R$ 900,00' };
const gerarF = (faturas, extra, procs) => A.gerarTarefas(procs || [PF], Object.assign({ hoje: HF, faturas: FC.faturasParaAgenda(faturas) }, extra || {}));
const deF = (ts, cod) => ts.filter(t => t.codigo === cod);

teste('faturasParaAgenda: dono = processo com a maior parte; sem processo e cancelada ficam fora', () => {
  const s = FC.faturasParaAgenda([
    fat({ id: 'm1', itens: [{ processo_id: 'pA', valor: 100 }, { processo_id: 'pB', valor: 300 }] }),
    fat({ id: 'g1', itens: [] }), // despesa geral, sem processo
    fat({ id: 'c1', status: 'cancelada' }),
  ]);
  assert.deepStrictEqual(s.map(f => f.id), ['m1']);
  assert.strictEqual(s[0].processos[0].id, 'pB');
  assert.ok(!('itens' in s[0]) && !('pagamentos' in s[0]), 'sai enxuto');
});
teste('fatura recebida (documento anexado): Importação confere (venc − 3) e o Financeiro vê "aguardando conferência"', () => {
  const ts = gerarF([fat({ id: 'f1', numero: '000001/26', vencimento: '2026-10-30', anexos: doc('2026-10-16T10:00:00Z') })]);
  const c = deF(ts, 'A37')[0];
  assert.ok(c && c.funcao === 'IMPORTACAO' && c.prazo === '2026-10-27' && c.aba === 'faturas');
  const p = deF(ts, 'A40')[0];
  assert.ok(p && p.funcao === 'FINANCEIRO' && p.prazo === '2026-10-30' && /aguardando conferência/.test(p.detalhe));
  assert.strictEqual(deF(ts, 'A39').length, 0, 'gerente só aprova depois de conferida');
});
teste('fatura que chega em cima do vencimento não nasce atrasada (piso: 1 dia útil depois do documento)', () => {
  const c = deF(gerarF([fat({ id: 'f2', vencimento: '2026-10-22', anexos: doc('2026-10-21T09:00:00Z') })]), 'A37')[0];
  assert.strictEqual(c.prazo, '2026-10-22');
  assert.notStrictEqual(A.classificar(c, HF), 'atrasada');
});
teste('fatura prevista (sem documento): nenhuma tarefa ainda', () => {
  const ts = gerarF([fat({ id: 'f3', vencimento: '2026-10-30' })]);
  assert.strictEqual(ts.filter(t => /^A(37|38|39|40)$/.test(t.codigo)).length, 0);
});
teste('conferida sem diferença: conferência sai e o gerente aprova (venc − 1)', () => {
  const ts = gerarF([fat({ id: 'f4', vencimento: '2026-10-30', anexos: doc('2026-10-16T10:00:00Z'), conferencia: { em: '2026-10-17T10:00:00Z', checks: [{ nivel: 'ok', tipo: 'valor', msg: 'ok' }] } })]);
  assert.strictEqual(deF(ts, 'A37').length, 0);
  const a = deF(ts, 'A39')[0];
  assert.ok(a && a.funcao === 'GERENCIA' && a.prazo === '2026-10-29');
  assert.ok(/aguardando aprovação/.test(deF(ts, 'A40')[0].detalhe));
});
teste('diferença sem decisão: Importação decide (sem tarefa de aprovar)', () => {
  const ts = gerarF([fat({ id: 'f5', vencimento: '2026-10-30', anexos: doc('2026-10-16T10:00:00Z'), conferencia: { em: '2026-10-17T10:00:00Z', checks: [chk] } })]);
  const d = deF(ts, 'A38')[0];
  assert.ok(d && d.funcao === 'IMPORTACAO' && /1 diferença sem decisão/.test(d.detalhe) && !d.andamento);
  assert.strictEqual(deF(ts, 'A39').length, 0);
});
teste('diferença contestada: fica "em andamento" (aguardando o fornecedor), não atrasada', () => {
  const conf = { em: '2026-10-10T10:00:00Z', checks: [chk], decisoes: { [FC.chaveCheck(chk)]: { acao: 'contestada' } } };
  const d = deF(gerarF([fat({ id: 'f6', vencimento: '2026-10-15', anexos: doc('2026-10-09T10:00:00Z'), conferencia: conf })]), 'A38')[0];
  assert.ok(d && d.andamento && /aguardando a fatura corrigida/.test(d.detalhe));
  assert.strictEqual(A.classificar(d, HF), 'andamento');
});
teste('diferença aceita: decisão some e vai pra aprovação', () => {
  const conf = { em: '2026-10-17T10:00:00Z', checks: [chk], decisoes: { [FC.chaveCheck(chk)]: { acao: 'aceita', motivo: 'combinado' } } };
  const ts = gerarF([fat({ id: 'f7', vencimento: '2026-10-30', anexos: doc('2026-10-16T10:00:00Z'), conferencia: conf })]);
  assert.strictEqual(deF(ts, 'A38').length, 0);
  assert.ok(/1 diferença aceita/.test(deF(ts, 'A39')[0].detalhe));
});
teste('aprovada: só o pagamento continua (Financeiro, "aprovada")', () => {
  const ts = gerarF([fat({ id: 'f8', vencimento: '2026-10-30', anexos: doc('2026-10-16T10:00:00Z'), conferencia: { em: '2026-10-17', checks: [] }, aprovacao: { por: 'gerente.teste', em: '2026-10-18T10:00:00Z' } })]);
  assert.deepStrictEqual(ts.filter(t => /^A(37|38|39|40)$/.test(t.codigo)).map(t => t.codigo), ['A40']);
  assert.ok(/aprovada/.test(deF(ts, 'A40')[0].detalhe));
});
teste('paga: nada em aberto; na aba do processo aparece como concluída automaticamente', () => {
  const f = fat({ id: 'f9', status: 'paga', valor_pago: 1000, vencimento: '2026-10-20', anexos: doc('2026-10-16T10:00:00Z'), aprovacao: { em: '2026-10-18' }, pagamentos: [{ id: 'p', data: '2026-10-20', valor: 1000 }] });
  assert.strictEqual(gerarF([f]).filter(t => /^A(37|38|39|40)$/.test(t.codigo)).length, 0);
  const t = deF(gerarF([f], { incluirFeitas: true }), 'A40')[0];
  assert.ok(t && t.status === 'feita' && t.automatica);
});

// numerário: pago, acerto do mesmo despachante em aberto → abater; acerto pago → sobra
const numer = (x) => fat(Object.assign({ id: 'n1', numero: '000010/26', empresa_nome: DESP, itens: [], origem: { tipo: 'numerario', processo_id: 'pf1', referencia: 'TESTE-FAT-1' },
  valor: 5000, status: 'paga', valor_pago: 5000, vencimento: '2026-10-10', pagamentos: [{ id: 'pn', data: '2026-10-10', valor: 5000 }] }, x || {}));
const acerto = (x) => fat(Object.assign({ id: 'ac1', numero: '000011/26', empresa_nome: DESP, valor: 4200, vencimento: '2026-10-28', anexos: doc('2026-10-20T10:00:00Z'),
  itens: [{ processo_id: 'pf1', referencia: 'TESTE-FAT-1', taxa: 'honorarios', valor: 4200 }] }, x || {}));
teste('numerário pago + acerto em aberto: Financeiro abate (até o vencimento do acerto) e o acerto avisa que dá pra abater', () => {
  const ts = gerarF([numer(), acerto()]);
  const t = deF(ts, 'A41')[0];
  assert.ok(t && t.funcao === 'FINANCEIRO' && t.prazo === '2026-10-28');
  assert.ok(/Abater R\$ 4\.200,00 do numerário 000010\/26 no acerto 000011\/26 \(sobram R\$ 800,00 pra devolver\)/.test(t.detalhe), t.detalhe);
  assert.ok(/numerário de R\$ 5\.000,00 pra abater/.test(deF(ts, 'A40').find(x => x.detalhe.includes('000011/26')).detalhe));
});
teste('acerto quitado por compensação e sobrou numerário: pede a devolução (5 dias depois do acerto)', () => {
  const ac = acerto({ status: 'paga', valor_pago: 4200, pagamentos: [{ id: 'pc', data: '2026-10-20', valor: 4200, forma: 'compensacao', compensa: { tipo: 'numerario', fatura_id: 'n1' } }] });
  const t = deF(gerarF([numer(), ac]), 'A41')[0];
  assert.ok(t && /Sobra de R\$ 800,00/.test(t.detalhe) && t.prazo === '2026-10-25');
});
teste('devolução lançada: numerário acertado e a devolução vira "Receber" do Financeiro', () => {
  const ac = acerto({ status: 'paga', valor_pago: 4200, pagamentos: [{ id: 'pc', data: '2026-10-20', valor: 4200, forma: 'compensacao', compensa: { tipo: 'numerario', fatura_id: 'n1' } }] });
  const dev = fat({ id: 'd1', tipo: 'receber', empresa_nome: DESP, itens: [], valor: 800, vencimento: '2026-10-30', origem: { tipo: 'devolucao_numerario', processo_id: 'pf1', numerario_id: 'n1' } });
  const ts = gerarF([numer(), ac, dev]);
  assert.strictEqual(deF(ts, 'A41').length, 0);
  const r = deF(ts, 'A42')[0];
  assert.ok(r && r.funcao === 'FINANCEIRO' && /devolução de numerário/.test(r.detalhe) && r.prazo === '2026-10-30');
});
teste('numerário: gerente aprova antes de pagar; sem acerto ainda, não cobra o acerto', () => {
  const ts = gerarF([numer({ status: 'aberta', valor_pago: 0, pagamentos: [], vencimento: '2026-10-24' })]);
  assert.ok(deF(ts, 'A39')[0] && /numerário/.test(deF(ts, 'A39')[0].detalhe));
  assert.ok(deF(ts, 'A40')[0] && /numerário \(adiantamento\)/.test(deF(ts, 'A40')[0].detalhe));
  assert.strictEqual(deF(ts, 'A37').length, 0, 'numerário não se confere taxa a taxa');
  assert.strictEqual(deF(ts, 'A41').length, 0);
});

// a receber: venda a prazo é da A26 (vira automática), adiantamento de câmbio é da A42
const PV = Object.assign({}, PF, { vendas_json: JSON.stringify([{ cliente: 'CLIENTE FICTICIO LTDA', nf_saida_numero: '9001', nf_saida_data: '2026-10-10', nf_saida_valor: 2000, forma_pagamento: 'parcelado', prazo_texto: '30/60' }]) });
const recVenda = (n, venc, extra) => fat(Object.assign({ id: 'rv' + n, numero: '00002' + n + '/26', tipo: 'receber', empresa_nome: 'CLIENTE FICTICIO LTDA', itens: [], valor: 1000, vencimento: venc,
  origem: { tipo: 'venda', processo_id: 'pf1', referencia: 'TESTE-FAT-1', idx: 0, parcela: n, de: 2 } }, extra || {}));
teste('venda parcelada com faturas a receber: A26 fica automática, prazo = próxima parcela, sem tarefa duplicada', () => {
  const ts = gerarF([recVenda(1, '2026-11-09'), recVenda(2, '2026-12-09')], null, [PV]);
  const t = deF(ts, 'A26')[0];
  assert.ok(t && t.auto && t.prazo === '2026-11-09' && /0 de 2 parcelas recebidas/.test(t.detalhe), t && t.detalhe);
  assert.strictEqual(deF(ts, 'A42').length, 0);
});
teste('todas as parcelas recebidas: A26 conclui sozinha', () => {
  const pago = { status: 'paga', valor_pago: 1000, pagamentos: [{ id: 'x', data: '2026-10-20', valor: 1000 }] };
  const ts = gerarF([recVenda(1, '2026-11-09', pago), recVenda(2, '2026-12-09', pago)], { incluirFeitas: true }, [PV]);
  const t = deF(ts, 'A26')[0];
  assert.ok(t && t.status === 'feita' && t.automatica);
});
teste('venda sem fatura a receber: A26 continua manual como antes (prazo = NF + maior prazo)', () => {
  const t = deF(gerarF([], null, [PV]), 'A26')[0];
  assert.ok(t && !t.auto && t.prazo === '2026-12-09');
});
teste('adiantamento do câmbio a receber: tarefa A42 do Financeiro no vencimento', () => {
  const r = fat({ id: 'rc1', tipo: 'receber', empresa_nome: 'CLIENTE FICTICIO LTDA', itens: [], valor: 5400, vencimento: '2026-10-23', origem: { tipo: 'parcela_cambio', processo_id: 'pf1', idx: -1 } });
  const t = deF(gerarF([r]), 'A42')[0];
  assert.ok(t && t.prazo === '2026-10-23' && /adiantamento do câmbio/.test(t.detalhe) && /R\$ 5\.400,00/.test(t.detalhe));
});
teste('processo FECHADO: dinheiro em aberto continua na agenda, o resto não', () => {
  const ts = gerarF([fat({ id: 'f10', vencimento: '2026-10-30', anexos: doc('2026-10-16T10:00:00Z'), aprovacao: { em: '2026-10-18' } })], null, [Object.assign({}, PF, { fechado: true })]);
  assert.deepStrictEqual([...new Set(ts.filter(t => t.processoId).map(t => t.codigo))], ['A40']);
});
teste('fatura de 2 processos: a tarefa aparece só no processo dono (maior parte)', () => {
  const f = fat({ id: 'f11', vencimento: '2026-10-30', anexos: doc('2026-10-16T10:00:00Z'), itens: [{ processo_id: 'pf1', valor: 100 }, { processo_id: 'pf2', valor: 900 }] });
  const ts = gerarF([f], null, [PF, { id: 'pf2', referencia: 'TESTE-FAT-2', created_at: '2026-10-01' }]);
  assert.deepStrictEqual(deF(ts, 'A37').map(t => t.referencia), ['TESTE-FAT-2']);
});
teste('prazo da Lista (dias em relação ao vencimento) vale pras tarefas de fatura', () => {
  const c = A.montarConfig({ agenda_atividade: [{ codigo: 'A40', nome: 'Pagar', dados: { funcao: 'FINANCEIRO', prazo_dias: -2 } }] });
  const t = deF(A.gerarTarefas([PF], { hoje: HF, cfg: c, faturas: FC.faturasParaAgenda([fat({ id: 'f12', vencimento: '2026-10-30', anexos: doc('2026-10-16') })]) }), 'A40')[0];
  assert.strictEqual(t.prazo, '2026-10-28');
});
teste('servidor: carregarFaturasAgenda lê a tabela (sem canceladas) e o histórico registra a tarefa de pagar', async () => {
  const estado = { controle_processos: [PF], agenda_conclusoes: [], agenda_historico: [],
    faturas: [fat({ id: 'f13', vencimento: '2026-10-30', anexos: doc('2026-10-16'), aprovacao: { em: '2026-10-18' } }), fat({ id: 'f14', status: 'cancelada', vencimento: '2026-10-30' })] };
  const sb = sbFalso(estado);
  const r = await S.carregarFaturasAgenda(sb);
  assert.deepStrictEqual(r.faturas.map(f => f.id), ['f13']);
  await S.atualizarHistorico({ sb, carregarListas: async () => ({ listas: null }) }, { hoje: HF });
  assert.ok(estado.agenda_historico.some(h => h.codigo === 'A40' && h.chave === A.chaveTarefa('A40', 'pf1', 'f13')));
});

setTimeout(() => {
  console.log(`\n════════════════════════════════════════`);
  console.log(`RESULTADO: ${passou} passaram, ${falhou} falharam`);
  console.log(`════════════════════════════════════════\n`);
  if (falhou > 0) process.exit(1);
}, 300);
