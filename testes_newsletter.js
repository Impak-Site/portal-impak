// testes_newsletter.js — Radar IMPAK (newsletter-servidor.js) e agenda do
// follow-up semanal. Dados fictícios. Rodar: node testes_newsletter.js
'use strict';
const N = require('./newsletter-servidor.js');

let ok = 0, falha = 0;
const filaAsync = [];
function teste(nome, fn) {
  const r = (() => { try { return fn(); } catch (e) { return e; } })();
  if (r && typeof r.then === 'function') { filaAsync.push(r.then(() => { ok++; console.log('  ✓ ' + nome); }, e => { falha++; console.log('  ✗ ' + nome + ' — ' + e.message); })); return; }
  if (r instanceof Error) { falha++; console.log('  ✗ ' + nome + ' — ' + r.message); } else { ok++; console.log('  ✓ ' + nome); }
}
function igual(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || '') + ' esperado ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a)); }
function verdade(v, msg) { if (!v) throw new Error(msg || 'falso'); }

const conteudoOk = () => ({
  assunto: 'Assunto de teste', preheader: 'Prévia', h1: 'Título <teste>', linha_fina: 'Resumo',
  kpis: [{ valor: '10 mi', rotulo: 'pneus' }, { valor: '+5%', rotulo: 'no ano' }, { valor: '60%', rotulo: 'importados' }],
  abertura: ['Abertura com dado [1].'],
  secoes: [
    { titulo: 'Seção A', paragrafos: ['Número X [1] e Y [2].'], caixa: { rotulo: 'Nossa leitura', texto: 'Leitura [3].' } },
    { titulo: 'Seção B', pontos: [{ lead: 'Ponto.', texto: 'Explica [2,3].' }] },
  ],
  fecho: 'Até quarta.',
  fontes: [
    { veiculo: 'Fonte A', titulo: 'Matéria A', data: '01/10/2026', url: 'https://exemplo.com/a' },
    { veiculo: 'Fonte B', titulo: 'Matéria B', data: '02/10/2026', url: 'https://exemplo.com/b' },
    { veiculo: 'Fonte C', titulo: 'Matéria C', data: '03/10/2026', url: 'https://exemplo.com/c' },
  ],
  notas_revisao: [],
});

console.log('\nRadar IMPAK — agenda');
// 2026-10-19 é segunda; 09:10 UTC = 06:10 em Brasília
teste('segunda 6h10 (Brasília) → edição de pneus', () => igual(N.edicaoDoMomento('2026-10-19T09:10:00Z'), 'pneus'));
teste('segunda 5h50 → ainda não', () => igual(N.edicaoDoMomento('2026-10-19T08:50:00Z'), null));
teste('quarta 6h → edição de câmbio', () => igual(N.edicaoDoMomento('2026-10-21T09:05:00Z'), 'cambio'));
teste('terça → nada', () => igual(N.edicaoDoMomento('2026-10-20T12:00:00Z'), null));
teste('domingo 23h UTC é domingo 20h em Brasília (fuso certo)', () => igual(N.agoraSP('2026-10-25T23:00:00Z').diaSemana, 0));
teste('data por extenso', () => igual(N.dataExtenso('2026-10-21'), 'Quarta-feira, 21 de outubro de 2026'));

console.log('\nFollow-up semanal na segunda, depois da importação');
const seg = (h) => ({ diaSemana: 1, hora: h, dataISO: '2026-10-26' });
const opts = { horaLimite: 14, desde: '2026-10-26' };
teste('importação na segunda → envia na hora', () => igual(N.decidirFollowUp(seg(9), 'importacao', opts), 'importacao'));
teste('segunda 10h sem importação → espera', () => igual(N.decidirFollowUp(seg(10), 'relogio', opts), null));
teste('segunda 14h sem importação → envia com aviso', () => igual(N.decidirFollowUp(seg(14), 'relogio', opts), 'limite'));
teste('domingo → não envia mais', () => igual(N.decidirFollowUp({ diaSemana: 0, hora: 10, dataISO: '2026-10-25' }, 'relogio', opts), null));
teste('importação na terça → não dispara follow-up', () => igual(N.decidirFollowUp({ diaSemana: 2, hora: 9, dataISO: '2026-10-27' }, 'importacao', opts), null));
teste('antes da data de início → não envia', () => igual(N.decidirFollowUp({ diaSemana: 1, hora: 15, dataISO: '2026-10-19' }, 'relogio', opts), null));

console.log('\nRadar IMPAK — montagem do e-mail');
teste('citação [n] vira número com link da fonte', () => {
  const h = N.comCitacoes('Dado [2].', conteudoOk().fontes);
  verdade(h.includes('<sup') && h.includes('href="https://exemplo.com/b"') && h.includes('>2</a>'), h);
});
teste('citação de fonte inexistente some (não vira link quebrado)', () => {
  igual(N.comCitacoes('Dado [9].', conteudoOk().fontes), 'Dado.');
});
teste('texto da IA é escapado (sem HTML injetado)', () => {
  const h = N.montarHtml('pneus', conteudoOk(), { logoUrl: 'https://x/logo.png', dataExtenso: 'Segunda' });
  verdade(h.includes('Título &lt;teste&gt;') && !h.includes('Título <teste>'));
});
teste('e-mail tem logo, fontes numeradas, caixa e rodapé da edição', () => {
  const h = N.montarHtml('cambio', conteudoOk(), { logoUrl: 'https://x/logo.png', dataExtenso: 'Quarta' });
  verdade(h.includes('src="https://x/logo.png"'), 'logo');
  verdade(h.includes('Matéria C') && h.includes('3.</td>'), 'fontes');
  verdade(h.includes('Nossa leitura'), 'caixa');
  verdade(h.includes('Não constitui recomendação'), 'rodapé câmbio');
  verdade(h.includes('Radar IMPAK · Câmbio'), 'edição');
});
teste('notas para o revisor ficam numa caixa "apague antes de encaminhar"', () => {
  const c = conteudoOk(); c.notas_revisao = ['Confirmar reajuste'];
  const h = N.montarHtml('pneus', c, { notas: ['Fonte 2 não abriu'] });
  verdade(h.includes('apague esta caixa antes de encaminhar') && h.includes('Confirmar reajuste') && h.includes('Fonte 2 não abriu'));
});
teste('sem notas → sem caixa de revisão', () => {
  verdade(!N.montarHtml('pneus', conteudoOk(), {}).includes('Só para revisão'));
});
teste('link de fonte que não é http vira "#"', () => {
  const c = conteudoOk(); c.fontes[0].url = 'javascript:alert(1)';
  verdade(!N.montarHtml('pneus', c, {}).includes('javascript:'));
});

console.log('\nRadar IMPAK — conferência do conteúdo da IA');
teste('conteúdo completo passa', () => igual(N.validarConteudo(conteudoOk()), []));
teste('poucas fontes / citação sem fonte são recusadas', () => {
  const c = conteudoOk(); c.fontes = c.fontes.slice(0, 2);
  const e = N.validarConteudo(c);
  verdade(e.includes('menos de 3 fontes') && e.some(x => x.includes('[3] sem fonte')), JSON.stringify(e));
});
teste('texto sem nenhuma citação é recusado', () => {
  const c = conteudoOk(); c.abertura = ['Sem fonte.']; c.secoes = [{ titulo: 'A', paragrafos: ['x'] }, { titulo: 'B', paragrafos: ['y'] }];
  verdade(N.validarConteudo(c).includes('texto sem nenhuma citação de fonte'));
});
teste('extrai JSON entre <json> e também de bloco ```json', () => {
  igual(N.extrairJson('bla <json>{"a":1}</json> fim'), { a: 1 });
  igual(N.extrairJson('```json\n{"b":2}\n```'), { b: 2 });
  igual(N.extrairJson('sem json'), null);
});
teste('pedido de pneus traz a regra do revisor sobre reajuste das fábricas', () => {
  const p = N.pedido('pneus', '2026-10-26');
  verdade(/reajuste/i.test(p) && /nunca diga que o custo está aliviando/i.test(p));
});
teste('minutos de leitura', () => igual(N.minutosLeitura(conteudoOk()), 2));

console.log('\nRadar IMPAK — chamada à IA e conferência de links (simulado)');
teste('continua quando a busca pausa (pause_turn) e lê o JSON final', async () => {
  let chamadas = 0;
  const fakeFetch = async (url, init) => {
    chamadas++;
    const body = JSON.parse(init.body);
    if (chamadas === 1) {
      verdade(body.tools && body.tools[0].name === 'web_search', 'ferramenta de busca');
      return { status: 200, json: async () => ({ stop_reason: 'pause_turn', content: [{ type: 'text', text: 'pesquisando' }], usage: { server_tool_use: { web_search_requests: 3 } } }) };
    }
    verdade(body.messages.length === 2 && body.messages[1].role === 'assistant', 'continua a conversa');
    return { status: 200, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '<json>' + JSON.stringify(conteudoOk()) + '</json>' }], usage: { server_tool_use: { web_search_requests: 2 } } }) };
  };
  const r = await N.gerarConteudo('pneus', '2026-10-26', { apiKey: 'chave-de-teste-ficticia-123456', fetchImpl: fakeFetch });
  igual(r.buscas, 5); igual(r.conteudo.assunto, 'Assunto de teste');
});
teste('prepararEdicao: assunto "Para revisão" e link quebrado vira nota', async () => {
  const fakeFetch = async (url) => {
    if (String(url).includes('anthropic')) return { status: 200, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '<json>' + JSON.stringify(conteudoOk()) + '</json>' }] }) };
    if (String(url).endsWith('/b')) return { status: 404 };
    if (String(url).endsWith('/c')) return { status: 403 }; // site que bloqueia robô: não acusa
    return { status: 200 };
  };
  const r = await N.prepararEdicao('pneus', { apiKey: 'chave-de-teste-ficticia-123456', fetchImpl: fakeFetch, hojeISO: '2026-10-26', logoUrl: 'https://x/l.png' });
  igual(r.assunto, 'Para revisão: Radar IMPAK · Pneus (26/10) — Assunto de teste');
  igual(r.avisos.length, 1);
  verdade(r.avisos[0].includes('Fonte 2') && r.html.includes('apague esta caixa'), r.avisos[0]);
});
teste('conteúdo inválido duas vezes → erro (nada é enviado)', async () => {
  const fakeFetch = async () => ({ status: 200, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'não consegui' }] }) });
  let erro = null;
  try { await N.prepararEdicao('cambio', { apiKey: 'chave-de-teste-ficticia-123456', fetchImpl: fakeFetch, hojeISO: '2026-10-21' }); } catch (e) { erro = e; }
  verdade(erro && /conteúdo inválido/.test(erro.message), erro && erro.message);
});

Promise.all(filaAsync).then(() => {
  console.log(`\nTotal: ${ok + falha} testes, ${ok} passaram, ${falha} falharam`);
  process.exit(falha ? 1 : 0);
});
