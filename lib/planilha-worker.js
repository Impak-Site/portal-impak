'use strict';
// Relatório de segurança (item 11): a biblioteca xlsx 0.18.5 tem falhas
// conhecidas (prototype pollution e ReDoS) ao LER planilhas maliciosas. A
// versão corrigida só sai do site da SheetJS; enquanto ela não é instalada,
// toda leitura de planilha enviada por usuário roda AQUI, numa thread
// separada: se uma planilha "envenenar" objetos, isso fica preso nesta
// thread (que morre em seguida) e não contamina o servidor; se ela travar
// o parser, o servidor mata a thread por tempo (ver lerPlanilhaIsolada).
const { parentPort, workerData } = require('worker_threads');
const planilha = require('../planilha-import.js');
try {
  const fn = planilha[workerData.funcao];
  if (typeof fn !== 'function') throw new Error('Função de importação desconhecida');
  const resultado = fn(Buffer.from(workerData.buffer));
  parentPort.postMessage({ ok: true, resultado });
} catch (e) {
  parentPort.postMessage({ ok: false, erro: (e && e.message) || 'Erro ao ler a planilha' });
}
