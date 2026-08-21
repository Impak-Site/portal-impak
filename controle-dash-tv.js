// controle-dash-tv.js
//
// Dashboard TV — tela ao vivo pensada pra ficar espelhada num monitor da
// empresa (substitui a planilha Excel "00-DASHBOARDOPERACIONAL" que era
// atualizada manualmente 1x/dia). Como os dados vêm direto de _processos
// (mesma fonte da tabela principal), não precisa de atualização manual —
// só precisa que a página fique aberta e recarregue os processos de tempos
// em tempos (ver setIntervalAtualizacaoTV() em controle-core.js).
//
// Três painéis, com os mesmos critérios usados hoje na planilha (confirmado
// com o usuário em 19/08/2026):
//   1. BACKORDERS — processos que ainda não embarcaram (fase PI ou
//      Aguardando Embarque), agrupados por marca/fábrica, em containers.
//   2. EM ÁGUAS — processos já embarcados (fase Embarcado), ordenados por
//      ETA, em containers.
//   3. NO CHÃO — processos com NF de Entrada lançada e ainda sem venda
//      (NF de Saída vazia ou CFOP 5905 = remessa interna, não é venda real),
//      agrupados por descrição do produto, em unidades. Mesmo critério já
//      usado em "estoque parado" no Dashboard Narcélio (controle-dash-
//      narcelio.js) — reaproveitado aqui pra não duplicar a regra de
//      negócio em dois lugares com definições ligeiramente diferentes.
//
// Parte do controle_v2.html, carregado via <script src> — não é ES module.
// Depende de: _processos, containersDoProcesso, calcularFase, esc(),
// parseDataLocal (controle-core.js).

function toggleDashTV(){
  const el = document.getElementById('dash-tv');
  if(!el) return;
  const visivel = el.style.display !== 'none';
  if(!visivel) fecharTodosDashboards();
  document.querySelector('.table-wrap') && (document.querySelector('.table-wrap').style.display = visivel ? '' : 'none');
  el.style.display = visivel ? 'none' : 'block';
  if(!visivel) renderDashTV();
  document.getElementById('menu-tv')?.classList.toggle('active', !visivel);
}

// Cada TV física da empresa mostra só 1 painel em tela cheia (mais legível
// à distância do que os 3 espremidos numa tela só) — escolhido pela URL:
//   /tv?painel=backorders   /tv?painel=aguas   /tv?painel=chao
// Sem o parâmetro (ou valor desconhecido), mostra os 3 empilhados, útil
// pra conferir tudo de perto num notebook/monitor comum.
function _tvPainelAtivo(){
  const v = new URLSearchParams(location.search).get('painel');
  return ['backorders','aguas','chao'].includes(v) ? v : 'todos';
}

function renderDashTV(){
  const el = document.getElementById('dash-tv-content');
  if(!el) return;
  const painelAtivo = _tvPainelAtivo();
  const solo = painelAtivo !== 'todos';
  const maxH = solo ? 'calc(100vh - 260px)' : '340px';

  // ── 1: BACKORDERS — por marca/fábrica, em containers ──────────
  // Agrupa por marca normalizada (maiúsculo/minúsculo não deveria separar
  // "Eudemon" de "EUDEMON" em containers diferentes) — a chave do
  // agrupamento é a versão em CAIXA ALTA, mas guarda a primeira grafia
  // encontrada só pra exibição não ficar feia gritando tudo maiúsculo à toa
  // quando o cadastro já está com a grafia "bonita".
  const backordersPorMarca = {}; // chave normalizada -> quantidade
  const backordersLabel = {}; // chave normalizada -> rótulo de exibição
  let backordersTotal = 0;
  _processos.forEach(p => {
    const fase = calcularFase(p);
    if(fase !== 'PI' && fase !== 'AGUARDANDO_EMBARQUE') return;
    const n = containersDoProcesso(p).length || (p.container ? 1 : 0) || 1;
    const marcaOriginal = (p.brand || p.fornecedor || 'Sem marca').trim();
    const chave = marcaOriginal.toUpperCase();
    backordersPorMarca[chave] = (backordersPorMarca[chave] || 0) + n;
    if(!backordersLabel[chave]) backordersLabel[chave] = marcaOriginal;
    backordersTotal += n;
  });
  const backordersLista = Object.entries(backordersPorMarca)
    .map(([chave,qtd]) => [backordersLabel[chave], qtd])
    .sort((a,b) => b[1]-a[1]);
  const backordersPrincipais = backordersLista.slice(0, 4);
  const backordersResto = backordersLista.slice(4);

  // ── 2: EM ÁGUAS — fase Embarcado, ordenado por ETA ────────────
  const FINALIDADE_LABEL_TV = {IMPORTACAO_DIRETA:'Direto', ENCOMENDA:'Encomenda', CONTA_E_ORDEM:'Conta e Ordem'};
  const emAguasLista = [];
  _processos.forEach(p => {
    if(calcularFase(p) !== 'EMBARCADO') return;
    const n = containersDoProcesso(p).length || (p.container ? 1 : 0) || 1;
    emAguasLista.push({ referencia: p.referencia, cliente: p.cliente, eta: p.eta, n, finalidade: FINALIDADE_LABEL_TV[p.finalidade] || '—' });
  });
  emAguasLista.sort((a,b) => (a.eta||'9999').localeCompare(b.eta||'9999'));
  const emAguasTotal = emAguasLista.reduce((s,x)=> s+x.n, 0);

  // ── 3: NO CHÃO — NF Entrada lançada + sem venda real ──────────
  // Mesmo critério de "estoque parado" do Dashboard Narcélio: NF Saída
  // vazia OU CFOP 5905 (remessa interna, não representa venda).
  const noChaoPorProduto = {};
  let noChaoTotalUn = 0, noChaoProcessos = 0;
  _processos.forEach(p => {
    if(!p.nf_entrada_numero) return;
    const semVenda = p.nf_saida_cfop === '5905' || !p.nf_saida_numero;
    if(!semVenda) return;
    noChaoProcessos++;
    let produtos = [];
    try{ produtos = JSON.parse(p.produtos_json || '[]'); }catch(e){ /* ignora produtos_json inválido */ }
    if(!Array.isArray(produtos) || !produtos.length){
      if(p.produto) produtos = [{ descricao: p.produto, quantidade: null }];
    }
    produtos.forEach(it => {
      const desc = (it.descricao || 'Sem descrição').trim();
      const qtd = parseFloat(it.quantidade) || 0;
      noChaoPorProduto[desc] = (noChaoPorProduto[desc] || 0) + qtd;
      noChaoTotalUn += qtd;
    });
  });
  const noChaoLista = Object.entries(noChaoPorProduto).sort((a,b) => b[1]-a[1]);

  const fmtN = v => v.toLocaleString('pt-BR');

  // No modo solo (1 TV = 1 painel) tudo fica maior — é pra ler de longe,
  // não numa tela de notebook a 40cm do rosto.
  function painel(titulo, subtitulo, numero, corBg, conteudoHtml){
    const tituloSz = solo ? '30px' : '19px';
    const subSz = solo ? '15px' : '12px';
    const numSz = solo ? '58px' : '38px';
    const padHeader = solo ? '24px 32px' : '16px 24px';
    const padBody = solo ? '26px 32px' : '18px 24px';
    return `<div style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.08);margin-bottom:22px;">
      <div style="background:linear-gradient(90deg,${corBg} 0%,#1a3a6e 100%);padding:${padHeader};display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="font-family:'Syne',sans-serif;font-size:${tituloSz};font-weight:800;color:#fff;letter-spacing:.3px;">${titulo}</div>
          <div style="font-size:${subSz};color:rgba(255,255,255,.75);margin-top:2px;">${subtitulo}</div>
        </div>
        <div style="font-family:'DM Sans',sans-serif;font-size:${numSz};font-weight:800;color:#fff;">${numero}</div>
      </div>
      <div style="padding:${padBody};font-size:${solo?'1.15em':'1em'};">${conteudoHtml}</div>
    </div>`;
  }

  function cardMarca(nome, qtd, maxQtd){
    const pct = maxQtd > 0 ? Math.round((qtd/maxQtd)*100) : 0;
    return `<div style="background:var(--bg);border-radius:10px;padding:12px 14px;">
      <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px;">${esc(nome)}</div>
      <div style="font-size:26px;font-weight:800;color:#1a3a6e;font-family:'DM Sans',sans-serif;">${fmtN(qtd)} <span style="font-size:12px;font-weight:600;color:var(--muted);">containers</span></div>
      <div style="background:#e2e8f0;border-radius:4px;height:5px;margin-top:8px;overflow:hidden;"><div style="background:#1a3a6e;height:100%;width:${pct}%;"></div></div>
    </div>`;
  }

  const backordersHtml = backordersLista.length ? `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:${backordersResto.length?'14px':'0'};">
      ${backordersPrincipais.map(([m,q]) => cardMarca(m, q, backordersPrincipais[0][1])).join('')}
    </div>
    ${backordersResto.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:6px;">
      ${backordersResto.map(([m,q]) => `<div style="display:flex;justify-content:space-between;background:#0f1f3d;color:#fff;border-radius:6px;padding:8px 12px;font-size:12px;">
        <span style="font-weight:700;">${esc(m)}</span><span style="font-weight:800;">${fmtN(q)}</span>
      </div>`).join('')}
    </div>` : ''}
  ` : `<div style="font-size:13px;color:var(--muted);">Nenhum processo aguardando embarque.</div>`;

  const emAguasHtml = emAguasLista.length ? `
    <div style="max-height:${maxH};overflow-y:auto;">
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="text-align:left;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.4px;">
        <th style="padding:6px 8px;">ETA</th><th style="padding:6px 8px;">Processo</th><th style="padding:6px 8px;">Cliente</th><th style="padding:6px 8px;">Finalidade</th><th style="padding:6px 8px;text-align:right;">Containers</th>
      </tr></thead>
      <tbody>${emAguasLista.map(x => `<tr style="border-top:1px solid var(--border);">
        <td style="padding:6px 8px;font-weight:700;">${x.eta ? new Date(x.eta+'T00:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'short'}) : '—'}</td>
        <td style="padding:6px 8px;">${esc(x.referencia)}</td>
        <td style="padding:6px 8px;color:var(--muted);">${esc(x.cliente||'')}</td>
        <td style="padding:6px 8px;">${esc(x.finalidade)}</td>
        <td style="padding:6px 8px;text-align:right;font-weight:700;">${x.n}</td>
      </tr>`).join('')}</tbody>
    </table>
    </div>
  ` : `<div style="font-size:13px;color:var(--muted);">Nenhum processo embarcado no momento.</div>`;

  const noChaoHtml = noChaoLista.length ? `
    <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">${noChaoProcessos} processo(s) · ${fmtN(Math.round(noChaoTotalUn))} unidades no total</div>
    <div style="max-height:${maxH};overflow-y:auto;">
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tbody>${noChaoLista.map(([desc,qtd]) => `<tr style="border-top:1px solid var(--border);">
        <td style="padding:6px 8px;">${esc(desc)}</td>
        <td style="padding:6px 8px;text-align:right;font-weight:700;white-space:nowrap;">${fmtN(Math.round(qtd))} un.</td>
      </tr>`).join('')}</tbody>
    </table>
    </div>
  ` : `<div style="font-size:13px;color:var(--muted);">Nenhum processo com estoque parado no armazém.</div>`;

  const paineis = {
    backorders: painel('BACKORDERS', 'Visão por marca / fábrica — ainda não embarcados', fmtN(backordersTotal), '#2a5298', backordersHtml),
    aguas: painel('EM ÁGUAS', 'Em trânsito para o Brasil', fmtN(emAguasTotal), '#1e6091', emAguasHtml),
    chao: painel('NO CHÃO', 'NF de Entrada lançada, ainda sem venda', fmtN(noChaoProcessos), '#184e77', noChaoHtml),
  };

  // No modo "todos" (visão de conferência, não a TV física), mostra links
  // pra abrir cada painel isolado em tela cheia — é só apontar o navegador
  // de cada TV pra uma dessas URLs (uma aba por TV, cada uma num painel).
  const linksSolo = !solo ? `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;font-size:12px;">
    <span style="color:var(--muted);align-self:center;">Abrir 1 painel em tela cheia (uma URL por TV):</span>
    <a href="/tv?painel=backorders" style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:5px 10px;text-decoration:none;color:var(--text);font-weight:600;">Backorders ↗</a>
    <a href="/tv?painel=aguas" style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:5px 10px;text-decoration:none;color:var(--text);font-weight:600;">Em Águas ↗</a>
    <a href="/tv?painel=chao" style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:5px 10px;text-decoration:none;color:var(--text);font-weight:600;">No Chão ↗</a>
  </div>` : '';

  el.innerHTML = solo ? paineis[painelAtivo] : (linksSolo + paineis.backorders + paineis.aguas + paineis.chao);
  el.classList.toggle('dash-tv-solo', solo);
}
