/**
 * TESTES AUTOMATIZADOS — lib/validacao-documento.js (CNPJ/CPF por tipo/país)
 * ════════════════════════════════════════════════════════════════
 * Roda com: node testes_cadastros.js
 *
 * Cobre a regra pedida pelo Ayslan (12/09/2026) pra tela de Cadastros:
 * empresa brasileira exige CNPJ válido, pessoa física brasileira exige
 * CPF válido, e qualquer documento do exterior passa sem regra (ainda).
 */

const assert = require('assert');
const { digitoVerificadorValido_CPF, digitoVerificadorValido_CNPJ, validarDocumento } = require('./lib/validacao-documento.js');

let passou = 0, falhou = 0;
function teste(nome, fn) {
  try { fn(); passou++; console.log(`  ✓ ${nome}`); }
  catch (e) { falhou++; console.log(`  ✗ ${nome}`); console.log(`    ${e.message}`); }
}

console.log('\n── CPF ──');

teste('CPF válido conhecido (111.444.777-35)', () => {
  assert.strictEqual(digitoVerificadorValido_CPF('111.444.777-35'), true);
});
teste('CPF com todos os dígitos iguais é inválido', () => {
  assert.strictEqual(digitoVerificadorValido_CPF('111.111.111-11'), false);
});
teste('CPF com dígito verificador errado é inválido', () => {
  assert.strictEqual(digitoVerificadorValido_CPF('111.444.777-36'), false);
});
teste('CPF com tamanho errado é inválido', () => {
  assert.strictEqual(digitoVerificadorValido_CPF('123456'), false);
});

console.log('\n── CNPJ ──');

teste('CNPJ válido conhecido (11.222.333/0001-81)', () => {
  assert.strictEqual(digitoVerificadorValido_CNPJ('11.222.333/0001-81'), true);
});
teste('CNPJ com todos os dígitos iguais é inválido', () => {
  assert.strictEqual(digitoVerificadorValido_CNPJ('11.111.111/1111-11'), false);
});
teste('CNPJ com dígito verificador errado é inválido', () => {
  assert.strictEqual(digitoVerificadorValido_CNPJ('11.222.333/0001-82'), false);
});

console.log('\n── validarDocumento (regra por tipo de pessoa/país) ──');

teste('Jurídica + Brasil + CNPJ válido: sem erro', () => {
  assert.strictEqual(validarDocumento('JURIDICA', 'Brasil', '11.222.333/0001-81'), null);
});
teste('Jurídica + Brasil + sem CNPJ: exige documento', () => {
  assert.ok(validarDocumento('JURIDICA', 'Brasil', '').includes('CNPJ'));
});
teste('Jurídica + Brasil + CNPJ inválido: rejeita', () => {
  assert.ok(validarDocumento('JURIDICA', 'Brasil', '11.222.333/0001-82').includes('inválido'));
});
teste('Física + Brasil + CPF válido: sem erro', () => {
  assert.strictEqual(validarDocumento('FISICA', 'Brasil', '111.444.777-35'), null);
});
teste('Física + Brasil + sem CPF: exige documento', () => {
  assert.ok(validarDocumento('FISICA', 'Brasil', '').includes('CPF'));
});
teste('Física + Brasil + CPF inválido: rejeita', () => {
  assert.ok(validarDocumento('FISICA', 'Brasil', '111.111.111-11').includes('inválido'));
});
teste('Jurídica + exterior + sem documento: sem regra (passa)', () => {
  assert.strictEqual(validarDocumento('JURIDICA', 'China', ''), null);
});
teste('Física + exterior + documento qualquer: sem regra (passa)', () => {
  assert.strictEqual(validarDocumento('FISICA', 'Estados Unidos', 'abc123'), null);
});
teste('País vazio assume Brasil (mantém a regra)', () => {
  assert.ok(validarDocumento('JURIDICA', '', '').includes('CNPJ'));
});

// ════════════════════════════════════════════════════════════════
// lib/cadastros-normalizar.js + listas-padrao.js (cadastros fase 1b, 01/10/2026)
// Padronização dos campos texto livre do processo pelos cadastros/listas.
// ════════════════════════════════════════════════════════════════
const N = require('./lib/cadastros-normalizar.js');
const ListasPadrao = require('./listas-padrao.js');

const EMPRESAS = [
  { razao_social: 'PACIFIC INTERNATIONAL LINES', nome_fantasia: 'PIL', tipo: 'ARMADOR', papeis: ['ARMADOR'], sinonimos: ['PILL', 'PIL SHIPPING'] },
  { razao_social: 'COSCO SHIPPING LINES CO LTD', nome_fantasia: 'COSCO', tipo: 'ARMADOR' },
  { razao_social: 'ROYAL CARGO DO BRASIL', nome_fantasia: 'ROYAL', tipo: 'AGENTE' },
  { razao_social: 'FIND COMEX LOGISTC ASSESORIA ADUANEIRA LTDA', nome_fantasia: 'FIND COMEX', tipo: 'DESPACHANTE', sinonimos: ['FIND COMEX LOGISTIC ASSESSORIA ADUANEIRA LTDA'] },
  { razao_social: 'RF LOGISTICA LTDA', nome_fantasia: 'RF LOGISTICA LTDA', tipo: 'TRANSPORTADORA', papeis: ['TRANSPORTADORA', 'ARMAZEM_ALFANDEGADO'], sinonimos: ['RF LOGÍSTICA', 'R & F LOG'] },
  { razao_social: 'LECHMAN TERMINAIS LTDA', nome_fantasia: 'LECHMAN TERMINAIS (NAVEGANTES)', tipo: 'DEPOT_DEVOLUCAO', sinonimos: ['LECHMAN', 'LACHMAN', 'LECHMAN TERMINAIS NAVEGANTES'] },
  { razao_social: 'PORTONAVE S/A - TERMINAIS PORTUARIOS DE NAVEGANTES', nome_fantasia: 'PORTONAVE', tipo: 'ARMAZEM_ALFANDEGADO', papeis: ['ARMAZEM_ALFANDEGADO', 'PORTO_ARMAZEM'] },
  { razao_social: 'EMPRESA INATIVA', nome_fantasia: 'INATIVA', tipo: 'ARMADOR', ativo: false, sinonimos: ['PIL'] },
];
const IDX = N.montarIndice(EMPRESAS, ListasPadrao.listasPadrao());

console.log('\n── chaveNormalizada ──');
teste('ignora acento, caixa, pontuação e espaços extras', () => {
  assert.strictEqual(N.chaveNormalizada('  Itajaí '), 'ITAJAI');
  assert.strictEqual(N.chaveNormalizada('CMA-CGM'), N.chaveNormalizada('CMA CGM'));
  assert.strictEqual(N.chaveNormalizada('HMM CO., LTD.'), 'HMM CO LTD');
  assert.strictEqual(N.chaveNormalizada(null), '');
});

console.log('\n── normalizarValorCampo (empresas) ──');
teste('armador: sinônimo e razão social viram o nome curto (nome fantasia)', () => {
  assert.strictEqual(N.normalizarValorCampo('armador', 'PILL', IDX), 'PIL');
  assert.strictEqual(N.normalizarValorCampo('armador', 'Pil Shipping', IDX), 'PIL');
  assert.strictEqual(N.normalizarValorCampo('armador', 'pacific international lines', IDX), 'PIL');
  assert.strictEqual(N.normalizarValorCampo('armador', 'COSCO SHIPPING LINES CO LTD', IDX), 'COSCO');
});
teste('agente: canônico é a razão social', () => {
  assert.strictEqual(N.normalizarValorCampo('agente', 'ROYAL', IDX), 'ROYAL CARGO DO BRASIL');
});
teste('despachante/depot/armazém: canônico é o nome curto (nome fantasia), como armador', () => {
  assert.strictEqual(N.normalizarValorCampo('despachante', 'FIND COMEX LOGISTC ASSESORIA ADUANEIRA LTDA', IDX), 'FIND COMEX');
  assert.strictEqual(N.normalizarValorCampo('despachante', 'FIND COMEX LOGISTIC ASSESSORIA ADUANEIRA LTDA', IDX), 'FIND COMEX');
  assert.strictEqual(N.normalizarValorCampo('depot', 'LACHMAN', IDX), 'LECHMAN TERMINAIS (NAVEGANTES)');
  assert.strictEqual(N.normalizarValorCampo('depot', 'Lechman Terminais Ltda', IDX), 'LECHMAN TERMINAIS (NAVEGANTES)');
  assert.strictEqual(N.normalizarValorCampo('armazem', 'portonave', IDX), 'PORTONAVE');
  assert.strictEqual(N.normalizarValorCampo('armazem', 'PORTONAVE S/A - TERMINAIS PORTUARIOS DE NAVEGANTES', IDX), 'PORTONAVE');
});
teste('papéis múltiplos: RF LOGISTICA vale como transportadora E armazém', () => {
  assert.strictEqual(N.normalizarValorCampo('transportadora', 'rf logistica ltda', IDX), 'RF LOGISTICA LTDA');
  assert.strictEqual(N.normalizarValorCampo('transportadora', 'R & F LOG', IDX), 'RF LOGISTICA LTDA');
  assert.strictEqual(N.normalizarValorCampo('armazem', 'RF LOGÍSTICA', IDX), 'RF LOGISTICA LTDA');
});
teste('não cruza papéis: "ROYAL" no campo armador não vira o agente', () => {
  assert.strictEqual(N.normalizarValorCampo('armador', 'ROYAL', IDX), 'ROYAL');
});
teste('valor desconhecido fica exatamente como veio', () => {
  assert.strictEqual(N.normalizarValorCampo('armador', 'Parisi Grand Smooth Logistics Ltd.', IDX), 'Parisi Grand Smooth Logistics Ltd.');
  assert.strictEqual(N.normalizarValorCampo('transportadora', 'TRANSPORTES ZECA', IDX), 'TRANSPORTES ZECA');
  assert.strictEqual(N.normalizarValorCampo('armador', '', IDX), '');
  assert.strictEqual(N.normalizarValorCampo('armador', null, IDX), null);
});
teste('cadastro inativo não entra no índice (sinônimo "PIL" da inativa não gera ambiguidade)', () => {
  assert.strictEqual(N.normalizarValorCampo('armador', 'PIL', IDX), 'PIL');
});
teste('grafia ambígua (2 cadastros ativos no mesmo papel) não é padronizada', () => {
  const idx = N.montarIndice([
    { razao_social: 'ALFA LOGISTICA', tipo: 'AGENTE', sinonimos: ['ALFA'] },
    { razao_social: 'ALFA TRANSPORTES INTERNACIONAIS', tipo: 'AGENTE', sinonimos: ['ALFA'] },
  ], ListasPadrao.listasPadrao());
  assert.strictEqual(N.normalizarValorCampo('agente', 'ALFA', idx), 'ALFA');
  assert.strictEqual(N.normalizarValorCampo('agente', 'alfa logistica', idx), 'ALFA LOGISTICA');
});

console.log('\n── normalizarValorCampo (listas) ──');
teste('porto de origem: 8 grafias de Ho Chi Minh viram o código', () => {
  ['Ho Chi Minh Port, Vietnam', 'HO CHI MINH CITY PORT, VIETNAM', 'HOCHIMINH, VIETNAM', 'HO CHI MINH - VIETNAM', 'ho chi minh'].forEach(v => {
    assert.strictEqual(N.normalizarValorCampo('porto_origem', v, IDX), 'HO CHI MINH', v);
  });
  assert.strictEqual(N.normalizarValorCampo('porto_origem', 'Qingdao, CHINA', IDX), 'QINGDAO');
  assert.strictEqual(N.normalizarValorCampo('porto_origem', 'SEMARANG PORT, INDONESIA', IDX), 'SEMARANG');
  assert.strictEqual(N.normalizarValorCampo('porto_origem', 'Many, China', IDX), 'Many, China');
});
teste('porto de destino: nome, sinônimo e código', () => {
  assert.strictEqual(N.normalizarValorCampo('porto_destino', 'Itajaí', IDX), 'ITJ');
  assert.strictEqual(N.normalizarValorCampo('porto_destino', 'PORTONAVE', IDX), 'NVT');
  assert.strictEqual(N.normalizarValorCampo('porto_destino', 'bribb', IDX), 'BRIBB');
});

console.log('\n── normalizarProcesso ──');
teste('só toca nos campos presentes no payload e devolve o que mudou', () => {
  const p = { id: 'x', armador: 'PILL', agente: 'ROYAL CARGO DO BRASIL', porto_origem: 'Vung Tau Port, Vietnam', obs: 'PILL' };
  const mudancas = N.normalizarProcesso(p, IDX);
  assert.deepStrictEqual(mudancas, [
    { campo: 'armador', antes: 'PILL', depois: 'PIL' },
    { campo: 'porto_origem', antes: 'Vung Tau Port, Vietnam', depois: 'VUNG TAU' },
  ]);
  assert.strictEqual(p.armador, 'PIL');
  assert.strictEqual(p.agente, 'ROYAL CARGO DO BRASIL');
  assert.strictEqual(p.obs, 'PILL');
  assert.ok(!('transportadora' in p));
});
teste('sem índice ou payload vazio: nada muda', () => {
  assert.deepStrictEqual(N.normalizarProcesso({ armador: 'PILL' }, null), []);
  assert.deepStrictEqual(N.normalizarProcesso(null, IDX), []);
});

// ── Fase 2a (01/10/2026): vínculo por ID + cliente/fornecedor/marca ──
console.log('\n── vínculo por id (<campo>_id) ──');
const EMPRESAS_ID = [
  { id: 'c-silvas', razao_social: 'SILVAS COMERCIO DE PNEUS LTDA', nome_fantasia: 'SILVAS', tipo: 'CLIENTE', sinonimos: ['SB LITORAL'] },
  { id: 'c-matriz', razao_social: 'OST PNEUS LTDA', nome_fantasia: 'OST', tipo: 'CLIENTE', cnpj: '2' },
  { id: 'c-filial', razao_social: 'OST PNEUS LTDA', nome_fantasia: 'OST', tipo: 'CLIENTE', cnpj: '3' },
  { id: 'u-filial', razao_social: 'CLIENTE EXEMPLO LTDA', tipo: 'CLIENTE', cnpj: '11222333000262' },
  { id: 'u-matriz', razao_social: 'CLIENTE EXEMPLO LTDA', tipo: 'CLIENTE', cnpj: '11222333000181' },
  { id: 'f-sailun', razao_social: 'SAILUN GROUP(HONGKONG)CO.,LIMITED', nome_fantasia: 'SAILUN', tipo: 'EXPORTADOR' },
  { id: 'f-tyre', razao_social: 'TYRE EXPORT INC', tipo: 'FORNECEDOR' },
  { id: 'a-pil', razao_social: 'PACIFIC INTERNATIONAL LINES', nome_fantasia: 'PIL', tipo: 'ARMADOR', sinonimos: ['PILL'] },
];
const LISTAS_ID = Object.assign(ListasPadrao.listasPadrao(), {
  marca: [{ codigo: 'ROADCRUZA', nome: 'Roadcruza', sinonimos: ['ROAD CRUZA', 'ROADCRUZA TYRES'], ativo: true }],
});
const IDX2 = N.montarIndice(EMPRESAS_ID, LISTAS_ID);

teste('resolverCampo devolve nome canônico + id do cadastro (cliente/fornecedor usam a razão social)', () => {
  assert.deepStrictEqual(N.resolverCampo('cliente', 'sb litoral', IDX2), { nome: 'SILVAS COMERCIO DE PNEUS LTDA', id: 'c-silvas' });
  assert.deepStrictEqual(N.resolverCampo('cliente', 'SILVAS', IDX2), { nome: 'SILVAS COMERCIO DE PNEUS LTDA', id: 'c-silvas' }, 'nome fantasia reconhece, mas o canônico é a razão social');
  assert.deepStrictEqual(N.resolverCampo('fornecedor', 'Sailun Group (HongKong) Co., Limited', IDX2), { nome: 'SAILUN GROUP(HONGKONG)CO.,LIMITED', id: 'f-sailun' });
  assert.deepStrictEqual(N.resolverCampo('fornecedor', 'Tyre Export, Inc.', IDX2), { nome: 'TYRE EXPORT INC', id: 'f-tyre' }, 'FORNECEDOR e EXPORTADOR valem pro mesmo campo');
  assert.strictEqual(N.resolverCampo('fornecedor', 'QINGDAO DITRIP TYRE CO LIMITED', IDX2), null);
  assert.strictEqual(N.resolverCampo('cliente', '', IDX2), null);
});
teste('mesmo nome em dois cadastros: vincula à matriz (CNPJ /0001); sem matriz identificável, id fica null', () => {
  assert.deepStrictEqual(N.resolverCampo('cliente', 'cliente exemplo ltda', IDX2), { nome: 'CLIENTE EXEMPLO LTDA', id: 'u-matriz' });
  assert.deepStrictEqual(N.resolverCampo('cliente', 'ost pneus ltda', IDX2), { nome: 'OST PNEUS LTDA', id: null });
  assert.strictEqual(N.normalizarValorCampo('cliente', 'OST', IDX2), 'OST PNEUS LTDA');
  assert.strictEqual(N.ehMatriz({ cnpj: '11.222.333/0001-81' }), true);
  assert.strictEqual(N.ehMatriz({ documento: '11222333000262' }), false);
  assert.strictEqual(N.ehMatriz({ cnpj: '1222333000181' }), true, 'CNPJ sem o zero à esquerda');
  assert.strictEqual(N.ehMatriz({ cnpj: '1222333000262' }), false);
});
teste('Custos Reais: real_json._meta.para/de ganham para_id/de_id pelo cadastro (qualquer papel)', () => {
  const p = { real_json: { frete: { valor: 10, moeda: 'USD' }, _meta: { frete: { para: 'pill', doc: 'INV 1', de: 'sb litoral' }, ii: { para: 'Receita Federal (DI)' }, trs: { doc: 'x' } } } };
  N.normalizarProcesso(p, IDX2);
  assert.strictEqual(p.real_json._meta.frete.para_id, 'a-pil');
  assert.strictEqual(p.real_json._meta.frete.para, 'pill', 'texto fica como foi digitado');
  assert.strictEqual(p.real_json._meta.frete.de_id, 'c-silvas');
  assert.strictEqual(p.real_json._meta.ii.para_id, null, 'sem cadastro → null');
  assert.ok(!('para_id' in p.real_json._meta.trs), 'sem campo para → não inventa para_id');
  assert.deepStrictEqual(N.resolverEmpresaQualquerPapel('tyre export inc', IDX2), { nome: 'TYRE EXPORT INC', id: 'f-tyre' });
  assert.strictEqual(N.resolverEmpresaQualquerPapel('', IDX2), null);
});
teste('normalizarProcesso grava <campo>_id (id, ou null quando não reconhece) só pros campos presentes', () => {
  const p = { id: 'x', cliente: 'SB LITORAL', fornecedor: 'QINGDAO DITRIP TYRE CO LIMITED', armador: 'PILL', obs: 'nada' };
  const mudancas = N.normalizarProcesso(p, IDX2);
  assert.deepStrictEqual(mudancas, [
    { campo: 'cliente', antes: 'SB LITORAL', depois: 'SILVAS COMERCIO DE PNEUS LTDA' },
    { campo: 'armador', antes: 'PILL', depois: 'PIL' },
  ]);
  assert.strictEqual(p.cliente_id, 'c-silvas');
  assert.strictEqual(p.fornecedor_id, null, 'fornecedor desconhecido: texto fica, id null');
  assert.strictEqual(p.fornecedor, 'QINGDAO DITRIP TYRE CO LIMITED');
  assert.strictEqual(p.armador_id, 'a-pil');
  assert.ok(!('agente_id' in p), 'campo que não veio no payload não ganha id');
});
teste('vendas_json: cada venda ganha cliente_id e o nome padronizado; string continua string', () => {
  const p = { vendas_json: JSON.stringify([{ cliente: 'sb litoral', itens: [] }, { cliente: 'DESCONHECIDO LTDA' }, { cliente: '' }]) };
  const mudancas = N.normalizarProcesso(p, IDX2);
  assert.deepStrictEqual(mudancas, [{ campo: 'vendas[1].cliente', antes: 'sb litoral', depois: 'SILVAS COMERCIO DE PNEUS LTDA' }]);
  const vendas = JSON.parse(p.vendas_json);
  assert.strictEqual(vendas[0].cliente, 'SILVAS COMERCIO DE PNEUS LTDA'); assert.strictEqual(vendas[0].cliente_id, 'c-silvas');
  assert.strictEqual(vendas[1].cliente, 'DESCONHECIDO LTDA'); assert.strictEqual(vendas[1].cliente_id, null);
  assert.strictEqual(vendas[2].cliente_id, null);
  assert.deepStrictEqual(vendas[0].itens, []);
});
teste('vendas_json malformado não quebra nem é alterado', () => {
  const p = { vendas_json: '{nao-e-json' };
  assert.deepStrictEqual(N.normalizarProcesso(p, IDX2), []);
  assert.strictEqual(p.vendas_json, '{nao-e-json');
});
teste('marca (brand) padroniza pela lista de marcas; sem lista fica como veio', () => {
  const p = { brand: 'Road Cruza' };
  assert.deepStrictEqual(N.normalizarProcesso(p, IDX2), [{ campo: 'brand', antes: 'Road Cruza', depois: 'ROADCRUZA' }]);
  assert.ok(!('brand_id' in p), 'marca é lista, não cadastro — sem id');
  const p2 = { brand: 'Road Cruza' };
  assert.deepStrictEqual(N.normalizarProcesso(p2, IDX), []);
  assert.strictEqual(p2.brand, 'Road Cruza');
});
teste('COLUNAS_ID cobre os 8 campos de empresa do processo', () => {
  assert.deepStrictEqual(N.COLUNAS_ID, ['cliente_id','fornecedor_id','armador_id','agente_id','transportadora_id','despachante_id','armazem_id','depot_id']);
});

console.log('\n── listas-padrao.js ──');
teste('listas padrão têm as 10 categorias (incl. agenda e meta de lucro) e os 4 portos de destino com dias grátis', () => {
  const l = ListasPadrao.listasPadrao();
  assert.deepStrictEqual(Object.keys(l).sort(), ['agenda_atividade', 'agenda_funcao', 'aprovacao_etapa', 'armazenagem_rf', 'banco_cambio', 'comissionado', 'marca', 'meta_lucro', 'porto_destino', 'porto_origem']);
  assert.deepStrictEqual(l.marca, [], 'marcas começam vazias (vêm da aba Listas / de-para)');
  assert.deepStrictEqual(l.comissionado, [], 'comissionados nunca no repositório (dado interno, repo público)');
  assert.deepStrictEqual(l.meta_lucro.map(m => m.codigo), ['PADRAO'], 'só a meta padrão no repositório; as metas por cliente ficam no banco');
  const dias = {}; l.porto_destino.forEach(p => { dias[p.codigo] = p.dados.dias_gratis; });
  assert.deepStrictEqual(dias, { ITJ: 5, IOA: 4, NVT: 5, BRIBB: 5 });
  assert.ok(l.porto_origem.length >= 27);
  assert.ok(l.porto_origem.every(p => p.dados && p.dados.pais));
});
teste('listasPadrao() devolve cópias independentes (mutar uma não afeta a outra)', () => {
  const a = ListasPadrao.listasPadrao(); const b = ListasPadrao.listasPadrao();
  a.porto_destino[0].dados.dias_gratis = 99; a.porto_destino[0].sinonimos.push('X');
  assert.strictEqual(b.porto_destino[0].dados.dias_gratis, 5);
  assert.ok(!b.porto_destino[0].sinonimos.includes('X'));
});
teste('bancos de câmbio padrão não carregam agência/conta (ficam só no banco de dados)', () => {
  ListasPadrao.listasPadrao().banco_cambio.forEach(b => {
    assert.strictEqual(b.dados.agencia, undefined); assert.strictEqual(b.dados.conta, undefined);
  });
});

// ── CNPJ/CPF importados do Conexos + consulta da Receita (20/10/2026) — valores fictícios ──
const DocBR = require('./documento-br.js');
const Receita = require('./receita-cnpj.js');
const { normalizarDocumento, formatarDocumento } = require('./lib/validacao-documento.js');
// Monta documentos fictícios com dígito verificador válido.
function dvCnpj(base12) {
  const calc = b => { let p = b.length - 7, s = 0; for (let i = 0; i < b.length; i++) { s += +b[i] * p--; if (p < 2) p = 9; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
  const d1 = calc(base12); return base12 + d1 + calc(base12 + d1);
}
function dvCpf(base9) {
  let s = 0; for (let i = 0; i < 9; i++) s += +base9[i] * (10 - i);
  let d1 = (s * 10) % 11; if (d1 === 10) d1 = 0;
  s = 0; const b10 = base9 + d1; for (let i = 0; i < 10; i++) s += +b10[i] * (11 - i);
  let d2 = (s * 10) % 11; if (d2 === 10) d2 = 0;
  return base9 + d1 + d2;
}
const CNPJ_ZERO = dvCnpj('012345670001');        // começa com 0
const CNPJ_DOIS_ZEROS = dvCnpj('001234560001');  // começa com 00
const CPF_ZERO = dvCpf('012345678');
const CPF_CONEXOS = (cpf) => cpf.slice(0, 9) + '0000' + cpf.slice(9);

console.log('\n── documento-br.js: CNPJ/CPF vindos do Conexos ──');
teste('CNPJ sem o zero à esquerda (13 dígitos) volta com o zero', () => {
  const r = normalizarDocumento('JURIDICA', 'Brasil', CNPJ_ZERO.slice(1));
  assert.deepStrictEqual(r, { documento: CNPJ_ZERO, tipo_pessoa: 'JURIDICA', correcao: 'zeros_cnpj' });
  assert.strictEqual(normalizarDocumento('JURIDICA', 'Brasil', CNPJ_DOIS_ZEROS.slice(2)).documento, CNPJ_DOIS_ZEROS);
});
teste('CNPJ certo (com ou sem máscara) fica como está, só os dígitos', () => {
  assert.deepStrictEqual(normalizarDocumento('JURIDICA', 'Brasil', '11.222.333/0001-81'), { documento: '11222333000181', tipo_pessoa: 'JURIDICA', correcao: null });
});
teste('CPF no formato do Conexos (9 + 0000 + 2) vira CPF e pessoa física', () => {
  assert.deepStrictEqual(normalizarDocumento('JURIDICA', 'Brasil', CPF_CONEXOS('11144477735')), { documento: '11144477735', tipo_pessoa: 'FISICA', correcao: 'cpf_conexos' });
});
teste('CPF do Conexos que também perdeu o zero à esquerda (14 dígitos) também é reconhecido', () => {
  const corrido = CPF_CONEXOS(CPF_ZERO).replace(/^0+/, '');
  assert.ok(!DocBR.digitoVerificadorValido_CNPJ(corrido.padStart(14, '0')), 'pré-condição: não pode ser CNPJ válido por acaso');
  const r = normalizarDocumento('JURIDICA', 'Brasil', corrido);
  assert.strictEqual(r.documento, CPF_ZERO); assert.strictEqual(r.tipo_pessoa, 'FISICA'); assert.strictEqual(r.correcao, 'cpf_conexos');
});
teste('número que não confere com dígito nenhum não é "corrigido" (a validação decide)', () => {
  const r = normalizarDocumento('JURIDICA', 'Brasil', '1234567890123');
  assert.deepStrictEqual(r, { documento: '1234567890123', tipo_pessoa: 'JURIDICA', correcao: null });
  assert.ok(require('./lib/validacao-documento.js').validarDocumento(r.tipo_pessoa, 'Brasil', r.documento).includes('inválido'));
});
teste('exterior: documento livre, sem tocar', () => {
  assert.deepStrictEqual(normalizarDocumento('JURIDICA', 'China', ' 91330000-ABC '), { documento: '91330000-ABC', tipo_pessoa: 'JURIDICA', correcao: null });
});
teste('máscara: 00.000.000/0000-00 e 000.000.000-00', () => {
  assert.strictEqual(formatarDocumento('11222333000181'), '11.222.333/0001-81');
  assert.strictEqual(formatarDocumento('11144477735'), '111.444.777-35');
  assert.strictEqual(formatarDocumento('91330000-ABC'), '91330000-ABC');
});

console.log('\n── receita-cnpj.js: completar o cadastro pela Receita ──');
const RESP_RECEITA = { cnpj: '11222333000181', razao_social: 'EMPRESA EXEMPLO DE PNEUS E SERVICOS AUTOMOTIVOS LTDA', nome_fantasia: 'EXEMPLO PNEUS', descricao_tipo_de_logradouro: 'RUA',
  logradouro: 'DAS FLORES', numero: '100', complemento: 'SALA 2', bairro: 'CENTRO', municipio: 'CIDADE EXEMPLO', uf: 'sc', cep: '88000000',
  ddd_telefone_1: '4733334444', email: 'CONTATO@EXEMPLO.COM.BR', descricao_situacao_cadastral: 'ATIVA' };
teste('mapeia a resposta: tipo do logradouro, CEP e telefone formatados', () => {
  const m = Receita.mapearDadosReceita(RESP_RECEITA);
  assert.strictEqual(m.logradouro, 'RUA DAS FLORES'); assert.strictEqual(m.cep, '88000-000'); assert.strictEqual(m.telefone, '(47) 3333-4444');
  assert.strictEqual(m.email, 'contato@exemplo.com.br'); assert.strictEqual(m.uf, 'SC'); assert.strictEqual(m.cidade, 'CIDADE EXEMPLO');
  assert.strictEqual(Receita.mapearDadosReceita(Object.assign({}, RESP_RECEITA, { logradouro: 'RUA DAS FLORES' })).logradouro, 'RUA DAS FLORES');
  assert.strictEqual(Receita.mapearDadosReceita({ nome_fantasia: '********' }).nome_fantasia, '');
});
teste('limparDadosReceita (o que o navegador manda pro servidor): só campos conhecidos, texto curto, formatos conferidos', () => {
  const limpo = Receita.limparDadosReceita(Object.assign(Receita.mapearDadosReceita(RESP_RECEITA), { id_extra: 'x', obs: 'não entra' }));
  assert.strictEqual(limpo.cnpj, '11222333000181'); assert.strictEqual(limpo.cep, '88000-000'); assert.strictEqual(limpo.uf, 'SC');
  assert.strictEqual(limpo.telefone, '(47) 3333-4444'); assert.strictEqual(limpo.email, 'contato@exemplo.com.br');
  assert.ok(!('id_extra' in limpo) && !('obs' in limpo));
  const ruim = Receita.limparDadosReceita({ cnpj: '11.222.333/0001-81', uf: 'Santa Catarina', cep: '880', email: 'sem arroba', telefone: '123',
    nome_fantasia: { html: '<b>x</b>' }, razao_social: 'A'.repeat(400), bairro: '  CENTRO \n  NORTE ', logradouro: '****' });
  assert.strictEqual(ruim.cnpj, '11222333000181');
  assert.strictEqual(ruim.uf, ''); assert.strictEqual(ruim.cep, ''); assert.strictEqual(ruim.email, ''); assert.strictEqual(ruim.telefone, '');
  assert.strictEqual(ruim.nome_fantasia, '', 'objeto não vira texto'); assert.strictEqual(ruim.razao_social.length, 150);
  assert.strictEqual(ruim.bairro, 'CENTRO NORTE'); assert.strictEqual(ruim.logradouro, '');
  assert.strictEqual(Receita.limparDadosReceita(null).cnpj, '');
  // Mesmo resultado de completar antes e depois de passar pelo servidor.
  const c = { tipo: 'CLIENTE', razao_social: 'X LTDA' };
  assert.deepStrictEqual(Receita.completarComReceita(c, limpo).alteracoes, Receita.completarComReceita(c, Receita.mapearDadosReceita(RESP_RECEITA)).alteracoes);
});
teste('preenche só o que está vazio; o que já tem fica', () => {
  const m = Receita.mapearDadosReceita(RESP_RECEITA);
  const c = { tipo: 'CLIENTE', razao_social: 'EMPRESA EXEMPLO DE PNEUS E SERVICOS AUTOMOTIVOS LTDA', nome_fantasia: '', logradouro: 'AV. JA DIGITADA', numero: '', cidade: 'CIDADE EXEMPLO', uf: 'SC', cep: '' };
  const r = Receita.completarComReceita(c, m);
  assert.deepStrictEqual(r.alteracoes, { nome_fantasia: 'EXEMPLO PNEUS', numero: '100', complemento: 'SALA 2', bairro: 'CENTRO', cep: '88000-000' });
  assert.ok(!('logradouro' in r.alteracoes)); assert.ok(!('telefone' in r.alteracoes) && !('email' in r.alteracoes), 'lote não põe telefone/e-mail (costumam ser do contador)');
  assert.deepStrictEqual(r.divergencias, []);
});
teste('na tela (CAMPOS_TELA) também preenche telefone e e-mail vazios', () => {
  const r = Receita.completarComReceita({ razao_social: 'X LTDA' }, Receita.mapearDadosReceita(RESP_RECEITA), { campos: Receita.CAMPOS_TELA });
  assert.strictEqual(r.alteracoes.telefone, '(47) 3333-4444'); assert.strictEqual(r.alteracoes.email, 'contato@exemplo.com.br');
});
teste('razão social cortada em 35 letras (Conexos) vira a completa e a antiga fica como sinônimo', () => {
  const cortada = 'EMPRESA EXEMPLO DE PNEUS E SERVICOS'.slice(0, 35);
  const r = Receita.completarComReceita({ razao_social: cortada, sinonimos: ['EXEMPLO'] }, Receita.mapearDadosReceita(RESP_RECEITA));
  assert.strictEqual(r.alteracoes.razao_social, RESP_RECEITA.razao_social);
  assert.deepStrictEqual(r.alteracoes.sinonimos, ['EXEMPLO', cortada]);
});
teste('razão social diferente (ex.: mudou o nome) não é trocada: vira divergência', () => {
  const r = Receita.completarComReceita({ razao_social: 'OUTRO NOME EXEMPLO EIRELI', cidade: 'OUTRA CIDADE' }, Receita.mapearDadosReceita(RESP_RECEITA));
  assert.ok(!('razao_social' in r.alteracoes));
  assert.deepStrictEqual(r.divergencias.map(d => d.campo).sort(), ['cidade', 'razao_social']);
});
teste('armador: nome fantasia não é preenchido (é o nome curto que vai pro processo)', () => {
  const r = Receita.completarComReceita({ tipo: 'AGENTE', papeis: ['AGENTE', 'ARMADOR'], razao_social: 'X LTDA' }, Receita.mapearDadosReceita(RESP_RECEITA));
  assert.ok(!('nome_fantasia' in r.alteracoes)); assert.strictEqual(r.alteracoes.cep, '88000-000');
});

// ── destinatarios-core.js: quem recebe cada e-mail (21/10/2026) ──
// Pedido Ayslan: "no cadastro, precisamos ter um flag para receber" câmbio,
// transporte, follow-up, financeiro, abertura com o despachante e instrução
// de embarque — por pessoa, como Para ou Cópia. Valores fictícios.
console.log('\n── destinatarios-core.js: flags de e-mail por pessoa ──');
const Dest = require('./destinatarios-core.js');

teste('os 6 assuntos pedidos existem, na ordem da tela', () => {
  assert.deepStrictEqual(Dest.CODIGOS, ['CAMBIO', 'TRANSPORTE', 'FOLLOWUP', 'FINANCEIRO', 'DESPACHANTE', 'INSTRUCAO']);
  Dest.ASSUNTOS_EMAIL.forEach(a => assert.ok(a.nome && a.curto && a.dica, a.codigo));
});
teste('limparAssuntos: só assunto e modo conhecidos; aceita texto JSON e caixa alta', () => {
  assert.deepStrictEqual(Dest.limparAssuntos({ CAMBIO: 'PARA', FOLLOWUP: ' cc ', FINANCEIRO: 'bcc', XYZ: 'para', TRANSPORTE: '' }), { CAMBIO: 'para', FOLLOWUP: 'cc' });
  assert.deepStrictEqual(Dest.limparAssuntos('{"INSTRUCAO":"cc"}'), { INSTRUCAO: 'cc' });
  [null, undefined, '', 'lixo', [], ['CAMBIO'], 42].forEach(v => assert.deepStrictEqual(Dest.limparAssuntos(v), {}, JSON.stringify(v)));
});
teste('resumoAssuntos: na ordem da lista, com o modo (para a etiqueta da tela)', () => {
  const r = Dest.resumoAssuntos({ INSTRUCAO: 'cc', CAMBIO: 'para' });
  assert.deepStrictEqual(r.map(x => x.codigo + ':' + x.modo), ['CAMBIO:para', 'INSTRUCAO:cc']);
  assert.strictEqual(r[0].curto, 'Câmbio');
});

const PESSOAS_DEST = [
  { id: 'p1', nome: 'Compras Cliente', email: 'compras@cliente-a.exemplo', empresa_id: 'emp-a', tipo: 'CONTATO', assuntos_email: { FOLLOWUP: 'para', CAMBIO: 'para', TRANSPORTE: 'para' } },
  { id: 'p2', nome: 'Financeiro Cliente', email: 'fin@cliente-a.exemplo', empresa_id: 'emp-a', tipo: 'CONTATO', assuntos_email: { CAMBIO: 'cc', FINANCEIRO: 'para' } },
  { id: 'p3', nome: 'Diretor Cliente', email: 'diretor@cliente-a.exemplo', empresa_id: 'emp-a', tipo: 'CONTATO', principal: true, assuntos_email: {} },
  { id: 'p4', nome: 'Antigo', email: 'antigo@cliente-a.exemplo', empresa_id: 'emp-a', tipo: 'CONTATO', ativo: false, assuntos_email: { FOLLOWUP: 'para' } },
  { id: 'p5', nome: 'Outro Cliente', email: 'contato@cliente-b.exemplo', empresa_id: 'emp-b', tipo: 'CONTATO', principal: true, assuntos_email: {} },
  { id: 'p6', nome: 'Operação Despachante', email: 'op@despachante.exemplo', empresa_id: 'emp-d', tipo: 'CONTATO', assuntos_email: { TRANSPORTE: 'cc', DESPACHANTE: 'para' } },
  { id: 'f1', nome: 'Analista Equipe', email: 'analista@equipe.exemplo', tipo: 'FUNCIONARIO', assuntos_email: { TRANSPORTE: 'para', CAMBIO: 'cc' } },
  { id: 'f2', nome: 'Sem e-mail', email: 'nao-e-email', tipo: 'FUNCIONARIO', assuntos_email: { TRANSPORTE: 'cc' } },
];
const emails = l => l.map(x => x.email);

teste('destinatarios: Para/Cópia pelo flag; só as empresas do e-mail; inativo e e-mail inválido fora', () => {
  const r = Dest.destinatarios('CAMBIO', PESSOAS_DEST, ['emp-a']);
  assert.deepStrictEqual(emails(r.para), ['compras@cliente-a.exemplo']);
  assert.deepStrictEqual(emails(r.cc), ['fin@cliente-a.exemplo', 'analista@equipe.exemplo']);
  assert.deepStrictEqual(r.semDestinatario, []);
});
teste('destinatarios: equipe IMPAK entra sempre em Cópia (mesmo marcada como Para)', () => {
  const r = Dest.destinatarios('TRANSPORTE', PESSOAS_DEST, [{ id: 'emp-a' }, { id: 'emp-d' }]);
  assert.deepStrictEqual(emails(r.para), ['compras@cliente-a.exemplo']);
  assert.deepStrictEqual(emails(r.cc), ['op@despachante.exemplo', 'analista@equipe.exemplo']);
  assert.ok(r.cc.every(x => x.email !== 'nao-e-email'));
  assert.strictEqual(r.cc[1].origem, 'equipe');
  const semEquipe = Dest.destinatarios('TRANSPORTE', PESSOAS_DEST, ['emp-a'], { equipe: false });
  assert.deepStrictEqual(emails(semEquipe.cc), []);
});
teste('destinatarios: empresa sem ninguém marcado → semDestinatario; com fallbackPrincipal usa o principal', () => {
  const r = Dest.destinatarios('FOLLOWUP', PESSOAS_DEST, ['emp-a', 'emp-b']);
  assert.deepStrictEqual(emails(r.para), ['compras@cliente-a.exemplo']);
  assert.deepStrictEqual(r.semDestinatario, ['emp-b']);
  const f = Dest.destinatarios('FOLLOWUP', PESSOAS_DEST, ['emp-a', 'emp-b'], { fallbackPrincipal: true });
  assert.deepStrictEqual(emails(f.para), ['compras@cliente-a.exemplo', 'contato@cliente-b.exemplo']);
  assert.strictEqual(f.para[1].origem, 'principal');
  assert.deepStrictEqual(f.semDestinatario, []);
  // emp-a já tem Para marcado: o principal (diretor) não entra de carona.
  assert.ok(!emails(f.para).includes('diretor@cliente-a.exemplo'));
});
teste('destinatarios: e-mail repetido sai uma vez; quem é Para numa empresa não fica em Cópia', () => {
  const pessoas = [
    { nome: 'A', email: 'Mesmo@Exemplo.com', empresa_id: 'x', assuntos_email: { FOLLOWUP: 'cc' } },
    { nome: 'A de novo', email: 'mesmo@exemplo.com', empresa_id: 'y', assuntos_email: { FOLLOWUP: 'para' } },
    { nome: 'B', email: 'b@exemplo.com', empresa_id: 'x', assuntos_email: { FOLLOWUP: 'cc' } },
    { nome: 'B equipe', email: 'B@exemplo.com', tipo: 'FUNCIONARIO', assuntos_email: { FOLLOWUP: 'cc' } },
  ];
  const r = Dest.destinatarios('FOLLOWUP', pessoas, ['x', 'y']);
  assert.deepStrictEqual(r.para.map(x => x.email.toLowerCase()), ['mesmo@exemplo.com']);
  assert.deepStrictEqual(r.cc.map(x => x.email.toLowerCase()), ['b@exemplo.com']);
});
teste('destinatarios: terceiros do processo (despachante) entram só em Cópia, mesmo marcados como Para', () => {
  const r = Dest.destinatarios('DESPACHANTE', PESSOAS_DEST, ['emp-a'], { empresasCopia: ['emp-d'] });
  assert.deepStrictEqual(emails(r.para), []);
  assert.deepStrictEqual(emails(r.cc), ['op@despachante.exemplo']);
  assert.strictEqual(r.cc[0].origem, 'copia');
  assert.deepStrictEqual(r.semDestinatario, ['emp-a'], 'só a empresa destinatária conta como "sem destinatário"');
  // o despachante é o destinatário (abertura de processo): aí ele vai em Para
  const d = Dest.destinatarios('DESPACHANTE', PESSOAS_DEST, ['emp-d']);
  assert.deepStrictEqual(emails(d.para), ['op@despachante.exemplo']);
  // o principal do terceiro não entra pelo fallback
  const f = Dest.destinatarios('TRANSPORTE', PESSOAS_DEST, ['emp-b'], { empresasCopia: ['emp-a'], fallbackPrincipal: true });
  assert.deepStrictEqual(emails(f.para), ['contato@cliente-b.exemplo']);
  assert.ok(!emails(f.para).concat(emails(f.cc)).includes('diretor@cliente-a.exemplo'));
  assert.ok(emails(f.cc).includes('compras@cliente-a.exemplo'), 'marcado no terceiro vai em cópia');
});
teste('textoLista: "Nome <email>; email" para mostrar Para/Cópia', () => {
  assert.strictEqual(Dest.textoLista([{ nome: 'Ana', email: 'ana@exemplo.com' }, { nome: '', email: 'b@exemplo.com' }, {}]), 'Ana <ana@exemplo.com>; b@exemplo.com');
  assert.strictEqual(Dest.textoLista(null), '');
});
teste('servidor: follow-up e pedido de transportadora usam os flags (FOLLOWUP/TRANSPORTE) e o despachante do processo vai em cópia', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, 'server.js'), 'utf-8');
  assert.ok(/destinatariosDoAssunto\('FOLLOWUP', empId \? \[empId\] : \[\], \{ fallbackPrincipal: true \}\)/.test(src), 'follow-up');
  assert.ok(/destinatariosDoAssunto\('TRANSPORTE', empId \? \[empId\] : \[\], \{ fallbackPrincipal: true, empresasCopia: despachantes \}\)/.test(src), 'transportadora');
  const i = src.indexOf('async function destinatariosDoAssunto');
  const corpo = src.slice(i, i + 1200);
  assert.ok(/\.eq\('ativo', true\)/.test(corpo) && /tipo\.eq\.FUNCIONARIO/.test(corpo), 'busca só pessoas ativas das empresas + equipe');
  assert.ok(/\[0-9A-Za-z_-\]\{1,64\}/.test(corpo), 'id de empresa validado antes de ir para o filtro');
});
teste('extrairContatos: linha Para/Cc do Outlook/Gmail vira nome + e-mail, sem repetidos', () => {
  const r = Dest.extrairContatos('Maria Teste <Maria@Exemplo.com.br>; compras@exemplo.com.br, "Op 07" <op07@exemplo.com.br>\nsem email aqui; maria@exemplo.com.br.');
  assert.deepStrictEqual(r, [
    { nome: 'Maria Teste', email: 'maria@exemplo.com.br' },
    { nome: 'Compras', email: 'compras@exemplo.com.br' },
    { nome: 'Op 07', email: 'op07@exemplo.com.br' },
  ]);
  assert.deepStrictEqual(Dest.extrairContatos(''), []);
  assert.deepStrictEqual(Dest.extrairContatos(null), []);
});
teste('planoColarContatos: novo, atualizar (soma os assuntos), igual e e-mail da equipe', () => {
  const daEmpresa = [
    { id: 'p1', nome: 'Compras', email: 'compras@exemplo.com.br', assuntos_email: { FOLLOWUP: 'para' } },
    { id: 'p2', nome: 'Fin', email: 'fin@exemplo.com.br', assuntos_email: { CAMBIO: 'cc' } },
    { id: 'p9', nome: 'Inativo', email: 'velho@exemplo.com.br', ativo: false, assuntos_email: {} },
  ];
  const plano = Dest.planoColarContatos(
    'Nova Pessoa <nova@exemplo.com.br>; COMPRAS@exemplo.com.br; fin@exemplo.com.br; velho@exemplo.com.br; Fulano <fulano@equipe.exemplo>',
    daEmpresa, { CAMBIO: 'cc', XYZ: 'para' }, { dominioEquipe: '@equipe.exemplo' });
  assert.deepStrictEqual(plano.map(c => c.email + ':' + c.acao), [
    'nova@exemplo.com.br:novo', 'compras@exemplo.com.br:atualizar', 'fin@exemplo.com.br:igual', 'velho@exemplo.com.br:novo', 'fulano@equipe.exemplo:equipe']);
  assert.deepStrictEqual(plano[0].assuntos_email, { CAMBIO: 'cc' });
  assert.deepStrictEqual(plano[1], { acao: 'atualizar', id: 'p1', nome: 'Compras', email: 'compras@exemplo.com.br', assuntos_email: { CAMBIO: 'cc', FOLLOWUP: 'para' } });
  assert.deepStrictEqual(plano[4].assuntos_email, {});
});
teste('servidor: grava assuntos_email limpo e só quando o campo vem no corpo (não apaga o que já existe)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, 'server.js'), 'utf-8');
  const i = src.indexOf("app.post('/api/cadastros/pessoas'");
  assert.ok(i > 0);
  const rota = src.slice(i, src.indexOf("app.delete('/api/cadastros/pessoas", i));
  assert.ok(/hasOwnProperty\.call\(p, 'assuntos_email'\)\) p\.assuntos_email = DestinatariosCore\.limparAssuntos\(p\.assuntos_email\)/.test(rota), 'POST de pessoas limpa assuntos_email');
  assert.ok(/require\('\.\/destinatarios-core\.js'\)/.test(src));
});

// Testes assíncronos (busca com fetch falso — sem rede).
const testesAsync = [];
function testeAsync(nome, fn) { testesAsync.push([nome, fn]); }
const respFalsa = (status, corpo) => ({ ok: status >= 200 && status < 300, status, json: async () => corpo });
testeAsync('buscarCnpjReceita: 200 devolve os dados mapeados; 404 = não encontrado; 429 = indisponível', async () => {
  let url = '';
  const ok = await Receita.buscarCnpjReceita('11.222.333/0001-81', { fetch: async (u) => { url = u; return respFalsa(200, RESP_RECEITA); } });
  assert.ok(ok.ok && url.endsWith('/11222333000181')); assert.strictEqual(ok.dados.cep, '88000-000');
  const nf = await Receita.buscarCnpjReceita('11222333000181', { fetch: async () => respFalsa(404, {}) });
  assert.ok(!nf.ok && nf.status === 404 && /não encontrado/.test(nf.erro));
  const lim = await Receita.buscarCnpjReceita('11222333000181', { fetch: async () => respFalsa(429, {}) });
  assert.ok(!lim.ok && lim.status === 429);
});
testeAsync('buscarCnpjReceita: CNPJ incompleto nem consulta; erro de rede não derruba', async () => {
  let chamou = false;
  const r = await Receita.buscarCnpjReceita('123', { fetch: async () => { chamou = true; return respFalsa(200, {}); } });
  assert.ok(!r.ok && !chamou);
  const e = await Receita.buscarCnpjReceita('11222333000181', { fetch: async () => { throw new Error('rede'); } });
  assert.ok(!e.ok && e.status === 0);
});

// "Arrumar CNPJ/CPF e Receita" (tela, controle-dash-cadastros.js): a BrasilAPI
// recusa (403) as consultas que saem do servidor do portal — o lote consulta no
// navegador e manda pro servidor { itens: [{ id, dados }] } de 20 em 20.
testeAsync('Arrumar cadastros: consulta a Receita no navegador e grava de 20 em 20 (404 = não encontrado)', async () => {
  const vm = require('vm'), fs = require('fs'), path = require('path');
  const cands = [];
  for (let i = 1; i <= 23; i++) cands.push({ id: 'c' + i, razao_social: 'EMPRESA FICTICIA ' + i, documento: dvCnpj('112223330' + String(i).padStart(3, '0')) });
  const NAO_EXISTE = cands[4].documento;
  const lotes = [], consultas = [];
  const resp = (status, corpo) => ({ ok: status >= 200 && status < 300, status, json: async () => corpo });
  const elementos = {};
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout: (fn) => setTimeout(fn, 0), clearTimeout, AbortController,
    showToast: () => {}, confirm: () => true, esc: (t) => String(t),
    document: { addEventListener() {}, getElementById: (id) => elementos[id] || (elementos[id] = { style: {}, innerHTML: '' }) },
    fetch: async (url, opts) => {
      url = String(url);
      const corpo = opts && opts.body ? JSON.parse(opts.body) : null;
      if (url === '/api/admin/cadastros/documentos') return resp(200, { ok: true, mudancas: 0, por_correcao: {}, invalidos: [], sem_documento: 0, erros: [], candidatos_receita: cands });
      if (url.startsWith('https://brasilapi.com.br/api/cnpj/v1/')) {
        const d = url.split('/').pop(); consultas.push(d);
        return d === NAO_EXISTE ? resp(404, {}) : resp(200, Object.assign({}, RESP_RECEITA, { cnpj: d }));
      }
      if (url === '/api/admin/cadastros/completar-receita') {
        lotes.push(corpo.itens);
        return resp(200, { ok: true, resultados: corpo.itens.map(x => ({ id: x.id, razao_social: 'X', ok: true, preenchidos: ['cep'], divergencias: [], situacao: 'ATIVA' })) });
      }
      throw new Error('URL inesperada no teste: ' + url);
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'receita-cnpj.js'), 'utf-8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'controle-dash-cadastros.js'), 'utf-8'), ctx);
  await vm.runInContext('arrumarCadastrosDocumentos()', ctx);
  assert.strictEqual(consultas.length, 23, 'cada CNPJ consultado uma vez, no navegador');
  assert.deepStrictEqual(lotes.map(l => l.length), [20, 2], 'grava de 20 em 20; o não encontrado não vai');
  const item = lotes[0][0];
  assert.strictEqual(item.id, 'c1'); assert.strictEqual(item.dados.cnpj, cands[0].documento); assert.strictEqual(item.dados.cep, '88000-000');
  assert.ok(!lotes.flat().some(x => x.id === 'c5'));
  const resumo = elementos['cad-arrumar-resumo'].innerHTML;
  assert.ok(/completados: 22/.test(resumo) && /não encontrados: 1/.test(resumo), resumo.slice(0, 200));
  assert.ok(resumo.includes('EMPRESA FICTICIA 5'), 'lista o não encontrado');
});

(async () => {
  for (const [nome, fn] of testesAsync) {
    try { await fn(); passou++; console.log(`  ✓ ${nome}`); }
    catch (e) { falhou++; console.log(`  ✗ ${nome}`); console.log(`    ${e.message}`); }
  }
  console.log(`\n════════════════════════════════════════`);
  console.log(`RESULTADO: ${passou} passaram, ${falhou} falharam`);
  console.log(`════════════════════════════════════════\n`);
  if (falhou > 0) process.exit(1);
})();
