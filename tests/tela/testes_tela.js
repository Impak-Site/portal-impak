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
  '/cotacoes': 'cotacoes.html',
  '/catalogo-produtos': 'catalogo-produtos.html',
  '/assistente': 'assistente.html',
  '/permissoes': 'permissoes.html',
};
['/controle', '/financeiro', '/faturas', '/cadastros', '/cambio', '/agenda', '/resultado',
  '/analises', '/tv', '/conferencia-fila', '/reciclagem', '/averbacao'].forEach(r => { TELAS[r] = 'controle_v2.html'; });
// Conferência antiga (processos.html) está travada para edição: só relatório.
const SO_RELATORIO = { '/processos': 'processos.html' };

// Situações além de "abrir a tela" (revisão 17/10/2026, item 7): o painel do
// processo (onde a equipe passa o dia) e o modo escuro. `antes` roda antes
// dos scripts da tela; `acao` depois de carregar; `conferir` devolve uma
// lista de problemas (vazia = ok).
const CENARIOS = [
  {
    nome: '/cotacoes + painel da cotação', rota: '/cotacoes',
    acao: async page => { await page.evaluate(() => abrirPainel('cot-teste-1')); await page.waitForTimeout(400); },
    conferir: () => {
      const p = [];
      const painel = document.getElementById('painel');
      if (!painel || !painel.classList.contains('open')) p.push('o painel da cotação não abriu');
      if (!document.querySelector('table.cot tbody tr')) p.push('a tabela de cotações não mostrou as linhas');
      return p;
    },
  },
  {
    nome: '/controle + painel do processo', rota: '/controle',
    acao: async page => { await page.evaluate(() => abrirProcesso('teste-3')); await page.waitForTimeout(900); },
    conferir: () => {
      const bg = document.getElementById('modal-bg');
      if (!bg || !bg.classList.contains('open')) return ['o painel do processo não abriu'];
      const p = [];
      if (!bg.querySelector('[role=dialog]')) p.push('painel aberto sem papel de janela (role=dialog): o leitor de tela não anuncia');
      if (!bg.contains(document.activeElement)) p.push('o foco do teclado não foi pra janela que abriu');
      return p;
    },
  },
  // Arrastar e soltar nos botões de importar (chat.js, 20/10/2026): o
  // arquivo solto em cima do botão chega no mesmo lugar que a janela de
  // escolher arquivo — no input fixo (Calculador) e no input que nasce no
  // clique ("Ler fatura (IA)" dos Custos Reais). Arquivo de tipo errado não entra.
  {
    nome: '/calculador: arrastar a planilha no botão Importar', rota: '/calculador', viewports: ['notebook'],
    acao: async page => {
      await page.evaluate(() => {
        window.__arraste = [];
        window.importarPlanilhaSelecionada = inp => { window.__arraste.push([...inp.files].map(f => f.name).join(',')); };
        const bt = [...document.querySelectorAll('button')].find(b => /importar-planilha-input/.test(b.getAttribute('onclick') || ''));
        if (!bt) { window.__arraste = ['sem botão']; return; }
        const soltar = nome => {
          const dt = new DataTransfer(); dt.items.add(new File(['x'], nome));
          ['dragenter', 'dragover', 'drop'].forEach(t => bt.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt })));
        };
        soltar('modelo-teste.xlsm');
        soltar('documento.pdf'); // tipo que o botão não importa
      });
      await page.waitForTimeout(250);
    },
    conferir: () => {
      const p = [];
      if (JSON.stringify(window.__arraste) !== JSON.stringify(['modelo-teste.xlsm'])) p.push('arrastar no "Importar planilha" não entregou só a planilha: ' + JSON.stringify(window.__arraste));
      if (document.documentElement.classList.contains('impak-arrastando')) p.push('o destaque de arrastar ficou na tela depois de soltar');
      return p;
    },
  },
  {
    nome: '/controle: arrastar o documento no "Ler fatura (IA)" dos Custos Reais', rota: '/controle', viewports: ['notebook'],
    acao: async page => {
      await page.evaluate(() => abrirProcesso('teste-3'));
      await page.waitForTimeout(900);
      await page.evaluate(() => {
        window.__arraste = [];
        window.crLerDocumentosCustos = inp => { window.__arraste.push([...inp.files].map(f => f.name).join(',')); };
        const bt = document.querySelector('[data-arraste][onclick*="crEscolherDocumentosCustos"]');
        if (!bt) { window.__arraste = ['sem botão']; return; }
        const dt = new DataTransfer(); dt.items.add(new File(['x'], 'fatura-agente.pdf', { type: 'application/pdf' }));
        ['dragenter', 'dragover', 'drop'].forEach(t => bt.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt })));
      });
      await page.waitForTimeout(250);
    },
    conferir: () => JSON.stringify(window.__arraste) === JSON.stringify(['fatura-agente.pdf']) ? []
      : ['arrastar no "Ler fatura (IA)" não entregou o arquivo: ' + JSON.stringify(window.__arraste)],
  },
  {
    nome: '/controle (modo escuro)', rota: '/controle', viewports: ['notebook'],
    antes: () => { try { localStorage.setItem('impak_tema', 'escuro'); } catch (e) {} },
    conferir: () => {
      const p = [];
      if (document.documentElement.getAttribute('data-tema') !== 'escuro') p.push('o modo escuro não ligou');
      if (!document.getElementById('impak-tema-escuro-css')) p.push('o estilo do modo escuro não entrou na página');
      const b = document.getElementById('nav-tema-btn');
      if (!b || b.getAttribute('aria-pressed') !== 'true') p.push('o botão ☾/☀ da barra não mostra que o modo escuro está ligado');
      return p;
    },
  },
];

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

async function auditar(browser, base, rota, vp, cenario) {
  const ctx = await browser.newContext(Object.assign({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' }, vp));
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', e => erros.push('erro de JavaScript: ' + (e && e.message ? e.message : String(e)).split('\n')[0]));
  // alert/confirm/prompt na abertura travaria a tela de quem usa — vira erro
  page.on('dialog', d => { erros.push(`a tela abriu uma caixa de diálogo sozinha: "${d.message().slice(0, 80)}"`); d.dismiss().catch(() => {}); });
  if (cenario && cenario.antes) await page.addInitScript(cenario.antes);
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
    if (cenario && cenario.acao) await cenario.acao(page);
    await page.addScriptTag({ path: AUDITORIA });
    resultado = await page.evaluate(l => window.auditarTela(l), LIMITES);
    if (cenario && cenario.conferir) (await page.evaluate(cenario.conferir)).forEach(p => erros.push(p));
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
  const todas = Object.keys(TELAS).map(r => ({ rota: r, bloqueia: true, nome: r }))
    .concat(Object.keys(SO_RELATORIO).map(r => ({ rota: r, bloqueia: false, nome: r })))
    .concat(CENARIOS.map(c => ({ rota: c.rota, bloqueia: true, nome: c.nome, cenario: c })));
  for (const item of todas) {
    const { rota, bloqueia, cenario } = item;
    for (const vp of VIEWPORTS) {
      if (cenario && cenario.viewports && !cenario.viewports.includes(vp.nome)) continue;
      const { erros, resultado: r } = await auditar(browser, base, rota, vp, cenario);
      const nome = `${item.nome} (${vp.nome})`;
      const problemas = erros.slice();
      if (r) {
        if (vp.nome === 'celular' && r.rolagemLateral > 2) problemas.push(`rola ${r.rolagemLateral}px pro lado — passa da tela: ${r.culpadosRolagem.slice(0, 4).join(' · ') || '(sem culpado identificado)'}`);
        if (r.letraPequena.length) problemas.push(`${r.letraPequena.length} texto(s) com letra menor que ${LIMITES.minFonte}px: ${r.letraPequena.slice(0, 4).join(' · ')}`);
        if (r.baixoContraste.length) problemas.push(`${r.baixoContraste.length} texto(s) com contraste abaixo de ${LIMITES.minContraste}:1: ${r.baixoContraste.slice(0, 4).join(' · ')}`);
        // Campo sem nome (nem rótulo, nem placeholder, nem id) depois do
        // ajuste automático do chat.js: o leitor de tela não sabe o que é.
        if (r.camposSemNome.length) problemas.push(`${r.camposSemNome.length} campo(s) sem nome pro leitor de tela: ${r.camposSemNome.slice(0, 4).join(' · ')}`);
        const info = [];
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
