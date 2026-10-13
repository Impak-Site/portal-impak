/**
 * TESTES — agenda-core.js (Agenda de atividades por etapa, #675)
 * Roda com: node testes_agenda.js   (valores fictícios)
 */
const assert = require('assert');
const A = require('./agenda-core.js');
let passou = 0, falhou = 0;
function teste(nome, fn) { try { fn(); passou++; console.log(`  ✓ ${nome}`); } catch (e) { falhou++; console.log(`  ✗ ${nome}`); console.log(`    ${e.message}`); } }
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

console.log(`\n════════════════════════════════════════`);
console.log(`RESULTADO: ${passou} passaram, ${falhou} falharam`);
console.log(`════════════════════════════════════════\n`);
if (falhou > 0) process.exit(1);
