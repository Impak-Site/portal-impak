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

// Nome do cliente abreviado — pedido da Emanuelly (21/08/2026): o nome
// completo (razão social, às vezes 40+ caracteres) obriga a tabela a
// quebrar linha e deixa a fonte pequena de mais pra ler de longe na TV.
// Mantém um "apelido comercial" fixo pros clientes mais recorrentes (igual
// a planilha antiga já fazia — inclusive alguns apelidos, tipo "Irmãos
// Silva S/A" = "Sta Helena", não têm nenhuma relação com a razão social e
// não dá pra deduzir automaticamente). Pra qualquer cliente novo que ainda
// não está aqui, cai num fallback genérico que tenta cortar os sufixos
// jurídicos/descritivos comuns (LTDA, COMERCIO DE PNEUS, etc.) e usa a
// primeira palavra que sobrar — não é perfeito, mas já ajuda. Se aparecer
// um apelido errado/estranho na TV, é só adicionar a razão social exata
// (em maiúsculas) aqui embaixo.
const CLIENTE_APELIDO_TV = {
  'UNICAP COMERCIO DE PNEUS NOVOS LTDA': 'UNICAP',
  'CDO ATACADISTA DE PNEUS LTDA': 'CDO',
  'PNEUSCAR RECAUCHUTAGEM LTDA': 'PNEUSCAR',
  'IMPAK COMERCIAL E IMPORTADORA LTDA': 'IMPAK',
  'IRMAOS SILVA S/A': 'STA HELENA',
  'IRMÃOS SILVA S/A': 'STA HELENA',
  'TRILL CONSTRUTORA LTDA': 'TRILL/JOUBERT',
  'ALTA PERFORMANCE RECAUCHUTADORA E R': 'ALTA',
  'TWI COMERCIO DE PNEUS LTDA': 'TWI',
  'PNEUS EXPRESS COMERCIO DE PNEUS LTD': 'PNEUS EXPRESS',
  'F. VACHILESKI & CIA LTDA': 'VACHILESKI',
  'RECAPADORA DE PNEUS CCN LTDA': 'CCN',
  'OST RENOVADORA DE PNEUS LTDA': 'OST',
};
// Palavras genéricas (sufixo jurídico ou descritivo do ramo) que não ajudam
// a identificar QUAL cliente é — descartadas no fallback automático.
const PALAVRAS_GENERICAS_CLIENTE_TV = new Set([
  'LTDA','LTD','SA','S/A','EIRELI','ME','EPP','CIA','&',
  'COMERCIO','COMERCIAL','IMPORTADORA','ATACADISTA','ATACADISTA DE',
  'RECAUCHUTAGEM','RECAUCHUTADORA','RENOVADORA','RECAPADORA','CONSTRUTORA',
  'PNEUS','PNEUS NOVOS','NOVOS','DE','DA','DO','E',
]);
function abreviarClienteTV(nomeCompleto){
  const nome = (nomeCompleto || '').trim();
  if(!nome) return '';
  const chave = nome.toUpperCase();
  if(CLIENTE_APELIDO_TV[chave]) return CLIENTE_APELIDO_TV[chave];
  const palavras = chave.replace(/[.,]/g, '').split(/\s+/)
    .filter(w => w && !PALAVRAS_GENERICAS_CLIENTE_TV.has(w) && w.length > 1);
  if(palavras.length) return palavras[0];
  // Não sobrou nada reconhecível (nome só com palavras genéricas/iniciais)
  // — melhor mostrar a primeira palavra original do que nada.
  return nome.split(/\s+/)[0] || nome;
}

function toggleDashTV(){
  const el = document.getElementById('dash-tv');
  if(!el) return;
  const visivel = el.style.display !== 'none';
  if(!visivel) fecharTodosDashboards();
  document.querySelector('.table-wrap') && (document.querySelector('.table-wrap').style.display = visivel ? '' : 'none');
  el.style.display = visivel ? 'none' : 'block';
  ELEMENTOS_TOPO_DASHBOARD.forEach(id => { const alvo = document.getElementById(id); if(alvo) alvo.style.display = visivel ? '' : 'none'; });
  const toolbarTV = document.querySelector('.toolbar');
  if(toolbarTV) toolbarTV.style.display = visivel ? '' : 'none';
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
  const backordersProcessos = {}; // chave normalizada -> [{id,referencia,cliente,n,eta}]
  let backordersTotal = 0;
  let backordersProcessosTotal = 0;
  _processos.forEach(p => {
    if(p.cancelado) return; // processo cancelado não conta como backorder
    const fase = calcularFase(p);
    if(fase !== 'PI' && fase !== 'AGUARDANDO_EMBARQUE') return;
    // Prioridade pra saber a quantidade de containers: containers já
    // lançados (containers_json) > campo legado "container" único >
    // "Qtd. Containers (previsto)" (preenchido no PI, antes de ter
    // container/booking) > 1 como último recurso. Pedido da Emanuelly
    // (21/08/2026): sem essa previsão, o Backorders só sabia quantos
    // containers um processo tinha depois que os números eram lançados —
    // tarde de mais pra bater com a bonificação por containers recebidos
    // no mês, que depende de saber isso com antecedência.
    const n = containersDoProcesso(p).length || (p.container ? 1 : 0) || (parseInt(p.qtd_containers_prevista, 10) || 0) || 1;
    const marcaOriginal = (p.brand || p.fornecedor || 'Sem marca').trim();
    const chave = marcaOriginal.toUpperCase();
    backordersPorMarca[chave] = (backordersPorMarca[chave] || 0) + n;
    if(!backordersLabel[chave]) backordersLabel[chave] = marcaOriginal;
    if(!backordersProcessos[chave]) backordersProcessos[chave] = [];
    backordersProcessos[chave].push({ id: p.id, referencia: p.referencia, cliente: p.cliente, n, eta: p.eta || '' });
    backordersTotal += n;
    backordersProcessosTotal++;
  });
  const backordersLista = Object.entries(backordersPorMarca)
    .map(([chave,qtd]) => [backordersLabel[chave], qtd, chave])
    .sort((a,b) => b[1]-a[1]);
  const backordersPrincipais = backordersLista.slice(0, 4);
  const backordersResto = backordersLista.slice(4);

  // Guarda os processos de cada marca num lugar acessível pro onclick dos
  // cards (abrirListaTV) — pedido da Emanuelly (21/08/2026): "clicar dentro
  // e aparecer todos que ele está considerando". Mesmo padrão de modal já
  // usado no Dashboard Narcélio (controle-dash-narcelio.js).
  window._tvListasBackorders = {};
  Object.entries(backordersProcessos).forEach(([chave, rows]) => {
    window._tvListasBackorders[chave] = { titulo: backordersLabel[chave], rows };
  });

  // ── 2: EM ÁGUAS — fase Embarcado, ordenado por ETA ────────────
  const FINALIDADE_LABEL_TV = {IMPORTACAO_DIRETA:'D', ENCOMENDA:'E', CONTA_E_ORDEM:'C'};
  const emAguasLista = [];
  // Tally por marca também aqui — usado no totalizador MARCA/TOTAL/BACKORDERS/
  // EM ÁGUAS do painel Backorders (pedido do Ayslan 08/09/2026, baseado na
  // planilha antiga "00-DASHBOARDOPERACIONAL"), sem duplicar a regra de
  // agrupamento por marca já usada acima em backordersPorMarca.
  const emAguasPorMarca = {};
  _processos.forEach(p => {
    if(p.cancelado) return; // processo cancelado não conta como em águas
    if(calcularFase(p) !== 'EMBARCADO') return;
    const n = containersDoProcesso(p).length || (p.container ? 1 : 0) || 1;
    emAguasLista.push({ referencia: p.referencia, cliente: abreviarClienteTV(p.cliente), eta: p.eta, n, finalidade: FINALIDADE_LABEL_TV[p.finalidade] || '—' });
    const chaveMarca = (p.brand || p.fornecedor || 'Sem marca').trim().toUpperCase();
    emAguasPorMarca[chaveMarca] = (emAguasPorMarca[chaveMarca] || 0) + n;
  });
  emAguasLista.sort((a,b) => (a.eta||'9999').localeCompare(b.eta||'9999'));
  const emAguasTotal = emAguasLista.reduce((s,x)=> s+x.n, 0);

  // ── 3: NO CHÃO — NF Entrada lançada + sem venda real ──────────
  // Mesmo critério de "estoque parado" do Dashboard Narcélio: NF Saída
  // vazia OU CFOP 5905 (remessa interna, não representa venda).
  const noChaoPorProduto = {};
  let noChaoTotalUn = 0, noChaoProcessos = 0;
  _processos.forEach(p => {
    if(p.cancelado) return; // processo cancelado não conta como estoque parado
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

  // ── Métricas extras do "NO CHÃO" (layout da planilha antiga "00-
  // DASHBOARDOPERACIONAL V7"), pedido do Ayslan (08/09/2026) — redesenhar
  // o painel /tv?painel=chao pra bater com a tela "NO CHÃO - No porto ou
  // Armazém" que a Emanuelly usava antes do sistema. Definições confirmadas
  // com o Ayslan:
  //   PREVISTO MÊS = containers de processos (não cancelados) cujo ETA cai
  //                   no mês corrente (independente da fase).
  //   NO MÊS       = containers de processos cuja Data de Registro da DI
  //                   cai no mês corrente — MESMO critério já usado em
  //                   calcularRelatorioNarcelio() (controle-dashboards.js),
  //                   recalculado aqui pra não depender de outro arquivo
  //                   ter carregado primeiro.
  const _hojeChao = new Date();
  const _mesRefChao = _hojeChao.getMonth(), _anoRefChao = _hojeChao.getFullYear();
  const _noMesChao = dataStr => {
    if(!dataStr) return false;
    const dt = parseDataLocal(dataStr);
    return !!dt && dt.getMonth() === _mesRefChao && dt.getFullYear() === _anoRefChao;
  };

  const previstoMesPorMarca = {}; // chave normalizada -> containers
  const previstoMesProcessos = []; // {referencia,cliente,eta,n}
  let previstoMesContainers = 0;
  _processos.forEach(p => {
    if(p.cancelado) return;
    if(!_noMesChao(p.eta)) return;
    const n = containersDoProcesso(p).length || (p.container ? 1 : 0) || (parseInt(p.qtd_containers_prevista, 10) || 0) || 1;
    const chaveMarca = (p.brand || p.fornecedor || 'Sem marca').trim().toUpperCase();
    previstoMesPorMarca[chaveMarca] = (previstoMesPorMarca[chaveMarca] || 0) + n;
    previstoMesProcessos.push({ referencia: p.referencia, cliente: p.cliente, eta: p.eta, n });
    previstoMesContainers += n;
  });
  previstoMesProcessos.sort((a,b) => (a.eta||'9999').localeCompare(b.eta||'9999'));

  const noMesPorMarca = {}; // chave normalizada -> containers
  let noMesContainers = 0;
  _processos.forEach(p => {
    if(p.cancelado) return;
    if(!_noMesChao(p.data_registro_di)) return;
    const n = containersDoProcesso(p).length || (p.container ? 1 : 0) || 1;
    const chaveMarca = (p.brand || p.fornecedor || 'Sem marca').trim().toUpperCase();
    noMesPorMarca[chaveMarca] = (noMesPorMarca[chaveMarca] || 0) + n;
    noMesContainers += n;
  });

  // Container por mês (últimos 6 meses, incl. o corrente) — por Data de
  // Registro da DI, mesma fonte do "NO MÊS" acima. Container por dia (ETA)
  // — só os dias do mês corrente, mesma fonte do "PREVISTO MÊS".
  const containerPorMes = []; // [{label, qtd}] mais antigo -> mais recente
  {
    const contagem = {};
    _processos.forEach(p => {
      if(p.cancelado) return;
      const dt = parseDataLocal(p.data_registro_di);
      if(!dt) return;
      const chave = dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0');
      contagem[chave] = (contagem[chave] || 0) + (containersDoProcesso(p).length || 1);
    });
    for(let i=5; i>=0; i--){
      const d = new Date(_anoRefChao, _mesRefChao - i, 1);
      const chave = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
      containerPorMes.push({ label: d.toLocaleDateString('pt-BR',{month:'short'}).replace('.','').toUpperCase(), qtd: contagem[chave] || 0 });
    }
  }
  const containerPorDiaEta = []; // [{dia, qtd}] só dias do mês corrente
  {
    const contagem = {};
    _processos.forEach(p => {
      if(p.cancelado) return;
      if(!_noMesChao(p.eta)) return;
      const dt = parseDataLocal(p.eta);
      if(!dt) return;
      contagem[dt.getDate()] = (contagem[dt.getDate()] || 0) + (containersDoProcesso(p).length || (p.container?1:0) || (parseInt(p.qtd_containers_prevista,10)||0) || 1);
    });
    const ultimoDia = new Date(_anoRefChao, _mesRefChao+1, 0).getDate();
    for(let dia=1; dia<=ultimoDia; dia++){
      if(contagem[dia]) containerPorDiaEta.push({ dia, qtd: contagem[dia] });
    }
  }

  const fmtN = v => v.toLocaleString('pt-BR');

  // No modo solo (1 TV = 1 painel) tudo fica maior — é pra ler de longe,
  // não numa tela de notebook a 40cm do rosto.
  // Botão "Voltar" — só aparece no modo solo (1 TV = 1 painel via
  // ?painel=X), pedido do Ayslan (08/09/2026): "quando entrar em alguma
  // tela da tv" precisa de um jeito de sair de volta pra visão geral
  // (/tv, sem parâmetro — mostra os 3 painéis empilhados + os links pra
  // abrir cada 1 sozinho). Fixo no canto superior esquerdo, por cima do
  // cabeçalho colorido de cada painel, com z-index alto pra não ficar
  // escondido atrás de nada.
  function botaoVoltarTV(){
    return `<a href="/tv" style="position:fixed;top:10px;left:10px;z-index:999;background:rgba(15,23,42,.55);color:#fff;text-decoration:none;font-size:12px;font-weight:700;padding:6px 12px;border-radius:6px;display:flex;align-items:center;gap:5px;font-family:'DM Sans',sans-serif;">&larr; Voltar</a>`;
  }

  function painel(titulo, subtitulo, numero, corBg, conteudoHtml){
    // Modo solo (1 TV = 1 painel): cabeçalho enxuto e o corpo ocupa TODA a
    // altura restante da tela (flex:1) — pedido do Ayslan (08/09/2026):
    // "diminuir um pouco o cabeçalho" pra sobrar mais espaço vertical pras
    // linhas de processos, igual a planilha antiga (que não tinha cabeçalho
    // nenhum, só a tabela). Sem card/sombra/margem em modo solo (edge-to-
    // edge) — cada pixel de borda é espaço a menos pra caber processo.
    if(solo){
      return `<div style="height:100vh;display:flex;flex-direction:column;background:#fff;">
        ${botaoVoltarTV()}
        <div style="background:linear-gradient(90deg,${corBg} 0%,#1a3a6e 100%);padding:1.1vh 26px;display:flex;align-items:center;justify-content:space-between;flex:0 0 auto;box-shadow:0 2px 10px rgba(0,0,0,.12);">
          <div>
            <div style="font-family:'Syne',sans-serif;font-size:clamp(18px,2.5vh,34px);font-weight:800;color:#fff;letter-spacing:.3px;">${titulo}</div>
            <div style="font-size:clamp(10px,1.15vh,16px);color:rgba(255,255,255,.8);margin-top:1px;">${subtitulo}</div>
          </div>
          <div style="font-family:'DM Sans',sans-serif;font-size:clamp(26px,4.4vh,66px);font-weight:800;color:#fff;line-height:1;">${numero}</div>
        </div>
        <div style="flex:1;min-height:0;padding:1.4vh 22px;display:flex;flex-direction:column;">${conteudoHtml}</div>
      </div>`;
    }
    return `<div style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.08);margin-bottom:22px;">
      <div style="background:linear-gradient(90deg,${corBg} 0%,#1a3a6e 100%);padding:16px 24px;display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="font-family:'Syne',sans-serif;font-size:19px;font-weight:800;color:#fff;letter-spacing:.3px;">${titulo}</div>
          <div style="font-size:12px;color:rgba(255,255,255,.75);margin-top:2px;">${subtitulo}</div>
        </div>
        <div style="font-family:'DM Sans',sans-serif;font-size:38px;font-weight:800;color:#fff;">${numero}</div>
      </div>
      <div style="padding:18px 24px;font-size:1em;">${conteudoHtml}</div>
    </div>`;
  }

  // Paleta fixa por marca (via hash do nome) — usada tanto no "badge" de
  // logo quanto na barra de progresso do card branco abaixo. Não existe um
  // sistema de logos de marca no portal, então o badge colorido com as
  // iniciais faz esse papel (mesma ideia visual do logo real na planilha
  // antiga, só que sem depender de imagem cadastrada).
  const PALETA_MARCA_TV = ['#2563eb','#16a34a','#ea580c','#7c3aed','#dc2626','#0891b2','#db2777','#65a30d','#0284c7','#c026d3'];
  function corMarcaTV(chave){
    let hash = 0;
    for(let i=0;i<chave.length;i++) hash = (hash*31 + chave.charCodeAt(i)) >>> 0;
    return PALETA_MARCA_TV[hash % PALETA_MARCA_TV.length];
  }
  function iniciaisMarcaTV(nome){
    const partes = (nome || '').trim().split(/\s+/).filter(Boolean);
    if(!partes.length) return '?';
    if(partes.length === 1) return partes[0].slice(0,2).toUpperCase();
    return (partes[0][0] + partes[1][0]).toUpperCase();
  }

  // Cards clicáveis — clicar numa marca abre a lista dos processos que
  // estão sendo contados ali (abrirListaTV), igual ao padrão já usado no
  // Dashboard Narcélio. chave é a marca em CAIXA ALTA, usada como índice em
  // window._tvListasBackorders (montado acima).
  //
  // Card branco com "logo" (badge de iniciais) + barra de progresso colorida
  // — pedido do Ayslan (08/09/2026), baseado no layout da planilha antiga
  // "00-DASHBOARDOPERACIONAL" (cards brancos por marca/fábrica, não tudo
  // azul). Tamanhos em "em" (não px fixo) — mesmo font-size que
  // ajustarFonteColunasTV calcula pro painel inteiro.
  function cardMarca(nome, qtd, maxQtd, chave){
    const pct = maxQtd > 0 ? Math.round((qtd/maxQtd)*100) : 0;
    const cor = corMarcaTV(chave);
    return `<div class="tv-card" onclick="abrirListaTV('${chave.replace(/'/g,"\\'")}')" title="Clique para ver os processos" style="cursor:pointer;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:1.1em 1.3em;display:flex;flex-direction:column;justify-content:center;overflow:hidden;box-shadow:0 2px 8px rgba(15,23,42,.1);">
      <div style="display:flex;align-items:center;gap:.6em;margin-bottom:.4em;overflow:hidden;">
        <div style="flex:0 0 auto;width:2.3em;height:2.3em;border-radius:7px;background:${cor};color:#fff;display:flex;align-items:center;justify-content:center;font-size:.72em;font-weight:800;font-family:'DM Sans',sans-serif;">${esc(iniciaisMarcaTV(nome))}</div>
        <div style="font-size:.85em;font-weight:800;color:#334155;text-transform:uppercase;letter-spacing:.3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(nome)}</div>
      </div>
      <div style="font-size:2.15em;font-weight:800;color:#0f1f3d;font-family:'DM Sans',sans-serif;white-space:nowrap;">${fmtN(qtd)} <span style="font-size:.42em;font-weight:600;color:#94a3b8;">containers</span></div>
      <div style="background:#e2e8f0;border-radius:4px;height:.35em;margin-top:.45em;overflow:hidden;"><div style="background:${cor};height:100%;width:${pct}%;"></div></div>
    </div>`;
  }

  // Totalizador MARCA / TOTAL / BACKORDERS / EM ÁGUAS — pedido do Ayslan
  // (08/09/2026): "a tela do backorders precisa ter essas informacoes,
  // totalizadores e afins, conforme esta o layout atual" (referência: tabela
  // da planilha antiga na tela "NO CHÃO"). Junta as duas contagens já feitas
  // acima (backordersPorMarca e emAguasPorMarca) por marca, sem duplicar
  // regra de negócio nenhuma — só soma o que já foi calculado.
  function blocoTotalizadorMarcasTV(porBackorders, porEmAguas, labelMap){
    const chaves = new Set([...Object.keys(porBackorders), ...Object.keys(porEmAguas)]);
    const linhas = Array.from(chaves).map(chave => {
      const bo = porBackorders[chave] || 0;
      const ea = porEmAguas[chave] || 0;
      return { chave, nome: labelMap[chave] || chave, bo, ea, total: bo + ea };
    }).sort((a,b) => b.total - a.total);
    if(!linhas.length) return '';
    const totalGeral = linhas.reduce((s,l)=>s+l.total,0);
    const totalBO = linhas.reduce((s,l)=>s+l.bo,0);
    const totalEA = linhas.reduce((s,l)=>s+l.ea,0);
    return `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
      <table style="width:100%;border-collapse:collapse;font-size:.8em;">
        <thead><tr style="background:#f1f5f9;text-align:left;color:#475569;text-transform:uppercase;letter-spacing:.3px;font-size:.85em;">
          <th style="padding:8px 12px;">Marca</th>
          <th style="padding:8px 12px;text-align:right;">Total</th>
          <th style="padding:8px 12px;text-align:right;">Backorders</th>
          <th style="padding:8px 12px;text-align:right;">Em Águas</th>
        </tr></thead>
        <tbody>
        ${linhas.map((l,idx) => `<tr style="border-top:1px solid #e2e8f0;color:#1e293b;${idx%2===1?'background:#e7edf5;':''}">
          <td style="padding:6px 12px;font-weight:700;">${esc(l.nome)}</td>
          <td style="padding:6px 12px;text-align:right;font-weight:800;">${fmtN(l.total)}</td>
          <td style="padding:6px 12px;text-align:right;color:#475569;">${fmtN(l.bo)}</td>
          <td style="padding:6px 12px;text-align:right;color:#475569;">${fmtN(l.ea)}</td>
        </tr>`).join('')}
        <tr style="border-top:2px solid #cbd5e1;font-weight:800;color:#0f1f3d;">
          <td style="padding:8px 12px;">TOTAL</td>
          <td style="padding:8px 12px;text-align:right;">${fmtN(totalGeral)}</td>
          <td style="padding:8px 12px;text-align:right;">${fmtN(totalBO)}</td>
          <td style="padding:8px 12px;text-align:right;">${fmtN(totalEA)}</td>
        </tr>
        </tbody>
      </table>
    </div>`;
  }

  // Linha em flex pra cada marca da lista "resto" (fora do top 4) — mesmo
  // padrão .tv-row de Em Águas/No Chão, agrupada em colunas que preenchem
  // 100% da altura restante. Antes era uma lista simples com font-size fixo
  // de 12px; agora escala junto com o resto do painel.
  function linhaBackordersRestoFlex(nome, qtd, chave, idx){
    const zebra = idx % 2 === 1 ? 'background:rgba(255,255,255,.16);' : '';
    return `<div class="tv-row" onclick="abrirListaTV('${chave.replace(/'/g,"\\'")}')" title="Clique para ver os processos" style="cursor:pointer;flex:1;min-height:0;display:flex;align-items:center;justify-content:space-between;gap:10px;${zebra}padding:0 8px;margin:0 -8px;border-radius:4px;overflow:hidden;color:#fff;">
      <span style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(nome)}</span>
      <span style="font-weight:800;white-space:nowrap;">${fmtN(qtd)}</span>
    </div>`;
  }
  function backordersRestoEmColunas(lista){
    const ALVO_POR_COLUNA = 16;
    let nCols = Math.max(1, Math.ceil(lista.length / ALVO_POR_COLUNA));
    nCols = Math.min(nCols, 5);
    const porColuna = Math.ceil(lista.length / nCols);
    const colunas = [];
    for(let i=0; i<nCols; i++) colunas.push(lista.slice(i*porColuna, (i+1)*porColuna));
    return `<div style="display:grid;grid-template-columns:repeat(${nCols},1fr);gap:14px;flex:1;min-height:0;">
      ${colunas.map(col => `<div class="tv-col" style="display:flex;flex-direction:column;height:100%;overflow:hidden;background:#0f1f3d;border-radius:8px;padding:4px 10px;">
        ${col.map(([m,q,chave],idx) => linhaBackordersRestoFlex(m,q,chave,idx)).join('')}
      </div>`).join('')}
    </div>`;
  }

  // Totalizador MARCA/TOTAL/BACKORDERS/EM ÁGUAS (ver blocoTotalizadorMarcasTV
  // acima) — mesmo em ambos os modos (solo/todos), pedido do Ayslan
  // (08/09/2026).
  const totalizadorMarcasHtml = blocoTotalizadorMarcasTV(backordersPorMarca, emAguasPorMarca, backordersLabel);
  const backordersHtml = !backordersLista.length
    ? `<div style="font-size:13px;color:var(--muted);">Nenhum processo aguardando embarque.</div>`
    : (solo ? `
    <div style="flex:1;min-height:0;display:flex;flex-direction:column;gap:14px;">
      <div style="${backordersResto.length ? 'flex:0 0 auto;' : 'flex:1;min-height:0;grid-auto-rows:1fr;'}display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px;align-items:stretch;">
        ${backordersPrincipais.map(([m,q,chave]) => cardMarca(m, q, backordersPrincipais[0][1], chave)).join('')}
      </div>
      ${backordersResto.length ? backordersRestoEmColunas(backordersResto) : ''}
      ${totalizadorMarcasHtml ? `<div style="flex:0 0 auto;max-height:34vh;overflow-y:auto;">${totalizadorMarcasHtml}</div>` : ''}
    </div>
  ` : `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px;margin-bottom:${backordersResto.length?'14px':'0'};">
      ${backordersPrincipais.map(([m,q,chave]) => cardMarca(m, q, backordersPrincipais[0][1], chave)).join('')}
    </div>
    ${backordersResto.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:6px;margin-bottom:14px;">
      ${backordersResto.map(([m,q,chave],idx) => `<div onclick="abrirListaTV('${chave.replace(/'/g,"\\'")}')" title="Clique para ver os processos" style="cursor:pointer;display:flex;justify-content:space-between;background:${idx%2===1?'#16294d':'#0f1f3d'};color:#fff;border-radius:6px;padding:9px 13px;font-size:14px;">
        <span style="font-weight:700;">${esc(m)}</span><span style="font-weight:800;">${fmtN(q)}</span>
      </div>`).join('')}
    </div>` : ''}
    ${totalizadorMarcasHtml}
  `);

  // Linha de 1 processo — usada tanto na tabela única (modo "todos") quanto
  // nas colunas do modo solo abaixo. table-layout:fixed + nowrap/ellipsis
  // em todas as colunas garante que toda linha tenha a MESMA altura mesmo
  // quando "Processo" ou "Cliente" variam de tamanho — pedido da Emanuelly
  // (21/08/2026): "alinhar para que as linhas tenham o mesmo tamanho".
  const CEL_TV = 'padding:5px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  function linhaEmAguas(x){
    // Data curta (dd/mm) em vez de "24 de ago." — cabe mais coisa na largura
    // disponível pra sobrar espaço pra aumentar a fonte.
    const etaFmt = x.eta ? new Date(x.eta+'T00:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'}) : '—';
    return `<tr style="border-top:1px solid var(--border);">
        <td style="${CEL_TV}font-weight:700;">${etaFmt}</td>
        <td style="${CEL_TV}font-weight:600;" title="${esc(x.referencia)}">${esc(x.referencia)}</td>
        <td style="${CEL_TV}color:var(--muted);" title="${esc(x.cliente||'')}">${esc(x.cliente||'')}</td>
        <td style="${CEL_TV}text-align:center;">${esc(x.finalidade)}</td>
        <td style="${CEL_TV}text-align:right;font-weight:700;">${x.n}</td>
      </tr>`;
  }
  // Larguras fixas por coluna (soma 100%) — com table-layout:fixed elas
  // valem tanto pro <thead> quanto pro <tbody>, o que é o que faz as linhas
  // alinharem certinho mesmo com conteúdo de tamanho variável.
  const theadEmAguas = `<colgroup><col style="width:14%"><col style="width:32%"><col style="width:34%"><col style="width:10%"><col style="width:10%"></colgroup>
      <thead><tr style="text-align:left;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.4px;">
        <th style="padding:5px 6px;">ETA</th><th style="padding:5px 6px;">Processo</th><th style="padding:5px 6px;">Cliente</th><th style="padding:5px 6px;text-align:center;">Fin.</th><th style="padding:5px 6px;text-align:right;">Cont.</th>
      </tr></thead>`;

  // Linha em flexbox (não <tr>) — usada só no modo solo. Diferente da linha
  // de tabela normal, o objetivo aqui NÃO é ter altura fixa em px; é dividir
  // igualmente a altura disponível entre todas as linhas da coluna
  // (flex:1), pra que a coluna inteira sempre preencha 100% da tela sem
  // sobrar nem faltar espaço — e ajustarFonteColunasTV() (abaixo) mede essa
  // altura já renderizada pra escolher o tamanho de fonte que cabe.
  function linhaEmAguasFlex(x){
    const etaFmt = x.eta ? new Date(x.eta+'T00:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'}) : '—';
    return `<div class="tv-row" style="flex:1;min-height:0;display:flex;align-items:center;border-top:1px solid var(--border);overflow:hidden;">
        <div style="width:14%;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${etaFmt}</div>
        <div style="width:32%;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(x.referencia)}">${esc(x.referencia)}</div>
        <div style="width:34%;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(x.cliente||'')}">${esc(x.cliente||'')}</div>
        <div style="width:10%;text-align:center;overflow:hidden;">${esc(x.finalidade)}</div>
        <div style="width:10%;text-align:right;font-weight:700;overflow:hidden;">${x.n}</div>
      </div>`;
  }
  const cabecalhoColFlex = `<div style="display:flex;color:var(--muted);font-size:.72em;text-transform:uppercase;letter-spacing:.4px;border-bottom:2px solid var(--border);padding-bottom:4px;flex:0 0 auto;">
      <div style="width:14%;">ETA</div><div style="width:32%;">Processo</div><div style="width:34%;">Cliente</div><div style="width:10%;text-align:center;">Fin.</div><div style="width:10%;text-align:right;">Cont.</div>
    </div>`;

  // No modo solo (1 TV dedicada a este painel), em vez de 1 tabela rolável,
  // divide a lista em colunas lado a lado — igual a planilha antiga fazia
  // (3 blocos "ETA/Processos/Cliente") — pra caber tudo sem precisar rolar
  // a tela, que era exatamente o pedido da Emanuelly (21/08/2026). Cada
  // coluna ocupa 100% da altura disponível (flex) e o Ayslan (08/09/2026)
  // pediu pra manter sempre ~22-25 processos por coluna, igual a planilha
  // Excel antiga — daí o alvo fixo abaixo em vez das faixas antigas.
  function emAguasEmColunas(lista){
    if(!lista.length) return `<div style="font-size:13px;color:var(--muted);">Nenhum processo embarcado no momento.</div>`;
    const ALVO_POR_COLUNA = 22;
    let nCols = Math.max(1, Math.ceil(lista.length / ALVO_POR_COLUNA));
    nCols = Math.min(nCols, 5); // 5 colunas já é o razoável numa TV antes de ficar ilegível de largura
    const porColuna = Math.ceil(lista.length / nCols);
    const colunas = [];
    for(let i=0; i<nCols; i++) colunas.push(lista.slice(i*porColuna, (i+1)*porColuna));
    return `<div style="display:grid;grid-template-columns:repeat(${nCols},1fr);gap:16px;flex:1;min-height:0;">
      ${colunas.map(col => `<div class="tv-col" style="display:flex;flex-direction:column;height:100%;overflow:hidden;">
        ${cabecalhoColFlex}
        <div style="flex:1;min-height:0;display:flex;flex-direction:column;">${col.map(linhaEmAguasFlex).join('')}</div>
      </div>`).join('')}
    </div>`;
  }

  // Mesma lógica de colunas em flex pra "No Chão" (lista de produtos parados)
  // — antes só existia como tabela rolável, mesmo problema que Em Águas.
  function linhaChaoFlex(desc, qtd){
    return `<div class="tv-row" style="flex:1;min-height:0;display:flex;align-items:center;justify-content:space-between;gap:10px;border-top:1px solid var(--border);overflow:hidden;">
        <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(desc)}">${esc(desc)}</div>
        <div style="font-weight:700;white-space:nowrap;">${fmtN(Math.round(qtd))} un.</div>
      </div>`;
  }
  function noChaoEmColunas(lista){
    if(!lista.length) return `<div style="font-size:13px;color:var(--muted);">Nenhum processo com estoque parado no armazém.</div>`;
    const ALVO_POR_COLUNA = 22;
    let nCols = Math.max(1, Math.ceil(lista.length / ALVO_POR_COLUNA));
    nCols = Math.min(nCols, 5);
    const porColuna = Math.ceil(lista.length / nCols);
    const colunas = [];
    for(let i=0; i<nCols; i++) colunas.push(lista.slice(i*porColuna, (i+1)*porColuna));
    return `<div style="display:grid;grid-template-columns:repeat(${nCols},1fr);gap:16px;flex:1;min-height:0;">
      ${colunas.map(col => `<div class="tv-col" style="display:flex;flex-direction:column;height:100%;overflow:hidden;">
        <div style="flex:1;min-height:0;display:flex;flex-direction:column;">${col.map(([d,q])=>linhaChaoFlex(d,q)).join('')}</div>
      </div>`).join('')}
    </div>`;
  }

  const emAguasHtml = solo
    ? emAguasEmColunas(emAguasLista)
    : (emAguasLista.length ? `
    <div style="max-height:${maxH};overflow-y:auto;">
    <table style="width:100%;table-layout:fixed;border-collapse:collapse;font-size:13px;">
      ${theadEmAguas}
      <tbody>${emAguasLista.map(linhaEmAguas).join('')}</tbody>
    </table>
    </div>
  ` : `<div style="font-size:13px;color:var(--muted);">Nenhum processo embarcado no momento.</div>`);

  const noChaoHtml = solo
    ? (noChaoLista.length
        ? `<div style="font-size:.85em;color:var(--muted);margin-bottom:8px;flex:0 0 auto;">${noChaoProcessos} processo(s) · ${fmtN(Math.round(noChaoTotalUn))} unidades no total</div>${noChaoEmColunas(noChaoLista)}`
        : `<div style="font-size:13px;color:var(--muted);">Nenhum processo com estoque parado no armazém.</div>`)
    : (noChaoLista.length ? `
    <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">${noChaoProcessos} processo(s) · ${fmtN(Math.round(noChaoTotalUn))} unidades no total</div>
    <div style="max-height:${maxH};overflow-y:auto;">
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tbody>${noChaoLista.map(([desc,qtd]) => `<tr style="border-top:1px solid var(--border);">
        <td style="padding:6px 8px;">${esc(desc)}</td>
        <td style="padding:6px 8px;text-align:right;font-weight:700;white-space:nowrap;">${fmtN(Math.round(qtd))} un.</td>
      </tr>`).join('')}</tbody>
    </table>
    </div>
  ` : `<div style="font-size:13px;color:var(--muted);">Nenhum processo com estoque parado no armazém.</div>`);


  // ── Tabela por Marca (Total/Backorders/Em Águas/Mês) — extensão de
  // blocoTotalizadorMarcasTV com a 4ª coluna "Mês" (containers registrados
  // no mês, noMesPorMarca), só usada no painel "NO CHÃO" redesenhado.
  function blocoTabelaMarcaChaoTV(porBackorders, porEmAguas, porMes, labelMap){
    const chaves = new Set([...Object.keys(porBackorders), ...Object.keys(porEmAguas), ...Object.keys(porMes)]);
    const linhas = Array.from(chaves).map(chave => {
      const bo = porBackorders[chave] || 0;
      const ea = porEmAguas[chave] || 0;
      const mes = porMes[chave] || 0;
      return { chave, nome: labelMap[chave] || chave, bo, ea, mes, total: bo + ea };
    }).sort((a,b) => b.total - a.total);
    if(!linhas.length) return '<div style="font-size:13px;color:var(--muted);">Sem dados de marca no momento.</div>';
    const totalGeral = linhas.reduce((s,l)=>s+l.total,0);
    const totalBO = linhas.reduce((s,l)=>s+l.bo,0);
    const totalEA = linhas.reduce((s,l)=>s+l.ea,0);
    const totalMes = linhas.reduce((s,l)=>s+l.mes,0);
    return `<div style="background:#fff;border-radius:12px;overflow:hidden;height:100%;display:flex;flex-direction:column;box-shadow:0 2px 8px rgba(15,23,42,.08);">
      <div style="padding:.6em .9em;font-weight:800;font-size:1em;color:#334155;text-transform:uppercase;letter-spacing:.4px;border-bottom:1px solid #e2e8f0;flex:0 0 auto;">Por Marca</div>
      <div style="overflow-y:auto;flex:1;min-height:0;">
      <table style="width:100%;border-collapse:collapse;font-size:1em;">
        <thead><tr style="background:#f1f5f9;text-align:left;color:#475569;text-transform:uppercase;letter-spacing:.3px;font-size:.8em;position:sticky;top:0;">
          <th style="padding:.55em .9em;">Marca</th>
          <th style="padding:.55em .9em;text-align:right;">Total</th>
          <th style="padding:.55em .9em;text-align:right;">Backorders</th>
          <th style="padding:.55em .9em;text-align:right;">Em Águas</th>
          <th style="padding:.55em .9em;text-align:right;">Mês</th>
        </tr></thead>
        <tbody>
        ${linhas.map((l,idx) => `<tr style="border-top:1px solid #e2e8f0;color:#1e293b;${idx%2===1?'background:#f1f5f9;':''}">
          <td style="padding:.45em .9em;font-weight:700;">${esc(l.nome)}</td>
          <td style="padding:.45em .9em;text-align:right;font-weight:800;">${fmtN(l.total)}</td>
          <td style="padding:.45em .9em;text-align:right;color:#475569;">${fmtN(l.bo)}</td>
          <td style="padding:.45em .9em;text-align:right;color:#475569;">${fmtN(l.ea)}</td>
          <td style="padding:.45em .9em;text-align:right;color:#475569;">${fmtN(l.mes)}</td>
        </tr>`).join('')}
        <tr style="border-top:2px solid #cbd5e1;font-weight:800;color:#0f1f3d;background:#f8fafc;">
          <td style="padding:.55em .9em;">TOTAL</td>
          <td style="padding:.55em .9em;text-align:right;">${fmtN(totalGeral)}</td>
          <td style="padding:.55em .9em;text-align:right;">${fmtN(totalBO)}</td>
          <td style="padding:.55em .9em;text-align:right;">${fmtN(totalEA)}</td>
          <td style="padding:.55em .9em;text-align:right;">${fmtN(totalMes)}</td>
        </tr>
        </tbody>
      </table>
      </div>
    </div>`;
  }

  // ── "Processos do Mês" — processos com ETA no mês corrente, em colunas
  // (mesmo padrão de emAguasEmColunas/noChaoEmColunas), colunas ETA/Processo/Qtd.
  function linhaProcessoMesChaoTV(x){
    const etaFmt = x.eta ? new Date(x.eta+'T00:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'}) : '—';
    return `<div class="tv-row" style="display:flex;align-items:center;gap:.5em;border-top:1px solid var(--border);overflow:hidden;padding:.35em 0;white-space:nowrap;">
        <div style="flex:0 0 auto;font-weight:700;white-space:nowrap;">${etaFmt}</div>
        <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;" title="${esc(x.referencia||'')}">${esc(x.referencia||'—')}</div>
        <div style="flex:0 0 auto;text-align:right;font-weight:700;color:#475569;">${x.n}</div>
      </div>`;
  }
  function blocoProcessosDoMesChaoTV(lista){
    if(!lista.length) return `<div style="background:#fff;border-radius:12px;padding:.6em .9em;height:100%;box-shadow:0 2px 8px rgba(15,23,42,.08);"><div style="font-weight:800;font-size:1em;color:#334155;text-transform:uppercase;letter-spacing:.4px;margin-bottom:.5em;">Processos do Mês</div><div style="font-size:.9em;color:var(--muted);">Nenhum processo com ETA neste mês.</div></div>`;
    // 2 colunas fixas (em vez de até 3) — pedido do Ayslan (08/09/2026):
    // "bem visual, pra ver de longe". Com fonte maior, menos colunas cabem
    // de forma legível; o que não couber sem cortar rola dentro do card
    // (overflow-y:auto), já que a tela inteira recarrega a cada 5min.
    const nCols = lista.length > 14 ? 2 : 1;
    const porColuna = Math.ceil(lista.length / nCols);
    const colunas = [];
    for(let i=0;i<nCols;i++) colunas.push(lista.slice(i*porColuna,(i+1)*porColuna));
    return `<div style="background:#fff;border-radius:12px;padding:.6em .9em;height:100%;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 2px 8px rgba(15,23,42,.08);">
      <div style="font-weight:800;font-size:1em;color:#334155;text-transform:uppercase;letter-spacing:.4px;margin-bottom:.4em;flex:0 0 auto;border-bottom:1px solid #e2e8f0;padding-bottom:.4em;">Processos do Mês · ${fmtN(lista.length)} processo(s)</div>
      <div style="display:grid;grid-template-columns:repeat(${nCols},1fr);gap:.9em;flex:1;min-height:0;overflow-y:auto;font-size:1em;">
        ${colunas.map(col => `<div style="display:flex;flex-direction:column;overflow:hidden;">${col.map(linhaProcessoMesChaoTV).join('')}</div>`).join('')}
      </div>
    </div>`;
  }

  // ── Gráfico de barras simples (CSS puro, sem lib externa) ─────────
  function graficoBarrasChaoTV(titulo, itens, corBarra){
    const max = Math.max(1, ...itens.map(i => i.qtd));
    return `<div style="background:#fff;border-radius:12px;padding:.7em 1em;height:100%;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 2px 8px rgba(15,23,42,.08);">
      <div style="font-weight:800;font-size:1em;color:#334155;text-transform:uppercase;letter-spacing:.4px;margin-bottom:.6em;flex:0 0 auto;border-bottom:1px solid #e2e8f0;padding-bottom:.4em;">${esc(titulo)}</div>
      <div style="flex:1;min-height:0;display:flex;align-items:flex-end;gap:${itens.length>15?'3px':'8px'};">
        ${itens.map(i => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;min-width:0;">
          <div style="font-size:.8em;font-weight:700;color:#334155;margin-bottom:3px;">${i.qtd || ''}</div>
          <div style="width:100%;background:${corBarra};border-radius:4px 4px 0 0;height:${Math.max(2, Math.round((i.qtd/max)*100))}%;"></div>
          <div style="font-size:.75em;color:var(--muted);margin-top:5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;">${esc(String(i.label))}</div>
        </div>`).join('')}
      </div>
    </div>`;
  }

  // ── KPI row (Backorders / Em Águas / Previsto Mês / No Mês) ───────
  function kpiCardChaoTV(label, valor, cor){
    return `<div style="background:linear-gradient(160deg,${cor} 0%,#132038 130%);border-radius:12px;padding:.9em 1.2em;display:flex;flex-direction:column;justify-content:center;min-width:0;flex:1;box-shadow:0 2px 8px rgba(15,23,42,.18);">
      <div style="font-size:.85em;font-weight:700;color:rgba(255,255,255,.85);text-transform:uppercase;letter-spacing:.4px;">${esc(label)}</div>
      <div style="font-size:2.5em;font-weight:800;color:#fff;font-family:'DM Sans',sans-serif;line-height:1.1;">${fmtN(valor)}</div>
    </div>`;
  }
  const kpiRowChaoHtml = `<div style="display:flex;gap:.9em;flex:0 0 auto;">
    ${kpiCardChaoTV('Backorders', backordersTotal, '#2a5298')}
    ${kpiCardChaoTV('Em Águas', emAguasTotal, '#1e6091')}
    ${kpiCardChaoTV('Previsto Mês', previstoMesContainers, '#0f766e')}
    ${kpiCardChaoTV('No Mês', noMesContainers, '#184e77')}
  </div>`;

  const tabelaMarcaChaoHtml = blocoTabelaMarcaChaoTV(backordersPorMarca, emAguasPorMarca, noMesPorMarca, backordersLabel);
  const processosDoMesChaoHtml = blocoProcessosDoMesChaoTV(previstoMesProcessos);
  const armazemChaoHtml = `<div style="background:#fff;border-radius:12px;padding:.6em .9em;height:100%;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 2px 8px rgba(15,23,42,.08);">
    <div style="font-weight:800;font-size:1em;color:#334155;text-transform:uppercase;letter-spacing:.4px;margin-bottom:.4em;flex:0 0 auto;border-bottom:1px solid #e2e8f0;padding-bottom:.4em;">Armazém · ${fmtN(noChaoProcessos)} processo(s) · ${fmtN(Math.round(noChaoTotalUn))} unidades</div>
    <div style="flex:1;min-height:0;overflow-y:auto;font-size:1em;">${noChaoLista.length ? noChaoLista.map(([desc,qtd],idx) => `<div style="display:flex;justify-content:space-between;gap:.6em;padding:.4em .2em;border-top:1px solid var(--border);${idx%2===1?'background:#f8fafc;':''}"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(desc)}">${esc(desc)}</span><span style="font-weight:700;white-space:nowrap;color:#0f1f3d;">${fmtN(Math.round(qtd))} un.</span></div>`).join('') : '<div style="font-size:.9em;color:var(--muted);">Nenhum processo com estoque parado.</div>'}</div>
  </div>`;
  const graficoMesChaoHtml = graficoBarrasChaoTV('Container por Mês (Registro DI)', containerPorMes, '#2a5298');
  const graficoDiaChaoHtml = graficoBarrasChaoTV('Container por Dia (ETA, mês corrente)', containerPorDiaEta.length ? containerPorDiaEta.map(i => ({label:i.dia, qtd:i.qtd})) : [{label:'—', qtd:0}], '#0f766e');

  // Layout completo do painel "NO CHÃO" (espelha a planilha antiga "00-
  // DASHBOARDOPERACIONAL V7" — tela "NO CHÃO - No porto ou Armazém"),
  // pedido do Ayslan (08/09/2026). Diferente dos outros 2 painéis, não usa
  // a função genérica painel() — tem cabeçalho próprio (linha de 4 KPIs em
  // vez de 1 número só).
  function painelChaoCompletoTV(){
    const corpo = `
      ${kpiRowChaoHtml}
      <div style="display:grid;grid-template-columns:1.3fr 1.4fr 1fr;gap:.9em;flex:1;min-height:0;margin-top:.9em;">
        <div style="min-height:0;overflow:hidden;">${tabelaMarcaChaoHtml}</div>
        <div style="min-height:0;overflow:hidden;">${processosDoMesChaoHtml}</div>
        <div style="min-height:0;overflow:hidden;">${armazemChaoHtml}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.9em;flex:0 0 auto;height:24vh;margin-top:.9em;">
        <div>${graficoMesChaoHtml}</div>
        <div>${graficoDiaChaoHtml}</div>
      </div>
    `;
    // Fonte base em clamp(vh) — igual ao cabeçalho de painel() — pra escalar
    // com a resolução real da tela (TV grande = texto grande), pedido do
    // Ayslan (08/09/2026): "bem visual, pra ver de longe". Como quase todo
    // o resto do painel usa unidades em em/1em relativas a essa base, um
    // único font-size no wrapper já escala tudo dentro (KPIs, tabelas,
    // gráficos) sem precisar mexer em cada elemento individualmente.
    if(solo){
      return `<div style="height:100vh;display:flex;flex-direction:column;background:#eef2f7;box-sizing:border-box;font-size:clamp(13px,1.5vh,20px);">
        ${botaoVoltarTV()}
        <div style="background:linear-gradient(90deg,#184e77 0%,#1a3a6e 100%);padding:1.1vh 26px;flex:0 0 auto;box-shadow:0 2px 10px rgba(0,0,0,.12);">
          <div style="font-family:'Syne',sans-serif;font-size:clamp(18px,2.5vh,34px);font-weight:800;color:#fff;letter-spacing:.3px;">NO CHÃO</div>
          <div style="font-size:clamp(10px,1.15vh,16px);color:rgba(255,255,255,.8);margin-top:1px;">No porto ou Armazém</div>
        </div>
        <div style="flex:1;min-height:0;padding:1.4vh 22px;display:flex;flex-direction:column;">${corpo}</div>
      </div>`;
    }
    return `<div style="background:#eef2f7;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.08);margin-bottom:22px;">
      <div style="background:linear-gradient(90deg,#184e77 0%,#1a3a6e 100%);padding:16px 24px;">
        <div style="font-family:'Syne',sans-serif;font-size:19px;font-weight:800;color:#fff;letter-spacing:.3px;">NO CHÃO</div>
        <div style="font-size:12px;color:rgba(255,255,255,.75);margin-top:2px;">No porto ou Armazém</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:0;height:640px;padding:18px 24px;box-sizing:border-box;">${corpo}</div>
    </div>`;
  }

  const paineis = {
    backorders: painel('BACKORDERS', `Visão por marca / fábrica — ainda não embarcados · ${fmtN(backordersProcessosTotal)} processos e ${fmtN(backordersTotal)} containers`, fmtN(backordersTotal), '#2a5298', backordersHtml),
    aguas: painel('EM ÁGUAS', 'Em trânsito para o Brasil', fmtN(emAguasTotal), '#1e6091', emAguasHtml),
    chao: painelChaoCompletoTV(),
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
  // Só depois do HTML estar no DOM dá pra medir a altura REAL de uma linha
  // (que já saiu correta, porque cada .tv-row tem flex:1 dividindo o espaço
  // disponível igualmente) — e então escolher a fonte que cabe certinho,
  // sem cortar nenhuma linha e sem sobrar espaço vazio. requestAnimationFrame
  // garante que o layout já foi calculado pelo navegador antes de medir.
  if(solo) requestAnimationFrame(() => ajustarFonteColunasTV(el));
}

// Mede a altura de uma linha já renderizada (.tv-row, dentro de .tv-col) e
// define o font-size do painel inteiro proporcional a essa altura — pedido
// do Ayslan (08/09/2026): a tela precisa caber a MESMA quantidade de
// processos que a planilha Excel antiga (~25/coluna) e ainda ficar legível
// de longe, o que só é possível se o tamanho da fonte se adaptar à
// resolução real de cada TV em vez de um zoom fixo. Usa a MENOR altura de
// linha entre todas as colunas (a mais "apertada") como referência, pra
// garantir que o texto cabe em TODAS as colunas, não só na primeira.
// Fator de correção por resolução física da TV (pedido Emanuelly
// 09/09/2026, ver comentário detalhado dentro de ajustarFonteColunasTV
// logo abaixo). window.screen.width é a resolução nativa da tela (não
// muda com zoom do navegador, ao contrário de window.innerWidth) — é o
// jeito certo de detectar em qual das 2 TVs físicas o painel está
// rodando. Corte em 2560 fica bem no meio de 1920 (Full HD) e 3840 (4K),
// então funciona pras 2 resoluções reais em uso sem precisar de mais
// faixas por enquanto.
function fatorEscalaResolucaoTV(){
  const larguraLogica = (typeof window !== 'undefined' && window.screen && window.screen.width) || (typeof window !== 'undefined' && window.innerWidth) || 1920;
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const larguraFisica = larguraLogica * dpr;
  return larguraFisica >= 2560 ? 0.67 : 1.75;
}

function ajustarFonteColunasTV(raiz){
  let menorAltura = Infinity;
  raiz.querySelectorAll('.tv-col').forEach(col => {
    const linha = col.querySelector('.tv-row');
    if(!linha) return;
    const h = linha.getBoundingClientRect().height;
    if(h > 0 && h < menorAltura) menorAltura = h;
  });
  // Fallback pro Backorders quando há poucas marcas (só os 4 cards
  // principais, sem lista "resto" pra medir) — pedido do Ayslan
  // (09/09/2026): "pega a fonte que colocou no Em Águas e coloca no
  // Backorders" (a fonte da tela de Backorders ficava visivelmente menor
  // que a de Em Águas). Causa raiz: o card de marca (.tv-card) ficava
  // dentro de um grid de altura de CONTEÚDO (auto) — mesmo com o wrapper
  // esticando pra ocupar a tela toda (flex:1), o card em si continuava do
  // tamanho do próprio conteúdo, sobrando espaço vazio embaixo em vez do
  // card crescer. Corrigido lá embaixo (grid-auto-rows:1fr no wrapper dos
  // cards principais) pra o card esticar e preencher a altura toda, igual
  // uma linha de Em Águas já fazia — então aqui só precisa medir o card
  // direto (sem dividir por 3): ele já vem do tamanho certo.
  if(!isFinite(menorAltura)){
    const card = raiz.querySelector('.tv-card');
    if(card){
      const h = card.getBoundingClientRect().height;
      if(h > 0) menorAltura = h / 2.4;
    }
  }
  if(!isFinite(menorAltura)) return;
  // ~42% da altura da linha costuma preencher bem sem estourar (sobra
  // espaço pro padding/borda) — testado visualmente com 1, 3 e 5 colunas.
  //
  // Correção de resolução (Emanuelly 09/09/2026): as 3 TVs físicas NÃO
  // têm a mesma resolução — Em Águas e No Chão rodam num painel 4K
  // (3840x2160), Backorders roda num painel Full HD (1920x1080). Como
  // esse cálculo usa a altura MEDIDA em pixels CSS (getBoundingClientRect),
  // e as TVs aparentemente rodam sem escala de SO (devicePixelRatio~1), o
  // viewport 4K mede o DOBRO de pixels CSS do que o Full HD pro MESMO
  // layout relativo — por isso hoje precisam compensar na mão com zoom do
  // navegador (Em Águas em 67%, Backorders em 175%) pra ficar no tamanho
  // certo. Em vez de depender de zoom manual (frágil — cada TV tem que
  // ser configurada à parte e se perde num reboot/troca de player), aplica
  // esse mesmo fator direto aqui, detectando a resolução real da tela.
  const fatorResolucao = fatorEscalaResolucaoTV();
  const fonte = Math.max(13, Math.min(70, Math.round(menorAltura * 0.5 * fatorResolucao)));
  // raiz é o próprio #dash-tv-content (é nele que o classList.toggle
  // 'dash-tv-solo' foi aplicado) — o font-size herda pra tudo dentro.
  raiz.style.fontSize = fonte + 'px';

  // Badge de diagnóstico TEMPORÁRIO (Ayslan/Emanuelly 09/09/2026) — a
  // correção por resolução (fatorEscalaResolucaoTV) não bateu com o
  // esperado na TV física real (foto mostrou fonte minúscula em vez de
  // legível, mesmo a 100% de zoom). Em vez de continuar ajustando o fator
  // no escuro, mostra os números reais medidos no canto da tela pra poder
  // fotografar e mandar de volta. Fonte fixa em px (não herda o fontSize
  // calculado acima) pra sempre ficar legível não importa o resultado do
  // cálculo. Remover depois que o ajuste de resolução estiver calibrado.
  let badge = document.getElementById('tv-debug-resolucao');
  if(!badge){
    badge = document.createElement('div');
    badge.id = 'tv-debug-resolucao';
    badge.style.cssText = 'position:fixed;bottom:6px;right:6px;font-size:11px !important;line-height:1.4;color:#e2e8f0;background:rgba(15,23,42,.85);padding:5px 9px;border-radius:6px;z-index:99999;font-family:monospace;pointer-events:none;';
    document.body.appendChild(badge);
  }
  badge.innerHTML = `screen ${window.screen.width}x${window.screen.height} dpr${window.devicePixelRatio}<br>fisica~${Math.round(window.screen.width*(window.devicePixelRatio||1))}px &rarr; fator ${fatorResolucao}<br>linha ${Math.round(menorAltura)}px &rarr; fonte ${fonte}px`;
}

// ── Modal "quais processos estão nesse número" (Backorders) ──────────
// Pedido da Emanuelly (21/08/2026): "em como no dashboard de backorders na
// parte que diz quantidade de cada marca eu clicar dentro e aparecer todos
// que ele está considerando?" — mesmo padrão de modal clicável já usado no
// Dashboard Narcélio (abrirListaNarcelio, controle-dash-narcelio.js), só
// que lendo de window._tvListasBackorders (montado em renderDashTV acima).
function abrirListaTV(chave){
  const dados = (window._tvListasBackorders || {})[chave];
  if(!dados) return;
  let modal = document.getElementById('tv-lista-modal');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'tv-lista-modal';
    modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:9999;align-items:center;justify-content:center;';
    modal.innerHTML = '<div style="background:#fff;border-radius:12px;max-width:720px;width:92%;max-height:82vh;overflow:auto;padding:20px 22px;box-shadow:0 12px 40px rgba(0,0,0,.25);">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
      '<h3 id="tv-lista-titulo" style="margin:0;font-size:16px;"></h3>' +
      '<button onclick="fecharListaTV()" style="border:none;background:none;font-size:20px;cursor:pointer;color:var(--muted);">&times;</button>' +
      '</div><div id="tv-lista-corpo"></div></div>';
    modal.addEventListener('click', function(e){ if(e.target === modal) fecharListaTV(); });
    document.body.appendChild(modal);
  }
  document.getElementById('tv-lista-titulo').textContent = dados.titulo + ' — ' + dados.rows.length + ' processo(s)';
  const corpo = document.getElementById('tv-lista-corpo');
  if(!dados.rows.length){
    corpo.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:20px 0;text-align:center;">Nenhum processo encontrado.</div>';
  } else {
    corpo.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="text-align:left;color:var(--muted);border-bottom:1px solid var(--border);">
        <th style="padding:6px 8px;">Referência</th>
        <th style="padding:6px 8px;">Cliente</th>
        <th style="padding:6px 8px;">ETA/Previsão</th>
        <th style="padding:6px 8px;text-align:right;">Containers</th>
      </tr></thead>
      <tbody>
      ${dados.rows.map(r => `<tr style="border-bottom:1px solid var(--border);cursor:pointer;" onclick="fecharListaTV();abrirProcesso('${r.id}')" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
        <td style="padding:6px 8px;font-weight:600;">${esc(r.referencia||'—')}</td>
        <td style="padding:6px 8px;">${esc(r.cliente||'—')}</td>
        <td style="padding:6px 8px;">${r.eta ? new Date(r.eta+'T00:00:00').toLocaleDateString('pt-BR') : '—'}</td>
        <td style="padding:6px 8px;text-align:right;">${r.n}</td>
      </tr>`).join('')}
      </tbody>
    </table>`;
  }
  modal.style.display = 'flex';
}
function fecharListaTV(){
  const modal = document.getElementById('tv-lista-modal');
  if(modal) modal.style.display = 'none';
}
