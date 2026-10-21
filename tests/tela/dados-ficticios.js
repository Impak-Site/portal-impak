// tests/tela/dados-ficticios.js — respostas de API FICTÍCIAS pro teste de
// telas (o repositório é público: nenhum nome, valor ou referência real).
'use strict';

const hoje = new Date();
const dia = n => new Date(hoje.getTime() + n * 86400000).toISOString().slice(0, 10);

const fases = ['PI', 'AGUARDANDO_EMBARQUE', 'EMBARCADO', 'DESEMBARCADO', 'CARREGAMENTO', 'FINALIZADO'];
const processos = fases.map((fase, i) => ({
  id: 'teste-' + (i + 1),
  referencia: 'TESTE-00' + (i + 1),
  cliente: 'Cliente Exemplo ' + String.fromCharCode(65 + i),
  fornecedor: 'Fornecedor Exemplo ' + (i + 1),
  marca: 'Marca Exemplo',
  fase,
  status: fase === 'FINALIZADO' ? 'FINALIZADO' : 'ATIVO',
  porto_origem: 'Porto Exemplo',
  porto_destino: 'ITJ',
  etd: dia(-40 + i * 5),
  eta: dia(-10 + i * 5),
  data_embarque: i >= 2 ? dia(-38 + i * 5) : null,
  data_chegada: i >= 3 ? dia(-8 + i * 5) : null,
  pi_valor_usd: 10000 + i * 1500,
  pi_cambio: 5.25,
  pi_pagamento: 'VISTA',
  qtd_containers: 1,
  tipo_container: '40HC',
  produtos_json: JSON.stringify([{ produto: 'Pneu Exemplo 205/55R16', quantidade: 500 }]),
  vendas_json: '[]',
  real_json: {},
  created_at: dia(-60) + 'T12:00:00.000Z',
  updated_at: dia(-1) + 'T12:00:00.000Z',
}));

// Usuário de teste com acesso a tudo (gerente) — a tela mostra o menu completo.
const me = {
  logado: true, usuario: 'teste@exemplo.com', nome: 'Pessoa Teste', displayName: 'Pessoa Teste', role: 'gerente',
  modulos: ['tyredesk', 'conferencia', 'controle', 'financeiro', 'resultado', 'tv', 'narcelio', 'cadastros', 'cambio', 'analises'],
};

// Cotações fictícias pra tela /cotacoes (uma de cada situação do vínculo).
const resumoCot = (custo, fat, extra) => Object.assign({ tipo: 'TBR', uf: 'SC', containers: 1, custo_total: custo, faturamento: fat,
  lucro_bruto: fat - custo, pct_lucro: (fat - custo) / fat * 100,
  cenarios: { com_st: { faturamento_total: fat, comissao_china: 0, valor_impak: fat, lucro_bruto: fat - custo, pct_lucro: 10 },
    sem_st: { faturamento_total: fat * 0.97, comissao_china: 0, valor_impak: fat * 0.97, lucro_bruto: fat * 0.97 - custo, pct_lucro: 7 } },
  custos_cotados_json: { cambio: 5.3, containers: 1, compra: { fob: 50000, frete: 9000 }, impostos: { ii: 8000 }, taxas_fixas: { siscomex: 150 }, taxas_usd: {} },
  criado_em: dia(-20) + 'T10:00:00.000Z', criado_por: 'teste@exemplo.com' }, extra || {});
const cotacoesTela = [
  { id: 'cot-teste-1', cliente: 'Cliente Exemplo A', ativo: true, updated_at: dia(-2) + 'T12:00:00.000Z', updated_by: 'teste@exemplo.com',
    fob_usd: '10000', cambio_usd: '5.30', tipo_importacao: 'ENCOMENDA', qtde_containers: '1', marca: 'Marca Exemplo',
    resumo: resumoCot(100000, 112000, { status: 'aprovada', processo_id: 'teste-1', processo_referencia: 'TESTE-001', data_aprovacao: dia(-1) + 'T12:00:00.000Z' }),
    processo: { id: 'teste-1', referencia: 'TESTE-001', cliente: 'Cliente Exemplo A', fase: 'PI', fechado: false, cancelado: false, cotacao_id: 'cot-teste-1' },
    vinculo: { estado: 'ok', texto: '' } },
  { id: 'cot-teste-2', cliente: 'Cliente Exemplo B', ativo: true, updated_at: dia(-5) + 'T12:00:00.000Z', updated_by: 'teste@exemplo.com',
    fob_usd: '8000', tipo_importacao: 'PROPRIA', resumo: resumoCot(80000, 90000), processo: null, vinculo: { estado: 'sem_vinculo', texto: '' } },
  { id: 'cot-teste-3', cliente: 'Cliente Exemplo C', ativo: true, updated_at: dia(-9) + 'T12:00:00.000Z', updated_by: 'outra@exemplo.com',
    resumo: resumoCot(70000, 69000, { status: 'rejeitada', motivo_perda: 'Preço (teste)', data_rejeicao: dia(-8) + 'T12:00:00.000Z' }),
    processo: null, vinculo: { estado: 'sem_vinculo', texto: '' } },
  { id: 'cot-teste-4', cliente: 'Cliente Exemplo D', ativo: true, updated_at: dia(-12) + 'T12:00:00.000Z', updated_by: 'teste@exemplo.com',
    resumo: resumoCot(60000, 66000, { status: 'aprovada', processo_id: 'teste-2', processo_referencia: 'TESTE-002' }),
    processo: { id: 'teste-2', referencia: 'TESTE-002', cliente: 'Cliente Exemplo D', fase: 'EMBARCADO', fechado: false, cancelado: false, cotacao_id: 'cot-teste-9' },
    vinculo: { estado: 'duplicada', texto: 'Mais de uma cotação apontava para o processo TESTE-002 (teste).' } },
];
const conferenciaTela = { contagem: { cotacoes: 4, ok: 1, problemas: 1, automaticos: 1, manuais: 0, acoes: 1 },
  problemas: [{ tipo: 'duplicada', automatico: true, texto: 'Processo TESTE-002: outra cotação também apontava para ele (teste).' }] };

// Faturas fictícias do processo TESTE-003 (aba Faturas do painel): uma a
// pagar em US$ conferida com diferença e vencida, uma paga e uma cobrança.
const itemFat = (taxa, label, valor) => ({ processo_id: 'teste-3', referencia: 'TESTE-003', taxa, label, valor });
const faturasTeste = [
  { id: 'fat-teste-1', numero: '000901/26', tipo: 'pagar', status: 'aberta', empresa_nome: 'Agente Exemplo', documento: 'ND 0001',
    moeda: 'USD', cambio: 5.3, valor: 1200, valor_pago: 0, emissao: dia(-10), vencimento: dia(-2),
    itens: [itemFat('frete', 'Frete Internacional', 1000), itemFat('desconsolidacao', 'Desconsolidação', 200)],
    anexos: [{ tipo: 'fatura', nome: 'nd-0001.pdf', path: 'faturas/fat-teste-1/nd.pdf' }],
    conferencia: { em: dia(-3) + 'T10:00:00Z', por: 'teste@exemplo.com', nome: 'Pessoa Teste',
      checks: [{ nivel: 'erro', tipo: 'valor', msg: 'TESTE-003 · Desconsolidação: diferença de teste.' }] } },
  { id: 'fat-teste-2', numero: '000902/26', tipo: 'pagar', status: 'paga', empresa_nome: 'Despachante Exemplo', documento: 'Acerto 1',
    moeda: 'BRL', cambio: 1, valor: 2500, valor_pago: 2500, vencimento: dia(-1), pago_em: dia(-1),
    itens: [itemFat('despachante', 'Despachante', 2500)], pagamentos: [{ data: dia(-1), valor: 2500, forma: 'pix' }] },
  { id: 'fat-teste-3', numero: '000903/26', tipo: 'receber', status: 'aberta', empresa_nome: 'Cliente Exemplo C', documento: 'Cobrança 1',
    moeda: 'BRL', cambio: 1, valor: 1200, valor_pago: 0, vencimento: dia(20), itens: [itemFat('armazenagem', 'Armazenagem', 1200)] },
];

// Rotas com resposta própria; o resto das /api devolve um objeto vazio
// "permissivo" (ok + listas vazias) — a tela tem que aguentar lista vazia.
const respostas = {
  '/api/me': me,
  '/api/controle/v2/processos': { ok: true, processos },
  '/api/controle/v2/processos/versao': { ok: true, versao: 'teste-1' },
  '/api/controle/v2/notificacoes': { ok: true, notificacoes: [] },
  '/api/base/carregar': { ok: true, base: [
    { f: 'FORNECEDOR EXEMPLO', md: '205/55R16', pat: 'Exemplo X1', cur: 'USD', pr: 30.5, moq: 500 },
    { f: 'FORNECEDOR EXEMPLO', md: '295/80R22.5', pat: 'Exemplo T2', cur: 'USD', pr: 120.0, moq: 200 },
  ] },
  '/api/base/carregar-fornecedores': { ok: true, fornecedores: [] },
  '/api/calculador/cotacoes': { ok: true, cotacoes: cotacoesTela, conferencia: conferenciaTela, usuario: { role: 'gerente', controle: true } },
  // só a aba do processo pede com processo_id; a tela /faturas segue com a lista vazia
  '/api/faturas': req => (req.query && req.query.processo_id === 'teste-3' ? { ok: true, faturas: faturasTeste } : null),
  '/api/faturas/resumo-processos': { ok: true, resumo: { 'teste-3': { qtd: 3, abertas: 2, vencidas: 1, divergentes: 1, pagas: 1, pagar_abertas: 1, receber_abertas: 1 } } },
};
const vazio = {
  ok: true, total: 0, itens: [], lista: [], dados: [], contatos: [], pessoas: [], faturas: [], cotacoes: [],
  conversas: [], historico: [], conclusoes: [], transferencias: [], recorrencias: [], contas: [], centros: [],
  bancos: [], usuarios: [], lotes: [], arquivos: [], index: [], processos: [], notificacoes: [], produtos: [],
};
// Cotação do dia (AwesomeAPI) — fixa, pro teste não depender da internet.
const cotacao = { USDBRL: { bid: '5.3000' }, EURBRL: { bid: '6.1000' }, CNYBRL: { bid: '0.7400' } };

module.exports = { respostas, vazio, cotacao, processos, me };
