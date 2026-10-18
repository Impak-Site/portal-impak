// tests/tela/testes_tela.js — abre cada tela num navegador de verdade
// (Chromium sem janela, via Playwright), no celular (390px) e no notebook
// (1366px), com dados FICTÍCIOS, e FALHA a atualização se alguma tela:
//   · der erro de JavaScript (a tela "quebra");
//   · rolar pro lado no celular (a página inteira mais larga que a tela);
//   · tiver texto ilegível (letra menor que 9px ou contraste abaixo de 3:1).
// Também lista, sem bloquear, campos sem rótulo e texto abaixo do nível AA.
// Revisão 17/10/2026, item 6. Roda no GitHub Actions a cada envio (testes.yml).
//
// Local: npm i --no-save playwright && npx playwright install chromium
//        node tests/tela/testes_tela.js
'use strict';

const path = require('path');
const express = require('express');
const { respostas, vazio, cotacao } = require('./dados-ficticios');

const RAIZ = path.join(__dirname, '..', '..');
const AUDITORIA = path.join(__dirname, 'auditoria.js');

// Rotas das telas — mesmas do server.js (o arquivo HTML que cada uma serve).
const TELAS = {
  '/': 'tyredesk.html',
  '/calculador': 'calculador.html',
  '/catalogo-produtos': 'catalogo-produtos.html',
  '/assistente': 'assistente.html',
  '/permissoes': 'permissoes.html',
};
['/controle', '/financeiro', '/faturas', '/cadastros', '/cambio', '/agenda', '/resultado',
  '/analises', '/tv', '/conferencia-fila', '/reciclagem', '/averbacao'].forEach(r => { TELAS[r] = 'controle_v2.html'; });
// Conferência antiga (processos.html) está travada para edição: só relatório.
const SO_RELATORIO = { '/processos': 'processos.html' };

const VIEWPORTS = [
  { nome: 'celular', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { nome: 'notebook', viewport: { width: 1366, height: 768 } },
];
const LIMITES = { minFonte: 9, minContraste: 3 };

function servidorFalso() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  const todas = Object.assign({}, TELAS, SO_RELATORIO);
  Object.entries(todas).forEach(([rota, arq]) => app.get(rota, (req, res) => res.sendFile(path.join(RAIZ, arq))));
  app.all(/^\/api\//, (req, res) => {
    if (req.method !== 'GET') return res.json({ ok: true });
    res.json(respostas[req.path] || vazio);
  });
  app.use(express.static(RAIZ));
  return new Promise(ok => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
}

async function auditar(browser, base, rota, vp) {
  const ctx = await browser.newContext(Object.assign({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' }, vp));
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', e => erros.push('erro de JavaScript: ' + (e && e.message ? e.message : String(e)).split('\n')[0]));
  // Nada sai pra internet: cotação fixa, o resto (fontes, CDNs) é cortado.
  await page.route('**/*', rt => {
    const u = rt.request().url();
    if (u.startsWith(base)) return rt.continue();
    if (/awesomeapi/.test(u)) return rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cotacao) });
    return rt.abort();
  });
  let resultado = null;
  try {
    await page.goto(base + rota, { waitUntil: 'load', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await page.addScriptTag({ path: AUDITORIA });
    resultado = await page.evaluate(l => window.auditarTela(l), LIMITES);
  } catch (e) {
    erros.push('a tela não abriu: ' + e.message.split('\n')[0]);
  }
  await ctx.close();
  return { erros, resultado };
}

async function rodar() {
  const { chromium } = require('playwright');
  const servidor = await servidorFalso();
  const base = 'http://127.0.0.1:' + servidor.address().port;
  const browser = await chromium.launch();
  const falhas = [], avisos = [];
  const todas = Object.keys(TELAS).map(r => [r, true]).concat(Object.keys(SO_RELATORIO).map(r => [r, false]));
  for (const [rota, bloqueia] of todas) {
    for (const vp of VIEWPORTS) {
      const { erros, resultado: r } = await auditar(browser, base, rota, vp);
      const nome = `${rota} (${vp.nome})`;
      const problemas = erros.slice();
      if (r) {
        if (vp.nome === 'celular' && r.rolagemLateral > 2) problemas.push(`rola ${r.rolagemLateral}px pro lado — passa da tela: ${r.culpadosRolagem.slice(0, 4).join(' · ') || '(sem culpado identificado)'}`);
        if (r.letraPequena.length) problemas.push(`${r.letraPequena.length} texto(s) com letra menor que ${LIMITES.minFonte}px: ${r.letraPequena.slice(0, 4).join(' · ')}`);
        if (r.baixoContraste.length) problemas.push(`${r.baixoContraste.length} texto(s) com contraste abaixo de ${LIMITES.minContraste}:1: ${r.baixoContraste.slice(0, 4).join(' · ')}`);
        const info = [];
        if (r.camposSemNome.length) info.push(`${r.camposSemNome.length} campo(s) sem rótulo (${r.camposSemNome.slice(0, 3).join(' · ')})`);
        if (r.abaixoAA) info.push(`${r.abaixoAA}/${r.textosMedidos} texto(s) abaixo do contraste AA (4,5:1)`);
        if (info.length) avisos.push(`${nome}: ${info.join('; ')}`);
      }
      if (problemas.length) {
        (bloqueia ? falhas : avisos).push(`${nome}${bloqueia ? '' : ' [só relatório — arquivo travado]'}:\n    - ${problemas.join('\n    - ')}`);
        console.log(`  ${bloqueia ? '✗' : '!'} ${nome}`);
      } else console.log(`  ✓ ${nome}`);
    }
  }
  await browser.close();
  servidor.close();
  if (avisos.length) console.log('\nAvisos (não bloqueiam):\n  ' + avisos.join('\n  '));
  if (falhas.length) {
    console.log('\nTELAS COM PROBLEMA (a atualização não deve ir pro ar assim):\n  ' + falhas.join('\n  '));
    process.exit(1);
  }
  console.log(`\nTodas as ${Object.keys(TELAS).length} telas abriram sem erro, sem rolagem lateral no celular e com texto legível.`);
}

module.exports = { servidorFalso, TELAS, SO_RELATORIO };
if (require.main === module) rodar().catch(e => { console.error(e); process.exit(1); });
