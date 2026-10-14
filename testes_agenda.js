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
teste('35 atividades padrão e 8 funções', () => { assert.strictEqual(Object.keys(cfg.atividades).length, 35); assert.strictEqual(Object.keys(cfg.funcoes).length, 8); });
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
    api.select = () => api; api.order = () => api; api.gte = () => api; api.eq = (c, v) => { api._f.push([c, v]); return api; };
    api.then = (res) => res({ data: (estado[tabela] || []).filter(r => api._f.every(([c, v]) => r[c] === v)), error: null });
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

setTimeout(() => {
  console.log(`\n════════════════════════════════════════`);
  console.log(`RESULTADO: ${passou} passaram, ${falhou} falharam`);
  console.log(`════════════════════════════════════════\n`);
  if (falhou > 0) process.exit(1);
}, 300);
