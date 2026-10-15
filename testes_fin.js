// testes_fin.js — regras de fin-core.js (valores fictícios).
const assert = require('assert');
const F = require('./fin-core.js');

let ok = 0, falhas = 0;
function teste(nome, fn) {
  try { fn(); ok++; console.log('  ✓ ' + nome); }
  catch (e) { falhas++; console.log('  ✗ ' + nome + '\n      ' + (e.message || e)); }
}
const CONTAS = F.PLANO_PADRAO.map(([codigo, nome, grupo]) => ({ id: 'c' + codigo, codigo, nome, grupo }));

console.log('\n── cadastros ──');
teste('validarConta / validarBanco / validarTransferencia', () => {
  assert.strictEqual(F.validarConta({ codigo: '5.1.10', nome: 'Seguros', grupo: 'despesa_operacional' }).ok, true);
  assert.strictEqual(F.validarConta({ codigo: '5.1.10', nome: 'X', grupo: 'xpto' }).ok, false);
  const b = F.validarBanco({ nome: 'Banco Exemplo movimento', saldo_inicial: '10.000,50', saldo_inicial_em: '2026-10-01' });
  assert.strictEqual(b.banco.saldo_inicial, 10000.5);
  assert.strictEqual(F.validarTransferencia({ data: '2026-10-10', de_banco_id: 'a', para_banco_id: 'a', valor: 1 }).ok, false);
  assert.strictEqual(F.validarTransferencia({ data: '2026-10-10', de_banco_id: 'a', para_banco_id: 'b', valor: '1.000,00' }).transf.valor, 1000);
});
teste('addMeses respeita fim de mês', () => {
  assert.strictEqual(F.addMeses('2026-01-31', 1), '2026-02-28');
  assert.strictEqual(F.addMeses('2026-10-10', 3), '2027-01-10');
});
teste('contaPadraoPorTaxa', () => {
  assert.strictEqual(F.contaPadraoPorTaxa('fob'), '4.2.01');
  assert.strictEqual(F.contaPadraoPorTaxa('frete'), '4.2.02');
  assert.strictEqual(F.contaPadraoPorTaxa('ii'), '4.2.03');
  assert.strictEqual(F.contaPadraoPorTaxa('capatazia'), '4.2.04');
  assert.strictEqual(F.contaPadraoPorTaxa('comissao_br'), '4.2.06');
});

console.log('\n── saldos bancários ──');
teste('saldo = inicial + recebimentos − pagamentos ± transferências', () => {
  const bancos = [{ id: 'b1', nome: 'A', moeda: 'BRL', saldo_inicial: 1000, saldo_inicial_em: '2026-10-01' }, { id: 'b2', nome: 'B', moeda: 'BRL', saldo_inicial: 0 }];
  const fats = [
    { tipo: 'receber', moeda: 'BRL', status: 'paga', pagamentos: [{ data: '2026-10-05', valor: 500, banco_id: 'b1' }] },
    { tipo: 'pagar', moeda: 'BRL', status: 'aberta', pagamentos: [{ data: '2026-10-06', valor: 200, juros: 10, banco_id: 'b1' }, { data: '2026-09-20', valor: 999, banco_id: 'b1' }, { data: '2026-10-07', valor: 50 }] },
  ];
  const tr = [{ data: '2026-10-08', de_banco_id: 'b1', para_banco_id: 'b2', valor: 300 }];
  const r = F.saldosBancarios(bancos, fats, tr, {});
  const b1 = r.contas.find(c => c.id === 'b1'), b2 = r.contas.find(c => c.id === 'b2');
  assert.strictEqual(b1.saldo, 1000 + 500 - 210 - 300, 'pagamento antes do saldo inicial fica de fora');
  assert.strictEqual(b2.saldo, 300);
  assert.strictEqual(r.semBanco.saidas, 50);
});

console.log('\n── DRE ──');
teste('DRE caixa: rateio por taxa, juros, variação cambial, conta explícita', () => {
  const fats = [
    { tipo: 'receber', moeda: 'BRL', status: 'paga', origem: { tipo: 'venda' }, valor: 10000, pagamentos: [{ data: '2026-10-05', valor: 10000 }] },
    { tipo: 'pagar', moeda: 'BRL', status: 'paga', valor: 1000, itens: [{ taxa: 'capatazia', valor: 600 }, { taxa: 'ii', valor: 400 }], pagamentos: [{ data: '2026-10-06', valor: 1000, juros: 20 }] },
    { tipo: 'pagar', moeda: 'USD', cambio: 5, status: 'paga', valor: 100, itens: [{ taxa: 'frete', valor: 100 }], pagamentos: [{ data: '2026-10-07', valor: 100, cambio_efetivo: 5.2, pago_brl: 520 }] },
    { tipo: 'pagar', moeda: 'BRL', status: 'paga', valor: 3000, conta_id: 'c5.1.03', pagamentos: [{ data: '2026-10-10', valor: 3000 }] },
    { tipo: 'pagar', moeda: 'BRL', status: 'paga', valor: 999, pagamentos: [{ data: '2026-11-10', valor: 999 }] },
  ];
  const d = F.dreEmpresa(fats, CONTAS, { de: '2026-10-01', ate: '2026-10-31', regime: 'caixa' });
  const g = id => d.grupos.find(x => x.id === id);
  assert.strictEqual(g('receita_bruta').total, 10000);
  assert.strictEqual(g('custo').total, 600 + 400 + 500);
  assert.strictEqual(g('despesa_operacional').total, 3000);
  assert.strictEqual(g('despesa_financeira').total, 20 + 20, 'juros 20 + variação cambial 20');
  assert.strictEqual(d.resultadoLiquido, 10000 - 1500 - 3000 - 40);
});
teste('DRE competência usa emissão e valor total', () => {
  const fats = [{ tipo: 'pagar', moeda: 'BRL', status: 'aberta', valor: 500, emissao: '2026-10-02', conta_id: 'c5.1.05', pagamentos: [] }];
  const d = F.dreEmpresa(fats, CONTAS, { de: '2026-10-01', ate: '2026-10-31', regime: 'competencia' });
  assert.strictEqual(d.grupos.find(x => x.id === 'despesa_operacional').total, 500);
  assert.strictEqual(F.dreEmpresa(fats, CONTAS, { de: '2026-10-01', ate: '2026-10-31' }).resultadoLiquido, 0, 'caixa: nada pago');
});
teste('conta neutra não entra no resultado', () => {
  const fats = [{ tipo: 'pagar', moeda: 'BRL', status: 'paga', valor: 700, conta_id: 'c9.1.01', pagamentos: [{ data: '2026-10-10', valor: 700 }] }];
  assert.strictEqual(F.dreEmpresa(fats, CONTAS, { de: '2026-10-01', ate: '2026-10-31' }).resultadoLiquido, 0);
});

console.log('\n── lançamentos p/ contador ──');
teste('pagamento gera débito na conta e crédito no banco (+ juros e retenções)', () => {
  const bancos = [{ id: 'b1', nome: 'A', conta_contabil: '1.1.2.01' }];
  const contas = CONTAS.map(c => c.codigo === '5.1.03' ? { ...c, conta_contabil: '4.2.1.05' } : c);
  const fats = [{ numero: '000001/26', tipo: 'pagar', moeda: 'BRL', status: 'paga', valor: 1000, conta_id: 'c5.1.03', empresa_nome: 'Imobiliária Exemplo', documento: '55',
    pagamentos: [{ data: '2026-10-10', valor: 985, juros: 7, retencoes: { irrf: 15 }, banco_id: 'b1' }] }];
  const l = F.lancamentosContabeis(fats, contas, bancos, { de: '2026-10-01', ate: '2026-10-31' });
  assert.deepStrictEqual(l.map(x => [x.debito, x.credito, x.valor]), [['4.2.1.05', '1.1.2.01', 985], ['4.2.1.05', '9.1.01', 15], ['5.2.02', '1.1.2.01', 7]]);
});

console.log('\n── importação Conexos ──');
teste('adivinharColunas reconhece cabeçalhos comuns', () => {
  const m = F.adivinharColunas(['Tipo', 'Pessoa', 'CNPJ', 'Nº Documento', 'Emissão', 'Vencimento', 'Valor', 'Saldo', 'Histórico']);
  assert.deepStrictEqual([m.tipo, m.empresa, m.cnpj, m.documento, m.emissao, m.vencimento, m.valor, m.saldo, m.obs], [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});
teste('linhaParaFatura: datas BR, valores BR, saldo parcial, quitado, tipo', () => {
  const m = { tipo: 0, empresa: 1, documento: 2, vencimento: 3, valor: 4, saldo: 5 };
  const r = F.linhaParaFatura(['CP', 'Fornecedor Teste', 'NF 10', '20/11/2026', '1.500,00', '500,00'], m);
  assert.strictEqual(r.ok, true); assert.strictEqual(r.fatura.tipo, 'pagar'); assert.strictEqual(r.fatura.vencimento, '2026-11-20');
  assert.strictEqual(r.fatura.valor, 1500); assert.strictEqual(r.jaPago, 1000);
  assert.strictEqual(F.linhaParaFatura(['CR', 'Cliente', 'X', '01/12/2026', '100', '0'], m).quitado, true);
  assert.strictEqual(F.linhaParaFatura(['', 'Cliente', 'X', '01/12/2026', '100', ''], m, { tipoPadrao: 'receber' }).fatura.tipo, 'receber');
  assert.strictEqual(F.dataPlanilha(46316), '2026-10-21', 'data serial do Excel');
});
teste('chaveImportacao evita duplicar', () => {
  const a = F.linhaParaFatura(['CP', 'Fornecedor Teste', 'NF 10', '20/11/2026', '1.500,00', ''], { tipo: 0, empresa: 1, documento: 2, vencimento: 3, valor: 4 }).fatura;
  const b = F.linhaParaFatura(['P', 'FORNECEDOR TESTE', 'NF-10', '20/11/2026', '1500', ''], { tipo: 0, empresa: 1, documento: 2, vencimento: 3, valor: 4 }).fatura;
  assert.strictEqual(F.chaveImportacao(a), F.chaveImportacao(b));
});

console.log('\n── classificação e recorrência ──');
teste('precisaClassificar: só despesa avulsa sem conta', () => {
  assert.strictEqual(F.precisaClassificar({ tipo: 'pagar', itens: [] }), true);
  assert.strictEqual(F.precisaClassificar({ tipo: 'pagar', conta_id: 'x', itens: [] }), false);
  assert.strictEqual(F.precisaClassificar({ tipo: 'pagar', itens: [{ referencia: 'TESTE-01' }] }), false);
  assert.strictEqual(F.precisaClassificar({ tipo: 'receber', itens: [] }), false);
});
teste('sugerirConta pelo texto', () => {
  assert.strictEqual(F.sugerirConta('Imobiliária Exemplo - aluguel outubro'), '5.1.03');
  assert.strictEqual(F.sugerirConta('Guia FGTS'), '5.1.10');
  assert.strictEqual(F.sugerirConta('Folha de pagamento'), '5.1.01');
  assert.strictEqual(F.sugerirConta('Pró-labore sócios'), '5.1.02');
  assert.strictEqual(F.sugerirConta('DARF IRPJ trimestral'), '6.1.01');
  assert.strictEqual(F.sugerirConta('ICMS apuração'), '4.1.02');
  assert.strictEqual(F.sugerirConta('Tarifa bancária'), '5.2.01');
  assert.strictEqual(F.sugerirConta('Fornecedor Teste'), null);
});
teste('validarRecorrencia exige classificação e 1º vencimento', () => {
  const base = { descricao: 'Aluguel', empresa_nome: 'Imobiliária Exemplo', valor: '3.000,00', conta_id: 'c', inicio: '2026-11-05' };
  assert.strictEqual(F.validarRecorrencia(base).ok, true);
  assert.strictEqual(F.validarRecorrencia({ ...base, conta_id: '' }).ok, false);
  assert.strictEqual(F.validarRecorrencia({ ...base, inicio: '' }).ok, false);
  assert.strictEqual(F.validarRecorrencia({ ...base, fim: '2026-10-01' }).ok, false);
  assert.strictEqual(F.validarRecorrencia(base).recorrencia.valor, 3000);
});
teste('faturasDaRecorrencia: horizonte, fim, sem duplicar, 1ª sempre sai', () => {
  const r = F.validarRecorrencia({ descricao: 'Aluguel', empresa_nome: 'Imobiliária Exemplo', valor: 3000, conta_id: 'c', inicio: '2026-10-31', antecedencia_dias: 50 }).recorrencia;
  const g = F.faturasDaRecorrencia(r, [], '2026-10-14');
  assert.deepStrictEqual(g.map(x => x.fatura.vencimento), ['2026-10-31', '2026-11-30']);
  assert.strictEqual(g[0].fatura.documento, 'Aluguel 10/2026');
  assert.deepStrictEqual(F.faturasDaRecorrencia(r, ['2026-10'], '2026-10-14').map(x => x.competencia), ['2026-11']);
  // dia 31 volta a 31 depois de fevereiro
  assert.strictEqual(F.vencimentosRecorrencia(r, '2027-03-31').map(x => x.vencimento).pop(), '2027-03-31');
  const tri = { ...r, frequencia: 'trimestral', inicio: '2027-01-20', antecedencia_dias: 10, fim: '2027-06-30' };
  assert.deepStrictEqual(F.faturasDaRecorrencia(tri, [], '2026-10-14').map(x => x.fatura.vencimento), ['2027-01-20'], '1ª sai mesmo fora do horizonte');
  assert.deepStrictEqual(F.vencimentosRecorrencia(tri, '2028-01-01').map(x => x.vencimento), ['2027-01-20', '2027-04-20']);
  assert.deepStrictEqual(F.faturasDaRecorrencia({ ...r, ativo: false }, [], '2026-10-14'), []);
  assert.strictEqual(F.proximoVencimento(r, '2026-11-01'), '2026-11-30');
  const varv = F.faturasDaRecorrencia({ ...r, valor_variavel: true }, [], '2026-10-14')[0].fatura;
  assert.ok(/estimado/.test(varv.obs));
});

console.log(`\n──────────────────────────────────────────────────\nTotal: ${ok + falhas} testes, ${ok} passaram, ${falhas} falharam`);
if (falhas) process.exit(1);
