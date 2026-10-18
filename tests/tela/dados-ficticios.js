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
};
const vazio = {
  ok: true, total: 0, itens: [], lista: [], dados: [], contatos: [], pessoas: [], faturas: [], cotacoes: [],
  conversas: [], historico: [], conclusoes: [], transferencias: [], recorrencias: [], contas: [], centros: [],
  bancos: [], usuarios: [], lotes: [], arquivos: [], index: [], processos: [], notificacoes: [], produtos: [],
};
// Cotação do dia (AwesomeAPI) — fixa, pro teste não depender da internet.
const cotacao = { USDBRL: { bid: '5.3000' }, EURBRL: { bid: '6.1000' }, CNYBRL: { bid: '0.7400' } };

module.exports = { respostas, vazio, cotacao, processos, me };
