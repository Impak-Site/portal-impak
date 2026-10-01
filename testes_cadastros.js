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

console.log('\n── listas-padrao.js ──');
teste('listas padrão têm as 3 categorias e os 4 portos de destino com dias grátis', () => {
  const l = ListasPadrao.listasPadrao();
  assert.deepStrictEqual(Object.keys(l).sort(), ['banco_cambio', 'porto_destino', 'porto_origem']);
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

console.log(`\n════════════════════════════════════════`);
console.log(`RESULTADO: ${passou} passaram, ${falhou} falharam`);
console.log(`════════════════════════════════════════\n`);
if (falhou > 0) process.exit(1);
