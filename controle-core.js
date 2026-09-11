// controle-core.js
// 
// Estado global, boot (login/DOMContentLoaded), câmbio, CRUD de processos (API), cálculo de fase/demurrage/fechamento, notificações, filtros/stats e a renderização da lista principal.
//
// Parte do controle_v2.html, extraído do <script> único original pra
// facilitar manutenção. Carregado via <script src> junto com os outros
// módulos (ver controle_v2.html) — não é um ES module, então todo
// estado (let/const de topo) e funções aqui continuam visíveis pros
// outros arquivos, exatamente como estavam quando tudo era um só
// <script>. controle-core.js precisa carregar ANTES dos demais (é
// quem declara o estado global: _processos, _user, FASES etc.).
//
// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ SESSÃÂÃÂO EXPIRADA: mensagem clara em vez de erro de parse ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// Quando a sessão cai (ex.: reinício do servidor), as rotas protegidas
// redirecionam pra /login (HTML) em vez de responder JSON. O código que
// chama fetch(...).then(r=>r.json()) então quebra com um erro confuso tipo
// "Unexpected token '<' ... is not valid JSON". Este wrapper detecta esse
// redirecionamento e troca por uma mensagem que o usuário entende, usando os
// mesmos catch() que já existem em cada tela.
(function(){
  const _fetch = window.fetch.bind(window);
  window.fetch = async function(...args){
    const res = await _fetch(...args);
    if (res.redirected && res.url.startsWith(location.origin) && res.url.includes('/login')) {
      throw new Error('Sessão expirada. Abra outra aba, faça login novamente e tente de novo (seus dados não foram perdidos).');
    }
    return res;
  };
})();

// ════════════════════════════════════════════════════════════════
// UUID — compatível com Safari, Chrome, Firefox
// ════════════════════════════════════════════════════════════════
function gerarUUID(){
  // Usar crypto.randomUUID se disponível (Chrome, Firefox, Edge)
  if(typeof crypto !== 'undefined' && crypto.randomUUID){
    return crypto.randomUUID();
  }
  // Fallback para Safari e browsers mais antigos
  if(typeof crypto !== 'undefined' && crypto.getRandomValues){
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
  }
  // Último fallback: Math.random
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random()*16|0;
    return (c==='x' ? r : (r&0x3|0x8)).toString(16);
  });
}

// Analisa uma data "sem hora" (ex.: "2026-07-18", vinda de <input type=date>
// ou do banco) SEMPRE no fuso LOCAL do navegador, nunca em UTC.
// `new Date('2026-07-18')` (sem hora) é interpretado pelo JS como meia-noite
// UTC — em fusos negativos (ex.: Brasil, UTC-3) isso exibe/compara como o
// dia ANTERIOR (17/07) em vez do dia certo. `new Date('2026-07-18T00:00:00')`
// (sem "Z") é interpretado em horário LOCAL, então bate com o que a pessoa
// realmente digitou. Antes deste helper, os dois estilos apareciam
// misturados neste arquivo (e em controle-dashboards.js/controle-export.js)
// pro MESMO tipo de campo — ex.: renderDemurInfo() lia data_chegada sem
// sufixo (UTC) enquanto calcularFase() lia o mesmo campo com sufixo (local),
// podendo mostrar dias diferentes pro mesmo processo em telas diferentes.
// Use esta função pra qualquer campo de data-só (data_chegada, eta,
// demurrage_vencimento, pi_data_saldo, nf_entrada_data, nf_saida_data etc.).
// Para timestamps completos (created_at/updated_at, que já vêm com hora e
// "Z" de toISOString()), continue usando new Date(...) direto — não passar
// por aqui.
function parseDataLocal(str){
  return str ? new Date(str + 'T00:00:00') : null;
}

// ════════════════════════════════════════════════════════════════
// ESTADO
// ════════════════════════════════════════════════════════════════
let _user = null;
let _processos = [];
let _faseFilter = '';
let _searchText = '';
let _pagina = 1;
const POR_PAGINA = 50;
let _editando = null; // processo sendo editado
// Snapshot do processo exatamente como veio do servidor quando o modal foi
// aberto (ou {} pra um processo novo) — usado só pra saber quais campos o
// usuário de fato alterou nesta sessão de edição (ver coletarESalvar). Nunca
// é mutado depois de setado; existe só pra comparação, não é enviado ao
// servidor. Concorrência: com vários usuários editando processos ao mesmo
// tempo, salvar o processo inteiro sempre que alguém clica em Salvar
// sobrescrevia silenciosamente qualquer campo que outra pessoa tivesse
// alterado nesse meio tempo (quem salvasse por último "vencia" em TUDO, não
// só no que de fato editou). Agora só os campos realmente alterados nesta
// sessão são enviados — os demais ficam intocados no banco.
let _editandoOriginal = null;
// Rastreia se o usuário alterou algo no painel do processo desde que ele
// abriu (input/change delegado, ver listener em INIT) — usado pelo ESC (ver
// mesmo bloco) pra perguntar se quer salvar antes de fechar, em vez de
// simplesmente descartar a edição em andamento sem avisar.
let _painelDirty = false;
let _notifAberto = false;
let _cambio = { USD: 1, BRL: 1, EUR: 1 };

// ── URL por processo (task #59) ──────────────────────────────────
// _baseUrlPath é a tela "de baixo" (/controle ou /financeiro) — pra onde
// a URL volta quando o painel lateral do processo fecha. Se a página já
// carregou num deep link (ex: /controle/UD26-005), guardamos a referência
// pedida em _refPendenteDeepLink pra abrir o painel assim que a lista de
// processos terminar de carregar (ver carregarProcessos).
const _pathPartsInicial = location.pathname.split('/').filter(Boolean);
let _baseUrlPath = '/' + (_pathPartsInicial[0] || 'controle');
let _refPendenteDeepLink = _pathPartsInicial[1] ? decodeURIComponent(_pathPartsInicial[1]) : null;

const FASES = [
  { id:'PI',                label:'PI Recebida',       icon:'📄' },
  { id:'AGUARDANDO_EMBARQUE',label:'Ag. Embarque',      icon:'⏳' },
  { id:'EMBARCADO',          label:'Embarcado',          icon:'🚢' },
  { id:'DESEMBARCADO',       label:'Desembarcado',       icon:'⚓' },
  { id:'REGISTRO_DI',        label:'Registro DI',        icon:'📋' },
  { id:'PARAMETRIZACAO',     label:'Parametrização',     icon:'🔍' },
  { id:'CARREGAMENTO',       label:'Carregamento',       icon:'🚛' },
  { id:'FATURAMENTO',        label:'Faturamento',        icon:'💰' },
  { id:'DEVOLUCAO_VAZIO',    label:'Dev. Vazio',         icon:'📦' },
  { id:'FINALIZADO',         label:'Finalizado',         icon:'✅' },
];

const FASE_LABEL = Object.fromEntries(FASES.map(f=>[f.id, f.label]));
const FASE_ICON  = Object.fromEntries(FASES.map(f=>[f.id, f.icon]));

// "Fechado" (trava manual, ver fecharProcesso) é um status VISUAL separado
// da fase real do pipeline (p.fase segue igual, avançando por
// calcularFase() normalmente até FINALIZADO) — isso mantém intactos todos
// os filtros/dashboards que já comparam p.fase==='FINALIZADO' (Executivo,
// Financeiro, Resultado etc.), sem precisar caçar cada um deles. É só a
// badge exibida (tabela + cabeçalho do painel) que troca pra "🔒 Fechado"
// quando p.fechado é true, no lugar da fase real por baixo. Ver também
// FILTROS_FASE_ESPECIAIS.__fechado (pill "Fechado" na barra de filtro).
function faseParaExibir(p){
  if(p && p.fechado) return {id:'FECHADO', label:'Fechado', icon:'🔒'};
  return FASES.find(f=>f.id===(p&&p.fase))||FASES[0];
}

// ════════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', function(){
  fetch('/api/me').then(r=>r.json()).then(d=>{
    if(!d.logado){ location.href='/login?destino='+encodeURIComponent(location.pathname); return; }
    _user = d;
    document.getElementById('user-badge').textContent = d.displayName || d.usuario;
    // Link do Dashboard Narcélio só aparece pro próprio usuário narcelio —
    // cosmético (a proteção real é o back-end em GET /narcelio, ver
    // server.js), mas evita mostrar um link "quebrado" (403) pra quem não
    // tem acesso.
    document.getElementById('menu-narcelio')?.style.setProperty('display', ['narcelio','suporte'].includes(d.usuario) ? '' : 'none');
// Botão "Gerar Follow-up Semanal" (task #327): só visível pra usuários
// gerente — mesma role já usada pelo back-end em POST /api/admin/
// followup-semanal (ver server.js), cosmético aqui (a proteção real é
// o back-end checar req.session.role==='gerente').
document.getElementById('btn-followup-semanal')?.style.setProperty('display', d.role==='gerente' ? '' : 'none');
    carregarCambio();
    carregarProcessos().then(()=>{
      if(location.pathname==='/financeiro') ativarTelaFinanceiroExclusiva();
      if(location.pathname==='/resultado') ativarTelaResultadoExclusiva();
      if(location.pathname==='/analises') ativarTelaAnalisesExclusiva();
      if(location.pathname==='/narcelio') ativarTelaNarcelioExclusiva();
      if(location.pathname==='/tv') ativarTelaTVExclusiva();
      if(location.pathname==='/cambio') ativarTelaCambioExclusiva();
      // Deep-link ?processo=<id> — usado pelo Calculador pra abrir direto o
      // processo recém-criado ao aprovar uma cotação (ver aprovarCotacao()
      // em calculador.html). Só tenta abrir depois que a lista carregou,
      // senão abrirProcesso() não acha o processo em _processos ainda.
      const idDeepLink = new URLSearchParams(location.search).get('processo');
      if(idDeepLink){
        const achou = _processos.some(p=>p.id===idDeepLink);
        if(achou) abrirProcesso(idDeepLink);
        else showToast('Processo recém-criado ainda não apareceu na lista — atualize a página em alguns segundos', 'err');
      }
    });
    renderFaseFilter();
    // Auto-refresh a cada 30s
    setInterval(function(){ if(!document.getElementById('modal-bg').classList.contains('open')) carregarProcessos(true); }, 30000);
  });
});

// ── Marca o painel como "sujo" (alterações não salvas) sempre que o usuário
// digita/muda algo dentro dele — delegado no document porque o conteúdo das
// abas é recriado a cada trocarAba()/render de sub-seção, então um listener
// direto nos campos se perderia. Resetado em renderModal() (todo lugar que
// chama renderModal() já reatribui _editando/_editandoOriginal do zero, ver
// comentário ali), então só sobe para true depois que o painel já está
// "estável" com os dados do processo carregado.
['input','change'].forEach(function(evt){
  document.addEventListener(evt, function(e){
    if(!document.getElementById('modal-bg')?.classList.contains('open')) return;
    if(!e.target.closest('#modal-bg')) return;
    _painelDirty = true;
  }, true);
});

// ESC fecha o painel do processo (pedido do Ayslan, 08/09/2026) — se houver
// alteração não salva, pergunta antes de descartar. Prioriza fechar o modal
// do DRE primeiro se ele estiver aberto por cima do painel (ver abrirDRE/
// fecharDRE em controle-modal.js), senão o ESC "vazaria" e fecharia o
// painel inteiro por baixo do DRE sem o usuário perceber.
document.addEventListener('keydown', function(e){
  if(e.key !== 'Escape') return;
  const dreOverlay = document.getElementById('dre-overlay');
  if(dreOverlay && dreOverlay.innerHTML.trim()){ fecharDRE(); return; }
  const modalBg = document.getElementById('modal-bg');
  if(!modalBg || !modalBg.classList.contains('open')) return;
  if(_painelDirty){
    if(confirm('Você tem alterações não salvas neste processo. Deseja salvar antes de fechar?')){
      coletarESalvar();
    } else {
      fecharModal();
    }
  } else {
    fecharModal();
  }
});

// ════════════════════════════════════════════════════════════════
// TELA EXCLUSIVA /financeiro — mesma página (controle_v2.html) e mesmo
// JS do Controle normal, só que ao carregar em /financeiro a tela já abre
// direto no Dashboard Financeiro, com o que é sobre "lista de processos"
// (busca, filtros de fase, cards de status) escondido — foco só no
// financeiro. A TABELA de processos continua existindo mais abaixo (não é
// removida do DOM), porque os cards e a lista de pagamentos do Dashboard
// Financeiro contam com ela pra "abrir o processo" ao clicar numa linha e
// pro drill-down dos filtros (Saldo a Pagar, Exposição, Capital Parado)
// funcionar exatamente como já funciona dentro do Controle — reaproveitar
// em vez de duplicar essa lógica evita ter duas versões de "abrir
// processo" pra manter sincronizadas.
function ativarTelaFinanceiroExclusiva(){
  document.title = 'IMPAK — Dashboard Financeiro';
  const titulo = document.querySelector('.topbar-title');
  if(titulo) titulo.textContent = 'Dashboard Financeiro';

  ['stats-grid','filtro-financeiro-ativo','filtro-data-bar','fase-filter'].forEach(id=>{
    const el = document.getElementById(id); if(el) el.style.display='none';
  });
  const toolbar = document.querySelector('.toolbar');
  if(toolbar) toolbar.style.display = 'none';

  // Sidebar: esconde "Visão" e "Por fase" (não fazem sentido sem a busca/
  // lista principal em destaque) — mantém Dashboard Executivo e Cadastros.
  document.querySelectorAll('.sidebar-section[data-secao="processos"]').forEach(el=>{
    el.style.display = 'none';
  });
  document.querySelectorAll('.sidebar-item').forEach(el=>el.classList.remove('active'));
  document.getElementById('menu-financeiro')?.classList.add('active');

  const dashFin = document.getElementById('dash-financeiro');
  if(dashFin) dashFin.style.display = 'block';
  renderDashFinanceiro();
}

// ════════════════════════════════════════════════════════════════
// TELA EXCLUSIVA /resultado — mesmo esquema do /financeiro acima: o
// Dashboard Resultado responde "quanto lucramos de verdade" cruzando o
// estimado na cotação (estimativa_json, gravado ao aprovar no Calculador)
// com o resultado real de cada processo (calcularFechamento — NF Saída −
// Custo Real Total). Reaproveita _processos e calcularFechamento() em vez
// de duplicar essa lógica.
function ativarTelaResultadoExclusiva(){
  document.title = 'IMPAK — Dashboard Resultado';
  const titulo = document.querySelector('.topbar-title');
  if(titulo) titulo.textContent = 'Dashboard Resultado';

  ['stats-grid','filtro-financeiro-ativo','filtro-data-bar','fase-filter'].forEach(id=>{
    const el = document.getElementById(id); if(el) el.style.display='none';
  });
  const toolbar = document.querySelector('.toolbar');
  if(toolbar) toolbar.style.display = 'none';
  const tableWrapRes = document.querySelector('.table-wrap');
  if(tableWrapRes) tableWrapRes.style.display = 'none';

  document.querySelectorAll('.sidebar-section[data-secao="processos"]').forEach(el=>{
    el.style.display = 'none';
  });
  document.querySelectorAll('.sidebar-item').forEach(el=>el.classList.remove('active'));
  document.getElementById('menu-resultado')?.classList.add('active');

  const dashRes = document.getElementById('dash-resultado');
  if(dashRes) dashRes.style.display = 'block';
  renderDashResultado();
}

// ════════════════════════════════════════════════════════════════
// TELA EXCLUSIVA /analises — Fase 3 (mesmo esquema do /resultado acima):
// reaproveita _processos e calcularFechamento(), só que numa janela de
// vários meses (série temporal + rankings + cruzamento Cliente x
// Fornecedor) em vez de um período único — ver renderDashAnalises() em
// controle-dashboards.js.
function ativarTelaAnalisesExclusiva(){
  document.title = 'IMPAK — Análises';
  const titulo = document.querySelector('.topbar-title');
  if(titulo) titulo.textContent = 'Análises';

  ['stats-grid','filtro-financeiro-ativo','filtro-data-bar','fase-filter'].forEach(id=>{
    const el = document.getElementById(id); if(el) el.style.display='none';
  });
  const toolbar = document.querySelector('.toolbar');
  if(toolbar) toolbar.style.display = 'none';
  const tableWrapAn = document.querySelector('.table-wrap');
  if(tableWrapAn) tableWrapAn.style.display = 'none';

  document.querySelectorAll('.sidebar-section[data-secao="processos"]').forEach(el=>{
    el.style.display = 'none';
  });
  document.querySelectorAll('.sidebar-item').forEach(el=>el.classList.remove('active'));
  document.getElementById('menu-analises')?.classList.add('active');

  const dashAn = document.getElementById('dash-analises');
  if(dashAn) dashAn.style.display = 'block';
  renderDashAnalises();
}

// ════════════════════════════════════════════════════════════════
// TELA EXCLUSIVA /cambio — controle de pagamentos de câmbio por processo
// (entrada/saldo/parcelado), com foco em "o que vence essa semana/mês"
// (pedido do Ayslan, 09/09/2026). Mesma fonte de dados do Dashboard
// Financeiro (listarPagamentosPI), só que reorganizada em calendário
// semanal/mensal em vez de tabela única — ver renderDashCambio() em
// controle-dash-cambio.js.
function ativarTelaCambioExclusiva(){
  document.title = 'IMPAK — Dashboard Câmbio';
  const titulo = document.querySelector('.topbar-title');
  if(titulo) titulo.textContent = 'Dashboard Câmbio';

  ['stats-grid','filtro-financeiro-ativo','filtro-data-bar','fase-filter'].forEach(id=>{
    const el = document.getElementById(id); if(el) el.style.display='none';
  });
  const toolbar = document.querySelector('.toolbar');
  if(toolbar) toolbar.style.display = 'none';

  // Esconde a barra lateral INTEIRA (não só a seção "processos" como nas
  // outras telas exclusivas) — pedido do Ayslan (09/09/2026): a tabela de
  // câmbio tem 8 colunas de dados financeiros e precisa de toda a largura
  // possível. Os links de Dashboard/Cadastros que ficavam na barra lateral
  // continuam a 1 clique via "🚢 Controle" na nav do topo (chat.js), então
  // não perde acesso, só deixa de ficar sempre visível aqui.
  const sidebar = document.querySelector('.sidebar');
  if(sidebar) sidebar.style.display = 'none';

  const dashCam = document.getElementById('dash-cambio');
  if(dashCam) dashCam.style.display = 'block';
  renderDashCambio();
}

// ════════════════════════════════════════════════════════════════
// TRAVA DE PROCESSO ("Fechar Processo") — ver server.js (POST /api/
// controle/v2/processo) pra a validação que de fato importa (o front-end
// aqui só evita o usuário clicar sem querer; quem garante que ninguém
// edita um processo fechado é o servidor).
// ════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════
// TELA EXCLUSIVA /narcelio — visão do dono da empresa: containers por fase
// (PI recebida/previsão de embarque/embarcado/chegando), faturamento por
// período, estoque parado no armazém (NF entrada lançada + NF saída com
// CFOP 5905 ou ainda não emitida) e previsão de recurso de numerário
// (fluxo de caixa combinando pagamentos de PI com custos reais do
// processo). Acesso já é restrito no back-end (ver /narcelio em
// server.js) — aqui é só a apresentação.
function ativarTelaNarcelioExclusiva(){
  document.title = 'IMPAK — Dashboard Narcélio';
  const titulo = document.querySelector('.topbar-title');
  if(titulo) titulo.textContent = 'Dashboard Narcélio';

  ['stats-grid','filtro-financeiro-ativo','filtro-data-bar','fase-filter'].forEach(id=>{
    const el = document.getElementById(id); if(el) el.style.display='none';
  });
  const toolbar = document.querySelector('.toolbar');
  if(toolbar) toolbar.style.display = 'none';

  document.querySelectorAll('.sidebar-section[data-secao="processos"]').forEach(el=>{
    el.style.display = 'none';
  });
  document.querySelectorAll('.sidebar-item').forEach(el=>el.classList.remove('active'));
  document.getElementById('menu-narcelio')?.classList.add('active');

  const dashNarc = document.getElementById('dash-narcelio');
  if(dashNarc) dashNarc.style.display = 'block';
  const tw = document.querySelector('.table-wrap'); if(tw) tw.style.display = 'none';
  renderDashNarcelio();
}

// ────────────────────────────────────────────────────────────────
// TELA EXCLUSIVA /tv — pensada pra ficar aberta o dia inteiro num monitor
// da empresa (substitui a planilha Excel manual). Mesmo esquema das outras
// telas exclusivas acima, mas sem seletor de período (mostra sempre o
// estado ATUAL) e com auto-atualização: busca os processos de novo a cada
// alguns minutos e re-renderiza sozinha, sem precisar de F5 nem de alguém
// digitando números — ver setIntervalAtualizacaoTV() logo abaixo.
function ativarTelaTVExclusiva(){
  document.title = 'IMPAK — Dashboard TV';
  const titulo = document.querySelector('.topbar-title');
  if(titulo) titulo.textContent = 'Dashboard TV';

  // Pedido do Ayslan (08/09/2026): a planilha Excel antiga que essa tela
  // substitui cabia ~25 processos por coluna, legíveis de longe, porque
  // usava a tela inteira sem sobrar espaço com nada além da tabela. A
  // primeira tentativa aqui foi um zoom fixo de 175% (document.documentElement.
  // style.zoom) — mas um fator FIXO não se adapta nem à quantidade de
  // processos do dia (que muda) nem à resolução real de cada TV: às vezes
  // sobrava tela vazia, às vezes cortava linha no meio sem dar pra rolar
  // (TV não tem quem role). Trocado por uma abordagem que calcula sozinha:
  // as colunas de "Em Águas"/"No Chão" (controle-dash-tv.js) ocupam 100%
  // da altura disponível via flexbox, e o JS mede a altura real de cada
  // linha depois de renderizada pra escolher o tamanho de fonte que
  // preenche a tela inteira sem cortar nada — ver ajustarFonteColunasTV()
  // em controle-dash-tv.js. Por isso essa tela também esconde TUDO que não
  // é o painel em si (barra de câmbio, rótulo "Dashboard TV", paddings) —
  // cada pixel de sobra é 1 processo a menos visível na TV.
  ['stats-grid','filtro-financeiro-ativo','filtro-data-bar','fase-filter'].forEach(id=>{
    const el = document.getElementById(id); if(el) el.style.display='none';
  });
  const toolbar = document.querySelector('.toolbar');
  if(toolbar) toolbar.style.display = 'none';
  const utilBarTV = document.querySelector('.util-bar');
  if(utilBarTV) utilBarTV.style.display = 'none';
  const labelTV = document.getElementById('dash-tv-label');
  if(labelTV) labelTV.style.display = 'none';
  const contentTV = document.querySelector('.content');
  if(contentTV){ contentTV.style.padding = '0'; contentTV.style.overflow = 'hidden'; }

  // Essa tela é pra ficar espelhada numa TV física — não faz sentido gastar
  // ~224px de largura com a barra lateral de navegação do Controle (que
  // ninguém vai clicar numa TV). Esconde a sidebar inteira (não só as
  // seções de "processos" como antes) pra o conteúdo usar a tela toda.
  const sidebarTV = document.querySelector('.sidebar');
  if(sidebarTV) sidebarTV.style.display = 'none';
  // Pelo mesmo motivo, esconde também o nav global (logo/links/Sair, vindo
  // do chat.js) — ele é injetado depois deste script rodar, então some com
  // um pequeno atraso; sem isso a TV ficaria com uma barra de links inútil
  // no topo por cima do conteúdo em tela cheia.
  // Mesma lógica pro botão flutuante do assistente de IA (bolha de chat,
  // injetada por chat.js junto com o nav) — pedido do Ayslan (08/09/2026):
  // numa TV espelhada na parede ninguém vai clicar nele, só fica cobrindo
  // dado no canto da tela.
  const esconderNavGlobal = () => {
    const nav = document.getElementById('impak-nav'); if(nav) nav.style.display = 'none';
    const chat = document.getElementById('impak-chat-root'); if(chat) chat.style.display = 'none';
  };
  esconderNavGlobal();
  // Um unico setTimeout(500) as vezes perdia a corrida com chat.js em
  // loads frios (ele so injeta o nav/bolha depois do DOMContentLoaded
  // quando o <script> esta no <head> - ver comentario no topo do
  // chat.js). Insiste por alguns segundos em vez de confiar num unico
  // atraso fixo.
  [100,300,500,1000,2000,3000].forEach(ms => setTimeout(esconderNavGlobal, ms));

  document.querySelectorAll('.sidebar-item').forEach(el=>el.classList.remove('active'));

  const dashTV = document.getElementById('dash-tv');
  if(dashTV){ dashTV.style.display = 'block'; dashTV.style.margin = '0'; }
  const tw2 = document.querySelector('.table-wrap'); if(tw2) tw2.style.display = 'none';
  const pagTV = document.getElementById('paginacao'); if(pagTV) pagTV.style.display = 'none';
  renderDashTV();
  setIntervalAtualizacaoTV();
}

// Recarrega os processos (silenciosamente, sem toast) a cada 5 minutos e
// re-renderiza o Dashboard TV — é isso que faz a tela na parede ficar
// sempre atual sem precisar de ninguém digitando números na planilha nem
// dando F5 manualmente.
function setIntervalAtualizacaoTV(){
  setInterval(async () => {
    await carregarProcessos(true);
    renderDashTV();
  }, 5 * 60 * 1000);

  // Essa tela fica aberta 24h num monitor físico, sem ninguém pra apertar
  // F5 — então quando o código muda (deploy de melhoria visual, correção
  // de bug, etc.), a TV continua rodando a versão antiga em memória
  // indefinidamente, só os DADOS são atualizados a cada 5 min acima, nunca
  // o HTML/JS da página em si (achado 10/09/2026: Emanuelly reportou a TV
  // mostrando um layout antigo mesmo depois do redesign já estar no ar).
  // Recarrega a página inteira 1x por hora — intervalo curto o bastante
  // pra qualquer deploy chegar na TV em no máximo ~1h sem intervenção
  // manual, longo o bastante pra não incomodar quem eventualmente estiver
  // olhando a tela no momento do reload (pisca menos de 1seg).
  setInterval(() => { location.reload(); }, 60 * 60 * 1000);
}

async function fecharProcesso(id){
  if(!confirm('Fechar este processo? NF, Custos Reais e o resultado (lucro) ficam travados — só um gerente pode reabrir depois.')) return;
  const r = await fetch('/api/controle/v2/processo', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ processo:{ id, fechado:true } })
  });
  const d = await r.json();
  if(d.ok){
    showToast('🔒 Processo fechado','ok');
    await carregarProcessos(true);
    const p = _processos.find(p=>p.id===id);
    if(p){ _editando = {...p, _camposIA:{}}; _editandoOriginal = {...p}; renderModal(); }
  } else showToast('Erro ao fechar: '+(d.erro||''),'err');
}

async function reabrirProcesso(id){
  if(!confirm('Reabrir este processo para edição?')) return;
  const r = await fetch('/api/controle/v2/processo', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ processo:{ id, fechado:false } })
  });
  const d = await r.json();
  if(d.ok){
    showToast('🔓 Processo reaberto','ok');
    await carregarProcessos(true);
    const p = _processos.find(p=>p.id===id);
    if(p){ _editando = {...p, _camposIA:{}}; _editandoOriginal = {...p}; renderModal(); }
  } else showToast('Erro ao reabrir: '+(d.erro||''),'err');
}

// Cancelamento de processo — pedido da Emanuelly (21/08/2026): alguns
// processos precisam sair da operação ativa sem serem excluídos, pra
// manter o histórico. Cancelar/reverter direto é restrito a gerente — a
// checagem de verdade é no servidor, ver POST /api/controle/v2/processo
// em server.js. Ampliado no mesmo dia: quem não é gerente não cancela
// mais direto, só "solicita" (com motivo); um gerente vê a solicitação
// (banner no processo + notificação no sino) e aprova ou rejeita.
async function cancelarProcesso(id){
  const souGerente = _user && _user.role === 'gerente';
  const motivo = prompt(souGerente ? 'Motivo do cancelamento (opcional):' : 'Motivo da solicitação de cancelamento:') || '';
  if(souGerente){
    if(!confirm('Cancelar este processo? Ele continua no histórico, mas sai das contagens operacionais (Dashboard TV etc).')) return;
  } else {
    if(!confirm('Solicitar o cancelamento deste processo? Um gerente precisa aprovar para ele ser efetivamente cancelado.')) return;
  }
  const body = souGerente
    ? { id, cancelado:true, cancelado_motivo: motivo }
    : { id, cancelamento_solicitado:true, cancelado_motivo: motivo };
  const r = await fetch('/api/controle/v2/processo', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ processo: body })
  });
  const d = await r.json();
  if(d.ok){
    showToast(souGerente ? '🚫 Processo cancelado' : '📨 Solicitação de cancelamento enviada','ok');
    await carregarProcessos(true);
    const p = _processos.find(p=>p.id===id);
    if(p){ _editando = {...p, _camposIA:{}}; _editandoOriginal = {...p}; renderModal(); }
  } else showToast('Erro'+(d.erro?': '+d.erro:''),'err');
}

async function aprovarCancelamento(id){
  if(!confirm('Aprovar o cancelamento deste processo? Ele continua no histórico, mas sai das contagens operacionais (Dashboard TV etc).')) return;
  const r = await fetch('/api/controle/v2/processo', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ processo:{ id, cancelado:true } })
  });
  const d = await r.json();
  if(d.ok){
    showToast('✅ Cancelamento aprovado','ok');
    await carregarProcessos(true);
    const p = _processos.find(p=>p.id===id);
    if(p){ _editando = {...p, _camposIA:{}}; _editandoOriginal = {...p}; renderModal(); }
  } else showToast('Erro ao aprovar'+(d.erro?': '+d.erro:''),'err');
}

async function rejeitarCancelamento(id){
  if(!confirm('Rejeitar esta solicitação de cancelamento? O processo continua ativo normalmente.')) return;
  const r = await fetch('/api/controle/v2/processo', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ processo:{ id, cancelamento_solicitado:false } })
  });
  const d = await r.json();
  if(d.ok){
    showToast('✖️ Solicitação de cancelamento rejeitada','ok');
    await carregarProcessos(true);
    const p = _processos.find(p=>p.id===id);
    if(p){ _editando = {...p, _camposIA:{}}; _editandoOriginal = {...p}; renderModal(); }
  } else showToast('Erro ao rejeitar'+(d.erro?': '+d.erro:''),'err');
}

async function reverterCancelamento(id){
  if(!confirm('Reverter o cancelamento deste processo?')) return;
  const r = await fetch('/api/controle/v2/processo', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ processo:{ id, cancelado:false } })
  });
  const d = await r.json();
  if(d.ok){
    showToast('↩️ Cancelamento revertido','ok');
    await carregarProcessos(true);
    const p = _processos.find(p=>p.id===id);
    if(p){ _editando = {...p, _camposIA:{}}; _editandoOriginal = {...p}; renderModal(); }
  } else showToast('Erro ao reverter'+(d.erro?': '+d.erro:''),'err');
}

// Dispara na hora o e-mail de follow-up semanal (task #327) — mesma rota
// usada pelo job automático de domingo (ver server.js,
// POST /api/admin/followup-semanal), só que sob demanda. Restrito a
// gerente no back-end; o botão em si já fica escondido no boot (ver
// DOMContentLoaded acima) pra quem não é gerente.
async function gerarFollowUpManual(){
showToast('Gerando follow-up semanal...','info');
try{
const r = await fetch('/api/admin/followup-semanal', { method:'POST' });
const d = await r.json();
if(d.ok) showToast(`✓ Follow-up enviado (${d.processos} processo${d.processos===1?'':'s'})`,'ok');
else showToast('Erro ao gerar follow-up: '+(d.erro||''),'err');
}catch(e){ showToast('Erro de rede ao gerar follow-up: '+e.message,'err'); }
}

// ════════════════════════════════════════════════════════════════
// CÃÂÃÂMBIO
// ════════════════════════════════════════════════════════════════
async function carregarCambio(){
  try{
    const r = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL,CNY-BRL');
    const d = await r.json();
    // Valor bruto sem arredondar — Dólar Comercial (bid da AwesomeAPI)
    _cambio.USD = parseFloat(d.USDBRL?.bid||5.2)||5.2;
    _cambio.EUR = parseFloat(d.EURBRL?.bid||5.7)||5.7;
    _cambio.CNY = parseFloat(d.CNYBRL?.bid||0.72)||0.72;
    const hora = new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    const bar = document.getElementById('cambio-bar');
    if(bar) bar.innerHTML = [
      `USD R$ ${_cambio.USD.toFixed(4)}`,
      `EUR R$ ${_cambio.EUR.toFixed(4)}`,
      `CNY R$ ${_cambio.CNY.toFixed(4)}`,
    ].map(t=>`<span style="font-size:11px;font-family:'DM Mono',monospace;opacity:.8;background:rgba(255,255,255,.1);padding:2px 7px;border-radius:4px;" title="Atualizado ${hora}">${t}</span>`).join('');
  }catch(e){ console.warn('Câmbio erro:',e.message); }
  setTimeout(carregarCambio, 5*60*1000);
}

// ════════════════════════════════════════════════════════════════
// DADOS
// ════════════════════════════════════════════════════════════════
async function carregarProcessos(silencioso){
  if(!silencioso) showToast('Carregando...','info');
  try{
    const r = await fetch('/api/controle/v2/processos');
    const d = await r.json();
    if(d.ok){
      _processos = d.processos || [];
      // Popular select de clientes
      const selCliente = document.getElementById('filtro-cliente');
      if(selCliente){
        const clientesUnicos = [...new Set(_processos.flatMap(p=>clientesDoProcesso(p)))].sort();
        const valAtual = selCliente.value;
        selCliente.innerHTML = '<option value="">👤 Todos os clientes</option>' +
          clientesUnicos.map(c=>`<option value="${c}" ${c===valAtual?'selected':''}>${c}</option>`).join('');
      }
      render();
      renderStats();
      renderFaseFilter();
      renderFiltroProcessoAvancado();
      carregarNotificacoes();
      if(!silencioso) showToast(`${_processos.length} processos carregados`,'ok');
      // Deep link (task #59) — se a página abriu direto em /controle/UD26-005,
      // abre o painel do processo assim que a lista termina de carregar.
      if(_refPendenteDeepLink){
        _abrirProcessoPorReferencia(_refPendenteDeepLink);
        _refPendenteDeepLink = null;
      }
    }
  }catch(e){
    showToast('Erro ao carregar processos','err');
  }
}

// Abre o painel de um processo pela referência (usado por deep link e pelo
// botão voltar/avançar do navegador), SEM mexer no histórico — quem decide
// se pushState/popstate acontece é sempre o chamador (abrirProcesso ou o
// listener de popstate), nunca esta função.
function _abrirProcessoPorReferencia(ref){
  const proc = _processos.find(p=>p.referencia===ref);
  if(!proc) return;
  _editando = {...proc, _camposIA: {}};
  _editandoOriginal = {...proc};
  renderModal();
}

// Botão voltar/avançar do navegador — mantém o painel lateral sincronizado
// com a URL (ex: abrir processo A, abrir processo B, voltar → reabre A;
// voltar de novo → fecha o painel e volta pra lista).
window.addEventListener('popstate', function(){
  const partes = location.pathname.split('/').filter(Boolean);
  const ref = partes[1] ? decodeURIComponent(partes[1]) : null;
  if(ref){
    _abrirProcessoPorReferencia(ref);
  } else if(_editando){
    _editando = null;
    document.getElementById('modal-bg').classList.remove('open');
  }
});

async function salvarProcesso(proc, patchFields){
  const isNovo = !proc.id;
  if(isNovo) proc.id = gerarUUID();
  proc.updated_by = _user.usuario;
  proc.updated_at = new Date().toISOString();
  if(isNovo){ proc.created_by = _user.usuario; proc.created_at = new Date().toISOString(); }

  // Registrar câmbio USD no momento do pedido se não preenchido
  if(!proc.pi_cambio && proc.pi_valor_usd && _cambio.USD){
    proc.pi_cambio = _cambio.USD;
    if(patchFields) patchFields.push('pi_cambio');
  }

  // Recálculo automático de Fase/Demurrage/Armazenagem — SÓ quando os
  // campos que realmente alimentam cada cálculo mudaram nesta sessão de
  // edição (pedido Emanuelly 04/09/2026: editar um campo qualquer, tipo
  // Qtd. Containers, não pode fazer a Fase "saltar" pra Desembarcado nem
  // criar Demurrage vencida do nada). Processos antigos às vezes já têm
  // Presença de Carga preenchida no banco (de um import, por ex.) sem
  // nunca ter passado por aqui — sem essa trava, o primeiro save de
  // QUALQUER campo desses processos recalculava tudo de uma vez e dava
  // essa impressão de "salto". Sem patchFields (chamada antiga/desconhecida
  // ou processo novo), mantém o comportamento de sempre — recalcula tudo.
  const patchTocaCampos = (lista) => !patchFields || !Array.isArray(patchFields) || lista.some(c => patchFields.includes(c));

  // Calcular vencimento demurrage automaticamente
  // Usa parseDataLocal (meio-dia local, T00:00:00) em vez de `new Date(string)`
  // direto — evita depender de coincidência de fuso horário nesse cálculo,
  // que tem impacto financeiro direto (multa por atraso na devolução do container).
  // Base da contagem: Presença de Carga (pedido Emanuelly 03/09/2026,
  // confirmado com teste no UD26-110 — presença 24/08 + 21 dias, contando
  // 24/08 como o 1º dia, vence em 13/09, não Data de Chegada). Fica com
  // fallback pra Data de Chegada só pra processos antigos que nunca
  // chegaram a preencher Presença de Carga.
  if(patchTocaCampos(['data_presenca','data_chegada','free_time'])){
    const baseDemurrage = proc.data_presenca || proc.data_chegada;
    if(baseDemurrage && proc.free_time){
      const inicioDemur = parseDataLocal(baseDemurrage);
      // O dia inicial já conta como o 1º dia do free time (pedido Emanuelly
      // 03/09/2026): free_time=21 a partir do dia X vence 20 dias depois
      // (X, X+1,...,X+20 = 21 dias), não X+21.
      inicioDemur.setDate(inicioDemur.getDate() + parseInt(proc.free_time||0) - 1);
      proc.demurrage_vencimento = inicioDemur.toISOString().split('T')[0];
    }
  }

  // Calcular vencimento do 1º período de armazenagem no porto automaticamente
  // (pedido Emanuelly 03/09/2026) — mesma ideia do demurrage acima, só que
  // conta a partir da Presença de Carga (chegada física no terminal) e os
  // dias grátis são fixos por porto, não um campo digitado (ver
  // PORTO_ARMAZENAGEM_FREE_DIAS em controle-campos.js).
  //
  // SÓ preenche se o campo ainda estiver vazio (pedido Emanuelly 04/09/2026:
  // "precisamos que a data de vencimento se mantenha mesmo que seja alterado
  // [a Presença de Carga depois]") — antes, qualquer correção de Presença ou
  // Porto Destino recalculava e sobrescrevia silenciosamente um vencimento já
  // calculado (ou digitado manualmente no campo "Armazenagem Vence"), o que
  // fazia a data "pular" sem aviso. Uma vez calculado/preenchido, o campo
  // fica fixo — para recalcular de fato, é preciso limpar "Armazenagem Vence"
  // manualmente e salvar de novo.
  if(!proc.armazenagem_vencimento && patchTocaCampos(['data_presenca','porto_destino']) && proc.data_presenca && proc.porto_destino && PORTO_ARMAZENAGEM_FREE_DIAS[proc.porto_destino]){
    const presenca = parseDataLocal(proc.data_presenca);
    // Mesma correção de contagem inclusiva do dia inicial (ver comentário
    // acima no cálculo do demurrage): presença hoje + 5 dias grátis em
    // Navegantes vence daqui a 4 dias (hoje conta como o 1º), não 5.
    presenca.setDate(presenca.getDate() + PORTO_ARMAZENAGEM_FREE_DIAS[proc.porto_destino] - 1);
    proc.armazenagem_vencimento = presenca.toISOString().split('T')[0];
  }

  // demurrage_pago agora é derivado automaticamente da Data de Pagamento da
  // Demurrage (aba Demurrage) em vez de um dropdown Sim/NÃ£o editado Ã  mÃ£o
  // (pedido Emanuelly 03/09/2026, junto com o desmembramento da aba).
  proc.demurrage_pago = !!proc.data_pagamento_demurrage;

  // Avançar fase automaticamente — só recalcula se um dos campos que
  // calcularFase() realmente olha mudou nesta sessão (ver patchTocaCampos
  // acima).
  if(patchTocaCampos(['data_devolucao_vazio','data_carregamento','nf_entrada_numero','nf_saida_numero',
    'data_agendamento','data_liberacao','canal','data_parametrizacao','numero_di','data_registro_di',
    'data_chegada','data_presenca','data_embarque','etd','ric_status','data_pagamento_lavagem'])){
    // ric_status e data_pagamento_lavagem entraram aqui em 04/09/2026: a
    // regra do FINALIZADO (calcularFase) passou a depender desses dois
    // campos (Isento OU Lavagem paga, ver comentário em calcularFase), mas
    // eles tinham ficado de fora desta lista de gatilhos quando ela foi
    // criada — resultado: salvar só o Status RIC ou só a Data Pagamento
    // Lavagem (sem tocar em nenhum outro campo da lista) nunca recalculava
    // a fase, e o processo ficava preso em Devolução do Vazio mesmo com
    // tudo certo (bug reportado pela Emanuelly).
    proc.fase = calcularFase(proc);
  }

  // ── CONCORRÊNCIA: enviar só o que mudou ──────────────────────────
  // Se quem chamou informou patchFields (lista de campos de fato alterados
  // nesta sessão de edição), manda ao servidor só esses campos + os
  // metadados/calculados de sempre — não o processo inteiro. Isso evita que
  // duas pessoas editando o mesmo processo ao mesmo tempo apaguem uma a
  // mudança da outra: cada save só toca nos campos que aquele usuário de
  // fato mexeu. Sem patchFields (chamada antiga/desconhecida), mantém o
  // comportamento de sempre — manda o processo inteiro.
  let payload = proc;
  if(patchFields && Array.isArray(patchFields)){
    const camposFixos = ['id','referencia','fase','demurrage_vencimento','armazenagem_vencimento','demurrage_pago','pi_cambio',
      'updated_by','updated_at','created_by','created_at','log'];
    const chaves = [...new Set([...camposFixos, ...patchFields])];
    payload = {};
    chaves.forEach(k=>{ if(proc[k]!==undefined) payload[k] = proc[k]; });
  }

  showToast('Salvando...','info');
  let r, d;
  try{
    r = await fetch('/api/controle/v2/processo', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ processo: payload })
    });
    d = await r.json();
  } catch(netErr){
    showToast('Erro de rede ao salvar: '+netErr.message,'err');
    return false;
  }
  if(d.ok){
    showToast('✓ Salvo','ok');
    // Criar notificação se houver alerta
    verificarAlertas(proc, true);
    await carregarProcessos(true);
    return true;
  } else {
    showToast('Erro ao salvar: '+(d.erro||''),'err');
    return false;
  }
}

async function excluirProcesso(id){
  if(!confirm('Excluir este processo?')) return;
  const r = await fetch('/api/controle/v2/processo/'+id, {method:'DELETE'});
  const d = await r.json();
  if(d.ok){ showToast('Processo excluído','ok'); fecharModal(); carregarProcessos(true); }
  // Mostra o erro real do servidor em vez de um "Erro ao excluir" genérico
  // — antes disso ficava impossível saber, sem abrir o console, por que
  // um processo específico não excluía (ex: violação de foreign key).
  else showToast('Erro ao excluir'+(d.erro?': '+d.erro:''),'err');
}

// ════════════════════════════════════════════════════════════════
// FASE AUTOMÁTICA
// ════════════════════════════════════════════════════════════════
function calcularFase(p){
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  // "Data Chegada", "Data Presença" e "Data de Embarque" só contam pra
  // avançar a fase se já aconteceram de fato. Se alguém preencher uma data
  // futura ali (comum quando o booking já traz uma previsão e a pessoa
  // preenche no campo errado por hÃÂÃÂ¡bito), NÃÂÃÂO trata como jÃÂÃÂ¡ embarcado/
  // desembarcado — fica na fase anterior até a data realmente chegar. Use
  // os campos de previsão (ETD/ETA/Previsão Prontidão) pra isso — e na
  // prática o próprio formulário já move a data automaticamente pro campo
  // de previsão certo quando detecta uma data futura nesses campos (ver
  // moverDataFuturaParaPrevisao) — isso aqui é só a segunda camada de
  // proteção, pro caso de a data chegar aqui por outro caminho (ex: leitura
  // por IA), sem depender só do que roda no onchange do campo.
  const chegadaPassada  = p.data_chegada  && new Date(p.data_chegada+'T00:00:00')  <= hoje ? p.data_chegada  : null;
  const presencaPassada = p.data_presenca && new Date(p.data_presenca+'T00:00:00') <= hoje ? p.data_presenca : null;
  const embarquePassado = p.data_embarque && new Date(p.data_embarque+'T00:00:00') <= hoje ? p.data_embarque : null;

  // Finalizado exige, alem da devolucao do container vazio, que a
  // pendencia do RIC esteja resolvida: ou o Status RIC foi preenchido
  // como Isento (nao ha taxa de lavagem a pagar), ou -- quando nao for
  // isento -- a Data Pagamento Lavagem foi preenchida (a taxa foi paga).
  // Pedido da Emanuelly (04/09/2026): antes disso o processo ficava
  // 'preso' em Devolucao do Vazio ate alguem lembrar de conferir RIC/
  // lavagem manualmente.
  if(p.data_devolucao_vazio && (p.ric_status === 'Isento' || p.data_pagamento_lavagem)) return 'FINALIZADO';
  // Quando AMBAS as NFs (entrada e saída) estão emitidas, isso já é prova
  // suficiente de que o carregamento aconteceu de fato — avança direto para
  // Devolução do Vazio, mesmo sem a data_carregamento manual preenchida,
  // para já acionar o alerta de demurrage dessa etapa.
  if(p.data_carregamento || (p.nf_entrada_numero && p.nf_saida_numero)) return 'DEVOLUCAO_VAZIO';
  if(p.data_agendamento || p.nf_saida_numero || p.nf_entrada_numero) return 'CARREGAMENTO';
  if(p.data_liberacao || (p.canal==='VERDE' && p.data_parametrizacao)) return 'FATURAMENTO';
  if(p.canal || p.data_parametrizacao)                              return 'PARAMETRIZACAO';
  if(p.numero_di || p.data_registro_di)                             return 'REGISTRO_DI';
  if(presencaPassada || chegadaPassada)                             return 'DESEMBARCADO';
  // Igual ao caso do Booking acima: o Nº HBL costuma ser preenchido antes
  // do embarque acontecer de fato (o armador/agente já manda o HBL com
  // antecedência), então usar só "p.hbl" aqui fazia o status pular pra
  // "Embarcado" antes da hora — mesmo com o embarque real ainda previsto
  // pra outro dia. Agora só a Data de Embarque (Efetiva) — quando já
  // passou — conta como embarque de verdade.
  if(embarquePassado)                                               return 'EMBARCADO';
  // O status avança pra "Ag. Embarque" só com a Previsão de Embarque (ETD)
  // preenchida ÃÂ¢ÃÂÃÂ NÃÂÃÂO mais com o NÃÂÃÂº Booking. Motivo: como o booking real
  // muitas vezes não chega a tempo, o time preenche esse campo com a
  // referência da Royal (não o booking de verdade), e o status mudava
  // prematuramente/erradamente por causa disso. O ETD é um dado mais
  // confiável desse ponto do processo.
  if(p.etd)                                                         return 'AGUARDANDO_EMBARQUE';
  return 'PI';
}

// ════════════════════════════════════════════════════════════════
// DEMURRAGE
// ════════════════════════════════════════════════════════════════
function demurrageDias(proc){
  if(!proc.demurrage_vencimento) return null;
  const venc = parseDataLocal(proc.demurrage_vencimento);
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  return Math.ceil((venc-hoje)/86400000);
}

// Mesma lógica do demurrageDias() acima, só que pro vencimento do 1º
// período de armazenagem no porto (ver PORTO_ARMAZENAGEM_FREE_DIAS).
function armazenagemDias(proc){
  if(!proc.armazenagem_vencimento) return null;
  const venc = parseDataLocal(proc.armazenagem_vencimento);
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  return Math.ceil((venc-hoje)/86400000);
}

// Processo com chegada prevista (ETA) nos próximos N dias e que ainda não
// desembarcou de fato (sem data_chegada preenchida — assim que a chegada
// efetiva é registrada, o processo sai naturalmente deste card). Usado
// pelo card "Chegada em 7 dias" do Dashboard e pelo filtro correspondente
// na tabela — mesma regra nos dois lugares, pra não desalinhar contagem e
// lista exibida ao clicar no card.
function chegandoEmDias(proc, dias){
  if(proc.data_chegada || proc.fase==='FINALIZADO' || !proc.eta) return false;
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const limite = new Date(hoje); limite.setDate(hoje.getDate()+dias);
  const eta = new Date(proc.eta+'T00:00:00');
  return eta>=hoje && eta<=limite;
}

// ════════════════════════════════════════════════════════════════
// PAGAMENTOS DE PI — fonte única pro Dashboard Financeiro
// ════════════════════════════════════════════════════════════════
// Um processo com forma "Entrada+Saldo" na verdade tem DUAS datas de
// vencimento e DOIS câmbios diferentes — tratar isso como "um pagamento só"
// (como o resto do sistema faz) esconde a parcela de Entrada inteira do
// fluxo de caixa e do controle cambial. Essa função "achata" cada processo
// em 1 ou 2 parcelas de pagamento individuais, cada uma já com fornecedor,
// país (via porto de origem), valor, vencimento, câmbio previsto/fechado e
// se já foi paga — pra não reimplementar essa lógica 3x (KPIs, calendário,
// câmbio) de formas ligeiramente diferentes e desalinhadas entre si.
//
// "Pago" por parcela (não usa só o pi_pago geral do processo, que só vira
// true quando TUDO foi pago):
//  - única (Vista/Prazo): usa pi_pago mesmo — é o único pagamento do processo.
//  - entrada: considera paga se já tem câmbio de entrada fechado registrado.
//  - saldo: usa pi_pago — é a parcela que fecha o processo (ver confirmarCambioComo).
function listarPagamentosPI(processos){
  const pagamentos = [];
  (processos||[]).forEach(p=>{
    const valorTotal = parseFloat(p.pi_valor_usd)||0;
    if(!valorTotal || p.fase==='FINALIZADO') return;
    // numeroDi incluído a pedido do Ayslan (09/09/2026): campo "extremamente
    // útil" pra identificar rapidamente a qual DI/DUIMP um pagamento de
    // câmbio pertence, sem precisar abrir o processo. Pode vir vazio (DI só
    // é registrada depois, na fase Registro DI) — tratado como '—' na UI.
    const base = { referencia:p.referencia, processoId:p.id, fornecedor:p.fornecedor||'—', pais:paisDoProcesso(p), moeda:'USD', cliente:p.cliente||'—', numeroDi:p.numero_di||'' };
    // banco/custoOperacao: registrados a pedido do Ayslan (09/09/2026,
    // "se você fosse o financeiro, o que gostaria de ver") -- só fazem
    // sentido depois que o câmbio foi de fato fechado (não dá pra saber o
    // banco/custo de algo ainda em aberto). Pagamento único/Entrada+Saldo
    // legado usam os 2 campos do processo (pi_cambio_banco/pi_cambio_custo)
    // pros dois lados -- é uma aproximação (não dá pra ter banco/custo
    // diferente pra entrada e saldo nesse modelo legado), documentada aqui
    // porque Parcelado (abaixo) já tem os campos por parcela de verdade.
    const bancoProc = p.pi_cambio_banco || null;
    const custoProc = parseFloat(p.pi_cambio_custo) || null;
    if(p.pi_pagamento==='ENTRADA_SALDO'){
      const pct = parseFloat(p.pi_entrada_pct||30)/100;
      const cambioPrevisto = parseFloat(p.pi_cambio)||null;
      pagamentos.push({...base, parcela:'entrada', _tipo:'entrada',
        valorUsd: valorTotal*pct, vencimento: p.pi_data_entrada||null,
        cambioPrevisto, cambioFechado: parseFloat(p.pi_cambio_entrada)||null,
        banco: bancoProc, custoOperacao: custoProc,
        pago: !!p.pi_cambio_entrada });
      pagamentos.push({...base, parcela:'saldo', _tipo:'saldo',
        valorUsd: valorTotal*(1-pct), vencimento: p.pi_data_saldo||null,
        cambioPrevisto, cambioFechado: parseFloat(p.pi_cambio_saldo)||null,
        banco: bancoProc, custoOperacao: custoProc,
        pago: !!p.pi_pago });
    } else if(p.pi_pagamento==='PARCELADO'){
      // "Parcelado" (N câmbios, valor fixo em USD cada) — achata cada linha
      // de pi_parcelas_json num pagamento próprio, mesmo espírito de
      // Entrada+Saldo acima, só que sem limite de 2. "Paga" por parcela usa
      // a presença de câmbio fechado (mesma regra da parcela "entrada"), já
      // que aqui não existe um pi_pago único cobrindo "a última parcela".
      let parcelas = [];
      try{ parcelas = p.pi_parcelas_json ? JSON.parse(p.pi_parcelas_json) : []; }catch(e){ parcelas = []; }
      parcelas.forEach((pc,i)=>{
        const v = parseFloat(pc.valor_usd)||0;
        if(!v) return;
        pagamentos.push({...base, parcela: pc.label || ('parcela '+(i+1)), _tipo:'parcelado', _parcelaIndex:i,
          valorUsd: v, vencimento: pc.data_vencimento||null,
          cambioPrevisto: parseFloat(p.pi_cambio)||null, cambioFechado: parseFloat(pc.cambio_fechado)||null,
          banco: pc.banco || null, custoOperacao: parseFloat(pc.custo_operacao) || null,
          pago: !!pc.cambio_fechado });
      });
    } else if(p.pi_pagamento==='VISTA' || p.pi_pagamento==='PRAZO'){
      const vencimento = p.pi_pagamento==='PRAZO' ? p.pi_data_saldo : p.pi_data_entrada;
      pagamentos.push({...base, parcela:'unico', _tipo:'unico',
        valorUsd: valorTotal, vencimento: vencimento||null,
        cambioPrevisto: parseFloat(p.pi_cambio)||null, cambioFechado: parseFloat(p.pi_cambio_fechado)||null,
        banco: bancoProc, custoOperacao: custoProc,
        pago: !!p.pi_pago });
    }
    // Sem pi_pagamento definido ainda (processo recém-criado, só com valor
    // da PI preenchido): não dá pra saber vencimento nem parcelas, mas ainda
    // conta pra Exposição em USD — entra como pagamento "sem forma definida".
    else {
      pagamentos.push({...base, parcela:'indefinido', _tipo:'indefinido',
        valorUsd: valorTotal, vencimento: null,
        cambioPrevisto: parseFloat(p.pi_cambio)||null, cambioFechado: null,
        pago: !!p.pi_pago });
    }
  });
  return pagamentos;
}

function demurrageDisplay(proc){
  if(proc.fase === 'FINALIZADO' || proc.data_devolucao_vazio) return '<span style="color:var(--ok)">✓ Devolvido</span>';
  const dias = demurrageDias(proc);
  if(dias === null) return '<span style="color:var(--dim)">—</span>';
  if(dias < 0) return `<span class="demur-err">Vencido há ${Math.abs(dias)}d</span>`;
  if(dias <= 5) return `<span class="demur-warn">⚠ ${dias}d</span>`;
  return `<span class="demur-ok">${dias}d</span>`;
}

// Gera o bloco "Cálculo do Demurrage" (aba Logística). Extraída como função própria
// para poder ser recalculada em tempo real conforme o usuário digita (ver
// atualizarFaseEmTempoReal), e não apenas uma vez quando o modal abre.
function renderDemurInfo(p){
  if(!p.data_chegada && !p.data_presenca && !p.demurrage_vencimento) return '';
  // Base da contagem: Presença de Carga, com fallback pra Data de Chegada
  // (ver mesmo ajuste em salvarProcesso acima — pedido Emanuelly 03/09/2026,
  // confirmado com o teste do UD26-110).
  const baseDemur = p.data_presenca || p.data_chegada;
  const inicioDemur = parseDataLocal(baseDemur);
  const chegada   = parseDataLocal(p.data_chegada);
  const freeTime  = parseInt(p.free_time||21);
  const vencCalc  = inicioDemur ? new Date(inicioDemur) : null;
  if(vencCalc) vencCalc.setDate(inicioDemur.getDate() + freeTime - 1);
  const vencReal  = p.demurrage_vencimento ? parseDataLocal(p.demurrage_vencimento) : vencCalc;
  const dias = demurrageDias(p);
  const cor  = dias===null?'var(--muted)':dias<0?'var(--err)':dias<=5?'var(--warn)':'var(--ok)';

  let statusTxt = '', statusIcon = '';
  if(p.data_devolucao_vazio){
    statusIcon = '✅'; statusTxt = `Container devolvido em ${parseDataLocal(p.data_devolucao_vazio).toLocaleDateString('pt-BR')}`;
  } else if(dias !== null && dias < 0){
    statusIcon = '🔴'; statusTxt = `VENCIDO há ${Math.abs(dias)} dia(s) — custos acumulando!`;
  } else if(dias !== null && dias <= 5){
    statusIcon = '⚠️'; statusTxt = `Atenção: vence em ${dias} dia(s)`;
  } else if(dias !== null){
    statusIcon = '🟢'; statusTxt = `${dias} dias restantes`;
  }

  return `<div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-top:10px;">
    <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px;">📊 Cálculo do Demurrage</div>
    <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;">
      ${inicioDemur ? `<div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">📅 ${p.data_presenca?'Presença de carga':'Data de chegada'}</span><strong>${inicioDemur.toLocaleDateString('pt-BR')}</strong></div>` : ''}
      <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">⏱ Free time</span><strong>${freeTime} dias</strong></div>
      ${vencReal ? `<div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:6px;"><span style="color:var(--muted);">📌 Vencimento</span><strong style="color:${cor}">${vencReal.toLocaleDateString('pt-BR')}</strong></div>` : ''}
      ${statusTxt ? `<div style="margin-top:4px;padding:8px 12px;background:${dias!==null&&dias<0?'rgba(220,38,38,.08)':dias!==null&&dias<=5?'rgba(217,119,6,.08)':'rgba(22,163,74,.08)'};border-radius:6px;font-weight:600;color:${cor};">${statusIcon} ${statusTxt}</div>` : ''}
      ${p.demurrage_valor ? `<div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:6px;"><span style="color:var(--muted);">💸 Valor registrado</span><strong>R$ ${parseFloat(p.demurrage_valor).toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong></div>` : ''}
    </div>
  </div>`;
}

// Bloco "Cálculo da Armazenagem" (aba Logística) — mesmo padrão do
// renderDemurInfo() acima, recalculado ao vivo (ver atualizarFaseEmTempoReal
// em controle-modal.js). Só aparece se o porto de destino tem prazo
// configurado (ver PORTO_ARMAZENAGEM_FREE_DIAS).
function renderArmazenInfo(p){
  const freeDias = PORTO_ARMAZENAGEM_FREE_DIAS[p.porto_destino];
  if(!p.data_presenca && !p.armazenagem_vencimento) return '';
  if(!freeDias && !p.armazenagem_vencimento) return '';
  const presenca  = parseDataLocal(p.data_presenca);
  const vencCalc  = presenca && freeDias ? new Date(presenca) : null;
  if(vencCalc) vencCalc.setDate(presenca.getDate() + freeDias - 1);
  const vencReal  = p.armazenagem_vencimento ? parseDataLocal(p.armazenagem_vencimento) : vencCalc;
  const dias = armazenagemDias(p);
  const cor  = dias===null?'var(--muted)':dias<0?'var(--err)':dias<=2?'var(--warn)':'var(--ok)';

  let statusTxt = '', statusIcon = '';
  if(p.data_carregamento){
    // Em vez de repetir a data de vencimento (que é um campo editável à
    // parte, "Armazenagem Vence" — pode ficar dessincronizada do cálculo
    // ao vivo se ninguém mexer nela depois de mudar Presença/Porto), mostra
    // quantos dias a retirada ficou além (ou dentro) do 1º período grátis,
    // calculado direto a partir de Presença + Free Time do porto. Pedido
    // Emanuelly (04/09/2026): "tá variando a data do vencimento em vez de
    // informar quantos dias passou do primeiro período".
    const retirada = parseDataLocal(p.data_carregamento);
    const diasAlem = vencCalc ? Math.round((retirada - vencCalc)/86400000) : null;
    if(diasAlem !== null && diasAlem > 0){
      statusIcon = '✅'; statusTxt = `Carga retirada em ${retirada.toLocaleDateString('pt-BR')} — ${diasAlem}d além do 1º período grátis`;
    } else {
      statusIcon = '✅'; statusTxt = `Carga retirada em ${retirada.toLocaleDateString('pt-BR')} — dentro do 1º período grátis`;
    }
  } else if(dias !== null && dias < 0){
    statusIcon = '🔴'; statusTxt = `VENCIDO há ${Math.abs(dias)} dia(s) — armazenagem adicional acumulando!`;
  } else if(dias !== null && dias <= 2){
    statusIcon = '⚠️'; statusTxt = `Atenção: vence em ${dias} dia(s)`;
  } else if(dias !== null){
    statusIcon = '🟢'; statusTxt = `${dias} dias restantes`;
  }

  return `<div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-top:10px;">
    <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px;">📦 Cálculo da Armazenagem (1º período)</div>
    <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;">
      ${presenca ? `<div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">📅 Presença de carga</span><strong>${presenca.toLocaleDateString('pt-BR')}</strong></div>` : ''}
      ${freeDias ? `<div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">⏱ Free time do porto</span><strong>${freeDias} dias</strong></div>` : ''}
      ${vencReal ? `<div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:6px;"><span style="color:var(--muted);">📌 Vencimento</span><strong style="color:${cor}">${vencReal.toLocaleDateString('pt-BR')}</strong></div>` : ''}
      ${statusTxt ? `<div style="margin-top:4px;padding:8px 12px;background:${dias!==null&&dias<0?'rgba(220,38,38,.08)':dias!==null&&dias<=2?'rgba(217,119,6,.08)':'rgba(22,163,74,.08)'};border-radius:6px;font-weight:600;color:${cor};">${statusIcon} ${statusTxt}</div>` : ''}
    </div>
  </div>`;
}

// ════════════════════════════════════════════════════════════════
// FECHAMENTO — estimado (da cotação aprovada) × real (NF Entrada/Saída)
// ════════════════════════════════════════════════════════════════
// Função pura (sem DOM) que compara o que foi cotado no Calculador
// (p.estimativa_json, gravado em POST /api/calculador/cotacoes/:id/aprovar)
// com o resultado real do processo (NF Saída − NF Entrada, já preenchidos
// na aba Documentos). Compara sempre contra o cenário Com S.T. (é o mais
// comum na prática — resumo antigo, salvo antes dos dois cenários existirem,
// cai no faturamento genérico que tinha na época).
// ── CUSTOS REAIS — apuração de lucro por processo, item a item ────
// Mesmos grupos/campos usados no Calculador (TAXAS_CONFIG + FOB/Frete/
// Seguro/Taxa C.E. + Impostos + Comissões) — pra dar pra apurar o lucro
// real de QUALQUER processo, com ou sem cotação aprovada. `cotado(c)` lê o
// valor cotado de dentro de p.estimativa_json.custos_cotados_json (gravado
// por resumoParaLista() no calculador.html, ao salvar a cotação) — usado só
// como REFERÊNCIA/ponto de partida na aba Custos Reais; o cálculo do lucro
// real (ver calcularCustoRealTotal) usa exclusivamente o que está em
// p.real_json/p.real_cambio, preenchido pelo usuário no Controle.
//
// p.real_json e p.real_cambio já existem no banco (migration
// 0004_add_custos_reais_processo.sql, aplicada em produção e no lab em
// 2026-07-19) — a coluna foi criada antes pra essa mesma finalidade, mas o
// código que a usava nunca chegou a ser commitado. Reaproveitada aqui em vez
// de criar coluna nova. real_json guarda um valor TOTAL (já em R$ ou US$,
// conforme a unidade do item) por chave de item (ver custosReaisItensFlat) —
// mais simples que o { fixas, usd } por-container original documentado na
// migration, e cobre também Compra/Impostos/Comissões, não só as 21 taxas.
// FIX (a pedido do usuário): FOB/Frete/Seguro/Taxa C.E. e as Taxas em USD
// (destino) eram unidade:'USD' aqui — exigia conversão manual toda vez que
// alguém abria a aba, mesmo o Calculador já parametrizando um câmbio
// específico pra cada um desses itens (câmbio ponderado pelas parcelas pro
// FOB, câmbio de abertura+2% pro Frete/Seguro/Taxas em USD, câmbio único da
// simulação pra Taxa C.E — ver resumoParaLista() em calculador.html). Agora
// unidade:'BRL' em todos — os valores que chegam em custos_cotados_json já
// vêm convertidos pelo câmbio correto de cada item, não mais em dólar puro.
// pc(id) = "porContainer" derivado do catálogo único de taxas
// (window.TaxasCatalogo, ver taxas-catalogo.js) — fonte única com o
// Calculador (TAXAS_CONFIG em calculador.html) pra saber se uma taxa
// multiplica pela quantidade de containers do processo ou é um valor
// único (base_rateio 'container' vs 'processo'). Antes cada item aqui
// tinha um porContainer:true/false hardcoded, digitado à mão e sem
// nenhuma ligação com a mesma regra no Calculador — risco real de
// divergência se alguém mudasse um lado e esquecesse o outro.
function pc(id) {
  const t = (window.TaxasCatalogo && window.TaxasCatalogo.porId) ? window.TaxasCatalogo.porId(id) : null;
  return !!(t && t.base_rateio === 'container');
}
const CUSTOS_REAIS_CONFIG = [
  { grupo:'Compra e Frete', slug:'compra', itens:[
    { id:'fob',      label:'Custo da mercadoria', unidade:'BRL', unidadeLegado:'USD', cotado:c=>c?.compra?.fob },
    { id:'frete',    label:'Frete Internacional',  unidade:'BRL', unidadeLegado:'USD', cotado:c=>c?.compra?.frete },
    { id:'seguro',   label:'Seguro',               unidade:'BRL', unidadeLegado:'USD', cotado:c=>c?.compra?.seguro_usd },
    // Taxa C.E. (CE Mercante): nao e custo nem lucro, e so um valor que
    // entra na BASE de calculo dos impostos de importacao quando o frete
    // declarado no CE Mercante fica acima do informado. A Impak nao paga
    // essa taxa a ninguem, entao ela fica de fora do Custo do Processo e
    // do totalizador por etapa (ver excluirDosTotais em
    // calcularCustoRealTotal/calcularReceitaRealTotal/calcularTotalizadorPorGrupo).
    { id:'taxa_ce',  label:'Taxa C.E. (CE Mercante)', unidade:'BRL', unidadeLegado:'USD', excluirDosTotais:true, cotado:c=>c?.compra?.taxa_ce },
  ]},
  // apenasPago:true = imposto não tem "compra × venda" — é só um valor a
  // pagar pro governo, sempre em R$, sem contrapartida cobrada do cliente
  // (diferente das taxas operacionais, que podem ter margem). A aba mostra
  // só um campo "Valor a pagar", sem Cobrado/Margem nem seletor de moeda.
  { grupo:'Impostos de Importação', slug:'impostos', itens:[
    // II (Imposto de Importacao) e a UNICA excecao do grupo: confirmado na
    // planilha (UD26-052, aba "Demonstrativo COM S.T") que ele ENTRA no
    // Custo Total (F48) igual FOB/Frete/Taxas, e o Custo Total inteiro e
    // multiplicado pelo fator de venda (F51=F48*D51) pra chegar no Valor
    // Total dos Produtos cobrado do cliente - ou seja, o II E recuperado do
    // cliente (via markup sobre o custo, nao como linha separada na NF),
    // diferente de IPI/PIS/COFINS/ICMS/IBS/CBS abaixo (creditos tributarios
    // recuperaveis, sem venda associada) e diferente de Antidumping (encargo
    // absorvido sem repasse). Por isso tem Cobrado/margem como uma taxa
    // normal, ao contrario dos demais itens deste grupo.
    { id:'ii',     label:'II',     unidade:'BRL', cotado:c=>c?.impostos?.ii },
    { id:'ipi',    label:'IPI',    unidade:'BRL', apenasPago:true, cotado:c=>c?.impostos?.ipi },
    { id:'pis',    label:'PIS',    unidade:'BRL', apenasPago:true, cotado:c=>c?.impostos?.pis },
    { id:'cofins', label:'COFINS', unidade:'BRL', apenasPago:true, cotado:c=>c?.impostos?.cofins },
    { id:'icms',   label:'ICMS',   unidade:'BRL', apenasPago:true, cotado:c=>c?.impostos?.icms },
    { id:'ibs',    label:'IBS',    unidade:'BRL', apenasPago:true, temCredito:true, cotado:c=>c?.impostos?.ibs },
    { id:'cbs',    label:'CBS',    unidade:'BRL', apenasPago:true, temCredito:true, cotado:c=>c?.impostos?.cbs },
    // Antidumping: direito antidumping (encargo governamental cobrado quando o
    // toggle "dump" está SIM no Calculador) — igual aos demais impostos, sem
    // compra×venda, só existe quando a cotação de origem teve o toggle ativo.
    { id:'antidumping', label:'Antidumping', unidade:'BRL', apenasPago:true, cotado:c=>c?.impostos?.antidumping },
  ]},
  { grupo:'Comissões', slug:'comissoes', itens:[
    { id:'comissao_br',    label:'Comissão BR (Representante)', unidade:'BRL', cotado:c=>c?.comissoes?.br },
    { id:'comissao_china', label:'Comissão China',              unidade:'BRL', cotado:c=>c?.comissoes?.china },
    { id:'comissao_boss',  label:'Comissão Boss/Lopes',         unidade:'BRL', cotado:c=>c?.comissoes?.boss },
  ]},
  // porContainer:true = no Calculador esse valor é POR container (r.txOp);
  // usado só pra multiplicar corretamente ao calcular o "Cotado" total abaixo
  // (calcularCustoCotadoItem). Os valores REAIS lançados na aba são sempre o
  // TOTAL do item pro processo inteiro — o usuário não precisa multiplicar.
  { grupo:'Taxas Operacionais', slug:'taxas', itens:[
    { id:'siscomex',         label:'Siscomex',                unidade:'BRL', porContainer:pc('siscomex'),  cotado:c=>c?.taxas_fixas?.siscomex },
    { id:'marinha',          label:'Marinha/AFRMM',           unidade:'BRL', porContainer:pc('marinha'),  cotado:c=>c?.taxas_fixas?.marinha },
    { id:'armazenagem',      label:'Armazenagem',             unidade:'BRL', porContainer:pc('armazenagem'), cotado:c=>c?.taxas_fixas?.armazenagem },
    { id:'emissao_li',       label:'Emissão L.I.',            unidade:'BRL', porContainer:pc('emissao_li'),  cotado:c=>c?.taxas_fixas?.emissao_li },
    { id:'baixa_patio',      label:'Baixa Pátio',             unidade:'BRL', porContainer:pc('baixa_patio'),  cotado:c=>c?.taxas_fixas?.baixa_patio },
    { id:'capatazia',        label:'Capatazia/THC',           unidade:'BRL', porContainer:pc('capatazia'),  cotado:c=>c?.taxas_fixas?.capatazia },
    { id:'liberacao_bl',     label:'Liberação BL',            unidade:'BRL', porContainer:pc('liberacao_bl'),  cotado:c=>c?.taxas_fixas?.liberacao_bl },
    { id:'despachante',      label:'Despachante',             unidade:'BRL', porContainer:pc('despachante'),  cotado:c=>c?.taxas_fixas?.despachante },
    { id:'sda',              label:'SDA',                     unidade:'BRL', porContainer:pc('sda'),  cotado:c=>c?.taxas_fixas?.sda },
    { id:'lavacao',          label:'Lavação Container',       unidade:'BRL', porContainer:pc('lavacao'),  cotado:c=>c?.taxas_fixas?.lavacao },
    { id:'administrativo',   label:'Administrativo',          unidade:'BRL', porContainer:pc('administrativo'),  cotado:c=>c?.taxas_fixas?.administrativo },
    { id:'agente',           label:'Agente Carga',            unidade:'BRL', porContainer:pc('agente'),  cotado:c=>c?.taxas_fixas?.agente },
    { id:'custos_diversos',  label:'Custos Diversos',         unidade:'BRL', porContainer:pc('custos_diversos'), cotado:c=>c?.custos_diversos },
    // Seguro de Venda: distinto do Seguro (Compra e Frete acima, custo interno
    // da importação) — é a taxa de seguro cobrada na proposta ao cliente, que
    // compõe total_taxas/custo_total no Calculador (ver comentário em
    // calcular(), "deve compor as Taxas Operacionais").
    { id:'seguro_venda',    label:'Seguro de Venda',         unidade:'BRL', porContainer:pc('seguro_venda'), cotado:c=>c?.seguro_venda },
    { id:'handling',         label:'Handling at Destination', unidade:'BRL', unidadeLegado:'USD', porContainer:pc('handling'),  cotado:c=>c?.taxas_usd?.handling },
    { id:'additional_costs', label:'Additional Costs',        unidade:'BRL', unidadeLegado:'USD', porContainer:pc('additional_costs'),  cotado:c=>c?.taxas_usd?.additional_costs },
    { id:'import_logistics', label:'Import Logistics',        unidade:'BRL', unidadeLegado:'USD', porContainer:pc('import_logistics'),  cotado:c=>c?.taxas_usd?.import_logistics },
    { id:'trs',              label:'TRS',                     unidade:'BRL', unidadeLegado:'USD', porContainer:pc('trs'),  cotado:c=>c?.taxas_usd?.trs },
    { id:'tsc',              label:'TSC',                     unidade:'BRL', unidadeLegado:'USD', porContainer:pc('tsc'),  cotado:c=>c?.taxas_usd?.tsc },
    { id:'drop_off',         label:'Drop Off',                unidade:'BRL', unidadeLegado:'USD', porContainer:pc('drop_off'),  cotado:c=>c?.taxas_usd?.drop_off },
    { id:'isps',             label:'ISPS',                    unidade:'BRL', unidadeLegado:'USD', porContainer:pc('isps'),  cotado:c=>c?.taxas_usd?.isps },
    { id:'iof',              label:'IOF',                     unidade:'BRL', unidadeLegado:'USD', porContainer:pc('iof'),  cotado:c=>c?.taxas_usd?.iof },
    { id:'desconsolidacao',  label:'Desconsolidação',         unidade:'BRL', unidadeLegado:'USD', porContainer:pc('desconsolidacao'),  cotado:c=>c?.taxas_usd?.desconsolidacao },
    // Reciclagem: pedido do Jean (03/09/2026) — precisa de Pago/Cobrado
    // proprios porque em Encomenda esse custo e do cliente (nao entra no
    // processo) e em Importacao Propria IMPAK e custo nosso (cobra X do
    // cliente, paga Y). Antes ia dentro de 'Custos Diversos'.
    { id:'reciclagem',       label:'Reciclagem',              unidade:'BRL', porContainer:pc('reciclagem'), cotado:c=>c?.taxas_fixas?.reciclagem },
    // ICMS de Saida (ICMS Proprio, 1,4%): calculado sobre o Valor Total dos
    // Produtos da NF de Entrada, lancado na NF de Saida ao cliente. E custo
    // real (Pago = o que foi recolhido) mas tambem e cobrado do cliente
    // igual ou a maior, entao gera margem como as demais Taxas Operacionais
    // (nao tem apenasPago nem temCredito - e diferente do ICMS pago na
    // importacao, que fica no grupo Impostos de Importacao acima e tem
    // credito).
    { id:'icms_saida', label:'ICMS de Saída (1,4% s/ Produtos)', unidade:'BRL', porContainer:pc('icms_saida'), cotado:c=>null },
  ]},
  // Diferencas de Impostos e Taxas Extras (aba Fechamento da planilha,
  // linhas 22-40) - itens que so aparecem depois do fechamento do
  // processo (D.I. registrada + NF de Saida emitida), quando da pra
  // reconciliar o que foi de fato pago na importacao contra o que a NF de
  // Saida exige (a diferenca de base de calculo gera imposto adicional a
  // pagar). Lancamento manual, igual aos demais itens de "so valor a
  // pagar" (apenasPago) - o Controle nao tem (ainda) um motor de calculo
  // de impostos por UF pra reproduzir a planilha sozinho, entao quem
  // reconcilia o D.I. digita o valor calculado aqui, e o Lucro Real passa
  // a bater com a celula G58 da aba Fechamento. diferenca_ibs/diferenca_cbs
  // ficam de fora dos totais (excluirDosTotais) porque a propria planilha
  // exclui essas duas linhas do total de custo (formula G42 da aba
  // Fechamento: =SOMA(G17:G41)-G30-G31).
  { grupo:'Diferenças de Impostos (Fechamento)', slug:'diferencas', itens:[
    { id:'adiantamento_porto',        label:'Adiantamento Porto (Liberação/Aduaneiras)', unidade:'BRL', apenasPago:true, cotado:c=>null },
    { id:'agente_frete',              label:'Agente Frete',                              unidade:'BRL', apenasPago:true, cotado:c=>null },
    { id:'diferenca_ipi',             label:'Diferença IPI (NFe × D.I.)',                unidade:'BRL', apenasPago:true, cotado:c=>null },
    { id:'diferenca_pis',             label:'Diferença PIS (NFe × D.I.)',                unidade:'BRL', apenasPago:true, cotado:c=>null },
    { id:'diferenca_cofins',          label:'Diferença COFINS (NFe × D.I.)',             unidade:'BRL', apenasPago:true, cotado:c=>null },
    { id:'diferenca_icms_proprio',    label:'Diferença ICMS Próprio (NFe × D.I.)',       unidade:'BRL', apenasPago:true, cotado:c=>null },
    { id:'icms_st',                   label:'ICMS Substituição Tributária (recuperado do cliente via NF)', unidade:'BRL', cotado:c=>null },
    { id:'diferenca_ibs',             label:'Diferença IBS',                             unidade:'BRL', apenasPago:true, excluirDosTotais:true, cotado:c=>null },
    { id:'diferenca_cbs',             label:'Diferença CBS',                             unidade:'BRL', apenasPago:true, excluirDosTotais:true, cotado:c=>null },
    { id:'marjoracao',                label:'Marjoração 0,6%',                           unidade:'BRL', apenasPago:true, cotado:c=>null },
    { id:'comissao_vendedor',         label:'Comissão Vendedor',                         unidade:'BRL', apenasPago:true, cotado:c=>null },
    { id:'reciclagem_fechamento',      label:'Reciclagem (Fechamento)',                    unidade:'BRL', apenasPago:true, cotado:c=>null },
    { id:'despesas_baixa_patio_venda',label:'Despesas Baixa Pátio (Venda/Devolução)',    unidade:'BRL', apenasPago:true, cotado:c=>null },
    { id:'dif_seguro',                label:'Diferença de Seguro',                       unidade:'BRL', apenasPago:true, cotado:c=>null },
    { id:'timp',                      label:'Timp',                                      unidade:'BRL', apenasPago:true, cotado:c=>null },
    { id:'trademaster',               label:'Trademaster',                               unidade:'BRL', apenasPago:true, cotado:c=>null },
  ]},
];

function custosReaisItensFlat(){
  return CUSTOS_REAIS_CONFIG.flatMap(g => g.itens.map(it => ({...it, grupo:g.grupo})));
}

// ── MULTI-MOEDA + QUEBRA POR CONTAINER (Pago × Cobrado por taxa) ──────
// Igual à tela de Taxas do Conexos: cada taxa pode ter Pago e Cobrado em
// moedas diferentes (BRL/USD/EUR, cada lado com sua própria moeda — ex.:
// paga o representante em BRL, recebe do importador em USD), e quando o
// processo tem mais de um container, cada taxa "porContainer" pode ser
// detalhada container a container em vez de um valor único pro processo
// inteiro. Formato salvo em real_json[item.id] (e o mesmo com sufixo
// "_cobrado"), aceita 3 formatos pra manter compatibilidade com dados já
// salvos antes dessa mudança:
//   número puro            → legado: valor na moeda padrão do item (unidade)
//   { valor, moeda }       → valor único, moeda escolhida pelo usuário
//   { porContainer:{ 'CONTAINER1':{valor,moeda}, ... } } → detalhado
const MOEDAS_REAIS = [
  { code:'BRL', simbolo:'R$' },
  { code:'USD', simbolo:'US$' },
  { code:'EUR', simbolo:'€' },
];

// Câmbio de uma moeda em relação a R$ pra este processo. USD usa a mesma
// coluna já existente (p.real_cambio, com fallback pro câmbio da PI); EUR
// não tem coluna própria — pra não precisar de migration nova, fica salvo
// dentro do próprio real_json (_cambio_eur), com fallback pro câmbio do dia
// (_cambio.EUR, já buscado no boot pra barra do topo).
function taxaCambioMoedaReal(moeda, p){
  if(moeda === 'BRL') return 1;
  if(moeda === 'USD'){
    return parseFloat(p.real_cambio) || parseFloat(p.pi_cambio) || (typeof _cambio !== 'undefined' ? _cambio.USD : null) || null;
  }
  if(moeda === 'EUR'){
    const salvo = p.real_json && parseFloat(p.real_json._cambio_eur);
    return (salvo && !isNaN(salvo) ? salvo : null) || (typeof _cambio !== 'undefined' ? _cambio.EUR : null) || null;
  }
  return null;
}

// Lista de containers do processo — usada só pra oferecer o detalhamento
// por container nas taxas "porContainer". Sem containers cadastrados (ou só
// 1), a taxa fica como valor único, sem opção de detalhar.
//
// Fonte da verdade: p.containers_json, o MESMO campo preenchido na tela
// "+ Adicionar Container" da aba Documentos (ver controle-campos.js,
// renderMultiContainers/sincronizarContainerLegado) — array de
// {numero, tipo, lacre}. Antes esta função lia p.container (o campo texto
// legado, que só guarda o número do PRIMEIRO container, sincronizado
// automaticamente a partir de containers_json) — por isso processos com
// mais de um container apareciam com só 1 na aba Custos Reais. Mantém
// fallback pro campo legado só pra processos antigos que nunca chegaram a
// usar a tela de multi-container (containers_json ainda vazio).
function containersDoProcesso(p){
  if(!p) return [];
  if(p.containers_json){
    try{
      const lista = JSON.parse(p.containers_json);
      if(Array.isArray(lista)){
        const numeros = lista.map(c => (c && c.numero || '').trim()).filter(Boolean);
        if(numeros.length) return numeros;
      }
    }catch(e){ /* containers_json inválido — cai no fallback abaixo */ }
  }
  if(!p.container) return [];
  return String(p.container).split(/[,;\n]+/).map(s=>s.trim()).filter(Boolean);
}

// Converte o valor bruto salvo em real_json[item.id] (nos 3 formatos
// possíveis, ver comentário acima) pro total em R$ desse item. Retorna
// null quando não há nada lançado.
function normalizarValorRealItem(raw, item, p){
  if(raw == null || raw === '') return null;
  if(typeof raw === 'object'){
    if(raw.porContainer && typeof raw.porContainer === 'object'){
      let totalBrl = 0, count = 0;
      Object.values(raw.porContainer).forEach(entry => {
        if(!entry || entry.valor == null || entry.valor === '') return;
        const valor = parseFloat(entry.valor);
        if(isNaN(valor)) return;
        const moeda = entry.moeda || item.unidade;
        const cambio = taxaCambioMoedaReal(moeda, p);
        totalBrl += moeda === 'BRL' ? valor : valor * (cambio || 0);
        count++;
      });
      if(count === 0) return null;
      return { totalBrl, count, porContainer:true };
    }
    if(raw.valor != null && raw.valor !== ''){
      const valor = parseFloat(raw.valor);
      if(isNaN(valor)) return null;
      const moeda = raw.moeda || item.unidade;
      const cambio = taxaCambioMoedaReal(moeda, p);
      return { totalBrl: moeda === 'BRL' ? valor : valor * (cambio || 0), count:1, moeda };
    }
    return null;
  }
  // legado: número (ou string numérica) puro, sem objeto {valor,moeda} — só
  // existe em processos criados ANTES do multi-moeda (task #159). Usa
  // unidadeLegado quando existe (itens que mudaram de padrão USD->BRL nesta
  // correção — ver comentário no topo de CUSTOS_REAIS_CONFIG) pra não
  // reinterpretar retroativamente valores antigos que foram salvos em USD
  // como se já fossem BRL. Itens que sempre foram BRL não têm
  // unidadeLegado, então caem direto em item.unidade (sem mudança).
  const unidadeParaLegado = item.unidadeLegado || item.unidade;
  const valor = parseFloat(raw);
  if(isNaN(valor)) return null;
  const cambio = taxaCambioMoedaReal(unidadeParaLegado, p);
  return { totalBrl: unidadeParaLegado === 'BRL' ? valor : valor * (cambio || 0), count:1, moeda:unidadeParaLegado };
}

// Valor COTADO de um item, já no TOTAL do processo (multiplicado pelos
// containers quando for porContainer) — usado só pra pré-preencher/mostrar
// como referência na aba Custos Reais, nunca entra direto no cálculo do
// lucro real (ver calcularCustoRealTotal, que só olha p.real_json).
function calcularCustoCotadoItem(item, cotado){
  if(!cotado) return null;
  const base = item.cotado(cotado);
  if(base == null) return null;
  return item.porContainer ? base * (cotado.containers || 1) : base;
}

// Soma tudo que estiver preenchido em p.real_json (valores TOTAIS, já
// digitados pelo usuário na aba Custos Reais — sem fallback automático pro
// cotado aqui; o fallback acontece só visualmente, pré-preenchendo o campo
// quando a aba abre). Itens em USD convertem pelo câmbio salvo em
// p.real_cambio ou, na falta dele, pelo câmbio da PI do processo. Retorna
// null quando não há NENHUM custo real lançado ainda — nesse caso
// calcularFechamento() cai no cálculo antigo (NF Saída − NF Entrada),
// preservando o comportamento de processos que nunca abriram essa aba.
function calcularCustoRealTotal(p){
  const reais = p.real_json;
  if(!reais || typeof reais !== 'object') return null;
  const cambio = parseFloat(p.real_cambio) || parseFloat(p.pi_cambio) || null;
  let total = 0, count = 0;
  const detalhe = [];
  custosReaisItensFlat().forEach(item => {
    const norm = normalizarValorRealItem(reais[item.id], item, p);
    if(!norm) return;
    // excluirDosTotais (Taxa C.E./CE Mercante) e temCredito (IPI/PIS/COFINS/
    // ICMS/IBS/CBS pagos na entrada, recuperaveis) ficam FORA do Custo do
    // Processo - continuam lancados/visiveis na aba, so nao entram na soma
    // (a pedido do usuario: "Custo do processo tem que ser todo o custo,
    // exceto o que tem de credito de imposto").
    const excluido = !!(item.excluirDosTotais || item.temCredito);
    if(!excluido){ total += norm.totalBrl; count++; }
    detalhe.push({ id:item.id, label:item.label, grupo:item.grupo, unidade:item.unidade, valorBrl:norm.totalBrl, porContainer:!!norm.porContainer, excluidoDoTotal:excluido });
  });
  if(detalhe.length === 0) return null;
  return { total, detalhe, cambio, count };
}

// Espelha calcularCustoRealTotal, mas soma o que foi COBRADO DO CLIENTE por
// item (não o que foi pago ao fornecedor/agente) — guardado nas mesmas
// chaves de real_json, com sufixo "_cobrado" (ex.: reais.siscomex = pago,
// reais.siscomex_cobrado = cobrado). Isso dá pra ver a margem de CADA taxa
// individualmente (compra × venda), igual ao Conexos mostra na aba Taxas —
// não só o total do processo (NF Saída − Custo Real Total).
function calcularReceitaRealTotal(p){
  const reais = p.real_json;
  if(!reais || typeof reais !== 'object') return null;
  const cambio = parseFloat(p.real_cambio) || parseFloat(p.pi_cambio) || null;
  let total = 0, count = 0;
  const detalhe = [];
  custosReaisItensFlat().forEach(item => {
    const norm = normalizarValorRealItem(reais[item.id+'_cobrado'], item, p);
    if(!norm) return;
    const excluido = !!item.excluirDosTotais; // Taxa C.E./CE Mercante - nem custo nem receita
    if(!excluido){ total += norm.totalBrl; count++; }
    detalhe.push({ id:item.id, label:item.label, grupo:item.grupo, unidade:item.unidade, valorBrl:norm.totalBrl, porContainer:!!norm.porContainer, excluidoDoTotal:excluido });
  });
  if(detalhe.length === 0) return null;
  return { total, detalhe, cambio, count };
}

// Totalizador por etapa (Pago/Cobrado/Margem), agrupado igual a aba Custos
// Reais e a planilha de fechamento (MODELO COM S.T) - mostra rapido quanto
// saiu/entrou em cada bloco (Compra e Frete, Impostos, Comissoes, Taxas)
// sem precisar somar item a item na mao. Aceita tanto p.real_json salvo
// quanto um snapshot provisorio (mesmo objeto usado por
// atualizarTotalCustosReais em controle-modal.js, pra recalcular ao vivo
// enquanto o usuario digita). Em "Impostos de Importacao" o total de Pago
// conta so os itens SEM credito (II e Antidumping) - ver temCredito no
// CUSTOS_REAIS_CONFIG; os demais (IPI, PIS, COFINS, ICMS, IBS, CBS) tem
// credito tributario recuperavel, entao ficam fora daqui tambem (mesma
// regra do Custo do Processo, calcularCustoRealTotal). Taxa C.E./CE
// Mercante (excluirDosTotais) tambem fica de fora - nao e custo nem
// receita, so referencia pra base de calculo do imposto.
function calcularTotalizadorPorGrupo(p){
  const reais = p.real_json;
  if(!reais || typeof reais !== 'object') return null;
  return CUSTOS_REAIS_CONFIG.map(g => {
    let totalPago = 0, totalCobrado = 0, totalPagoCobravel = 0, totalCredito = 0, temPago = false, temCobrado = false;
    const apenasPago = g.itens.every(it => it.apenasPago);
    g.itens.forEach(item => {
      if(item.excluirDosTotais || item.temCredito) return;
      const normPago = normalizarValorRealItem(reais[item.id], item, p);
      if(normPago){ totalPago += normPago.totalBrl; temPago = true; if(item.apenasPago) totalCredito += normPago.totalBrl; else totalPagoCobravel += normPago.totalBrl; }
      if(!item.apenasPago){
        const normCobrado = normalizarValorRealItem(reais[item.id+'_cobrado'], item, p);
        if(normCobrado){ totalCobrado += normCobrado.totalBrl; temCobrado = true; }
      }
    });
    return {
      grupo: g.grupo, slug: g.slug,
      totalPago, totalCobrado, totalCredito,
      margem: (!apenasPago && temCobrado) ? (totalCobrado - totalPagoCobravel) : null,
      temPago, temCobrado, apenasPago,
    };
  });
}

// Sub-livro "Notas Fiscais BOSS" (aba Fechamento da planilha, linhas 46-56) -
// quando o processo tambem fatura por uma segunda nota fiscal ("Boss",
// separada da NF de Saida principal ja rastreada em nf_saida_valor/
// vendas_json), essa nota paga seu proprio conjunto de impostos (retencao de
// IR, ISS, PIS, COFINS, IRPJ, CSLL, IBS, CBS) e o que sobra depois disso
// (G56 na planilha, "Total a RECEBER") se soma ao Lucro Bruto do Processo
// pra chegar no resultado final (G58 = G44 + G56). Diferente das
// "Diferencas de Impostos" (grupo apenasPago em CUSTOS_REAIS_CONFIG), aqui
// os percentuais sao fixos (nao dependem de UF/VLOOKUP), entao da pra
// automatizar a conta inteira em vez de pedir pro usuario digitar cada
// imposto na mao - o unico input manual e o valor total das notas Boss.
// Lancado em real_json.notas_boss_valor (mesma "gaveta" JSONB dos demais
// custos reais, sem precisar de coluna/migration nova). Retorna null quando
// o campo nunca foi preenchido - processo sem nota Boss continua exatamente
// como antes (Lucro Real = so a NF Saida principal).
function valorRealItemBRL(p, id){
  const reais = p.real_json || {};
  const item = custosReaisItensFlat().find(it => it.id === id);
  if(!item) return 0;
  const norm = normalizarValorRealItem(reais[id], item, p);
  return norm ? norm.totalBrl : 0;
}

// DRE (Demonstrativo de Resultado) do processo — reagrupa os MESMOS
// lancamentos ja feitos na aba Custos Reais (real_json) no layout usado
// internamente antes do Controle existir (planilha "IA - <referencia>"):
// FOB / Adiantamento Porto (impostos+taxas de liberacao) / Agente Frete
// (frete internacional+taxas do agente de carga) / Diferencas de Impostos
// (NFe x D.I.), com o mesmo Total de Custos e Lucro Bruto que ja aparecem
// na aba Fechamento (calcularCustoRealTotal) — nao introduz nenhuma conta
// nova, so reorganiza a apresentacao pro formato que a empresa ja usava.
function montarDRE(p){
  const v = id => valorRealItemBRL(p, id);

  const adiantamentoItens = [
    { label:'II',                      valor:v('ii') },
    { label:'IPI',                     valor:v('ipi') },
    { label:'PIS',                     valor:v('pis') },
    { label:'COFINS',                  valor:v('cofins') },
    { label:'Taxa Siscomex',           valor:v('siscomex') },
    { label:'Marinha Mercante/AFRMM',  valor:v('marinha') },
    { label:'ICMS',                    valor:v('icms') },
    { label:'Armazenagem',             valor:v('armazenagem') },
  ];
  const agenteFreteItens = [
    { label:'Frete Internacional',              valor:v('frete') },
    { label:'Capatazia/THC',                     valor:v('capatazia') },
    { label:'Liberação BL',                      valor:v('liberacao_bl') },
    { label:'Additional Costs',                  valor:v('additional_costs') },
    { label:'Import Logistics Fee',              valor:v('import_logistics') },
    { label:'Drop Off Fee',                      valor:v('drop_off') },
    { label:'ISPS (Destination)',                valor:v('isps') },
    { label:'IOF',                               valor:v('iof') },
    { label:'Desconsolidação',                   valor:v('desconsolidacao') },
    { label:'Taxa Agente de Carga (IR/PCC/ISS)', valor:v('agente') },
  ];
  const par = (label, idPago, idDif) => {
    const credito = v(idPago), diferenca = v(idDif);
    return { label, valorNfe: credito+diferenca, creditoEntrada: credito, diferenca };
  };
  const diferencasItens = [
    par('Diferença PIS (NFe × D.I.)', 'pis', 'diferenca_pis'),
    par('Diferença COFINS (NFe × D.I.)', 'cofins', 'diferenca_cofins'),
    par('Diferença IPI (NFe × D.I.)', 'ipi', 'diferenca_ipi'),
    par('Diferença ICMS Próprio (NFe × D.I.)', 'icms', 'diferenca_icms_proprio'),
    { label:'ICMS Substituição Tributária', valorNfe:v('icms_st'), creditoEntrada:0, diferenca:v('icms_st') },
    par('IBS', 'ibs', 'diferenca_ibs'),
    par('CBS', 'cbs', 'diferenca_cbs'),
  ];

  const fob = v('fob');
  const totalAdiantamento = adiantamentoItens.reduce((s,i)=>s+i.valor,0);
  const totalAgenteFrete = agenteFreteItens.reduce((s,i)=>s+i.valor,0);
  // Reciclagem/Comissão/Despesas Baixa Pátio — pedido do Ayslan (08/09/2026,
  // exemplo DRE_KS260507SMBZIMP): faltavam essas 3 linhas no DRE mesmo já
  // entrando no Total de Custos (custoReal.total, que soma o real_json
  // inteiro) — sem elas a soma visível das linhas do DRE não batia com o
  // TOTAL CUSTOS mostrado embaixo. "Comissão" no exemplo é uma linha só
  // (Comissão BR + Comissão China somadas; Comissão Boss fica na seção
  // separada de Notas Boss, mais abaixo).
  const reciclagem = v('reciclagem');
  // Comissao: cada tipo separado por linha (nao soma tudo numa unica linha
  // "Comissao") - pedido do Ayslan (08/09/2026): se tiver Comissao
  // Vendedor, Comissao China, Comissao Boss ou qualquer outra, cada uma
  // precisa aparecer na sua propria linha no DRE, igual ao exemplo que ele
  // mandou (Comissao BR e Comissao China ja vinham em linhas separadas na
  // planilha modelo).
  const comissaoItens = [
    { label:'Comissão BR (Representante)', valor:v('comissao_br') },
    { label:'Comissão China',              valor:v('comissao_china') },
    { label:'Comissão Vendedor',           valor:v('comissao_vendedor') },
    { label:'Comissão Boss/Lopes',         valor:v('comissao_boss') },
  ];
  const comissao = comissaoItens.reduce((s,i)=>s+i.valor,0);
  const despesasBaixaPatio = v('custos_diversos');
  const lavacao = v('lavacao');
  const seguro = v('seguro');

  // Total de Custos vem da MESMA fonte que a aba Fechamento (Custo Real
  // Total) — garante que o DRE nunca diverge do que ja aparece la, mesmo
  // que a soma manual acima (fallback) arredonde diferente.
  const custoReal = calcularCustoRealTotal(p);
  const totalCustos = custoReal ? custoReal.total :
    (fob + totalAdiantamento + totalAgenteFrete + reciclagem + comissao + despesasBaixaPatio + lavacao + seguro +
     diferencasItens.filter(d=>d.label!=='IBS' && d.label!=='CBS').reduce((s,d)=>s+d.diferenca,0));

  // Receita e Notas Boss vem do MESMO cálculo da aba Fechamento
  // (calcularFechamento) — já cobre NF Saída única ou soma de vendas
  // multi-cliente (vendasResumo), Juros Cobrado do Cliente (linha à parte,
  // igual à planilha G13/G15) e o sub-livro Notas Fiscais BOSS. Pedido do
  // Ayslan (08/09/2026): o DRE precisa ter os mesmos 2 estágios de Lucro
  // Bruto que a planilha tem — "do PROCESSO - IMPAK" (antes da nota Boss)
  // e "do PROCESSO" (final, depois de somar a nota Boss) — em vez de um
  // Lucro Bruto único que pulava a NF Boss.
  const fechamento = calcularFechamento(p);
  const nfSaidaValor = fechamento.nfSaida;
  const jurosCobrado = fechamento.jurosCobrado;
  const totalReceita = (nfSaidaValor||0) + (jurosCobrado ? jurosCobrado.valor : 0);

  const lucroBrutoImpak = nfSaidaValor != null ? (totalReceita - totalCustos) : null;
  const pctLucroBrutoImpak = (lucroBrutoImpak != null && totalReceita) ? (lucroBrutoImpak/totalReceita) : null;

  const notasBoss = fechamento.notasBoss;
  const lucroBruto = (lucroBrutoImpak != null && notasBoss) ? (lucroBrutoImpak + notasBoss.totalReceber) : lucroBrutoImpak;
  const denomFinal = totalReceita + (notasBoss ? notasBoss.valorBoss : 0);
  const pctLucro = (lucroBruto != null && denomFinal) ? (lucroBruto/denomFinal) : null;

  // Numero da NF de Saida: nao usa mais o campo legado p.nf_saida_numero
  // direto (fica parado/desatualizado quando o processo usa a aba Vendas -
  // era esse o motivo do numero "fixo" que o Ayslan reportou, ex: 8609 no
  // KS260507SMBZIMP mesmo depois de mudar a venda) - pedido do Ayslan
  // (08/09/2026): puxar sempre do sistema. Com vendas cadastradas, junta o
  // numero de cada venda (cada uma tem seu proprio campo nf_saida_numero);
  // sem vendas, cai no campo legado do processo (fluxo antigo).
  const nfSaidaNumero = fechamento.vendasResumo
    ? fechamento.vendasResumo.linhas.map(l => l.venda.nf_saida_numero).filter(Boolean).join(', ')
    : (p.nf_saida_numero || '');

  return {
    referencia: p.referencia || '',
    nfSaidaNumero,
    nfSaidaValor, jurosCobrado, totalReceita,
    fob, adiantamentoItens, totalAdiantamento,
    agenteFreteItens, totalAgenteFrete,
    diferencasItens, reciclagem, comissaoItens, comissao, despesasBaixaPatio, lavacao, seguro,
    totalCustos,
    lucroBrutoImpak, pctLucroBrutoImpak,
    notasBoss,
    lucroBruto, pctLucro,
  };
}

function calcularNotasBoss(p){
  const reais = p.real_json;
  if(!reais || typeof reais !== 'object') return null;
  const valorBoss = parseFloat(reais.notas_boss_valor);
  if(isNaN(valorBoss) || valorBoss <= 0) return null;
  const irRetido = valorBoss * 0.015;           // G47: IR - Retido (1,5%)
  const iss = valorBoss * 0.025;                // G48: ISS (2,5%)
  const pis = valorBoss * 0.0065;                // G49: PIS (0,65%)
  const cofins = valorBoss * 0.03;               // G50: COFINS (3%)
  const baseImpostosLopes = valorBoss * 0.32;    // G51: BASE Impostos Lopes (32%)
  const irpj = baseImpostosLopes * 0.25 - irRetido; // G52: IRPJ 15%+10% adicional, deduzido do IR retido
  const csll = baseImpostosLopes * 0.09;         // G53: CSLL (9%)
  const ibs = valorBoss * 0.001;                 // G54: IBS (0,1%)
  const cbs = valorBoss * 0.009;                 // G55: CBS (0,9%)
  // G56: Total a RECEBER - igual a planilha, IBS/CBS ficam de fora dessa
  // conta (mesma logica de excluirDosTotais aplicada ao Custo do Processo).
  const totalReceber = valorBoss - iss - pis - cofins - irpj - csll - irRetido;
  return { valorBoss, irRetido, iss, pis, cofins, baseImpostosLopes, irpj, csll, ibs, cbs, totalReceber };
}

// Juros cobrado do cliente (parcelamento/financiamento) — receita ADICIONAL
// à NF Saída principal quando o processo cobra juro à parte (G13 na aba
// Fechamento da planilha, somado a G12=NF Saída pra formar G15=TOTAL;
// pedido Jean/Emanuelly 03/09/2026, processo KS260507SMBZIMP). Os custos
// operacionais desse juro (PIS 0,65% + COFINS 4%, segundo o próprio Jean)
// já entram pelo lado do CUSTO — o usuário soma esse valor manualmente em
// diferenca_pis/diferenca_cofins (grupo "Diferenças de Impostos", ver
// CUSTOS_REAIS_CONFIG), exatamente como a planilha já faz nas linhas
// G24/G25 ("Diferença PIS/COFINS + JUROS", já combinadas). Esta função só
// captura o lado da RECEITA — o valor do juro em si.
function calcularJurosCobrado(p){
  const reais = p.real_json;
  if(!reais || typeof reais !== 'object') return null;
  const valor = parseFloat(reais.juros_valor);
  if(isNaN(valor) || valor <= 0) return null;
  return { valor };
}

// Juros por VENDA/NF — pedido do Ayslan (03/09/2026): quando o processo tem
// mais de uma venda (vendas_json), cada uma pode ter cobrado um juro
// diferente do cliente, então o valor precisa ser lançado por venda (ver
// campo venda.juros_valor em controle-campos.js), não mais um único valor
// pro processo inteiro. Pra não quebrar processos já preenchidos com o
// campo antigo (real_json.juros_valor, ver calcularJurosCobrado acima) —
// como o KS260507SMBZIMP, que tem só 1 venda — quando a venda não tem seu
// próprio juros_valor E é a ÚNICA venda do processo, cai no valor antigo.
function calcularJurosVenda(p, venda, qtdVendas){
  const proprio = parseFloat(venda && venda.juros_valor);
  if(!isNaN(proprio) && proprio > 0) return proprio;
  if(qtdVendas === 1){
    const antigo = calcularJurosCobrado(p);
    if(antigo) return antigo.valor;
  }
  return 0;
}

// ── VENDAS MULTI-CLIENTE (rateio de custo) ────────────────────────
// Um processo (de qualquer finalidade) pode ser vendido a mais de um
// cliente — ex.: meio contêiner pra um, meio pra outro. p.vendas_json guarda
// um array de vendas, cada uma com seu próprio cliente, NF Saída e a
// quantidade que levou de cada item. Quando existe pelo menos uma venda
// cadastrada, o Lucro Real deixa de ser um número único do processo (NF
// Saída − Custo Real Total) e passa a ser calculado VENDA A VENDA: cada
// custo real lançado na aba Custos Reais é rateado proporcionalmente à
// quantidade que aquela venda levou (sobre a quantidade total de produtos do
// processo, ver totalQuantidadeProdutos), e alguns custos podem ser
// lançados DIRETO numa venda específica (custos_diretos), sem entrar no
// rateio — ex.: um frete rodoviário que só existiu porque aquele cliente
// pediu entrega em outra cidade.
// Sem nenhuma venda cadastrada (vendas_json vazio/null), calcularFechamento
// continua exatamente como antes — 100% retrocompatível com todo processo
// já cadastrado.

// Soma a quantidade de todos os itens em produtos_json — é o "tamanho
// total" do processo (ex.: 1400 pneus), denominador do rateio.
function totalQuantidadeProdutos(p){
  if(!p || !p.produtos_json) return 0;
  try{
    const produtos = JSON.parse(p.produtos_json);
    if(!Array.isArray(produtos)) return 0;
    return produtos.reduce((s,it)=> s + (parseFloat(it.quantidade)||0), 0);
  }catch(e){ return 0; }
}

// Lê e normaliza p.vendas_json — nunca lança, sempre devolve array (vazio
// se não houver nada salvo ou o JSON estiver corrompido).
function parseVendas(p){
  if(!p || !p.vendas_json) return [];
  try{
    const vendas = JSON.parse(p.vendas_json);
    return Array.isArray(vendas) ? vendas : [];
  }catch(e){ return []; }
}
function clientesDoProcesso(p){
const nomes = new Set();
if(p && p.cliente) nomes.add(p.cliente);
parseVendas(p).forEach(v=>{ if(v && v.cliente) nomes.add(v.cliente); });
return [...nomes];
}


// Quantidade total alocada pra uma venda (soma de todos os itens dela).
function quantidadeVenda(venda){
  return (venda.itens||[]).reduce((s,it)=> s + (parseFloat(it.quantidade)||0), 0);
}

// Soma dos custos diretos (não-rateados) de uma venda — cada um já é um
// valor TOTAL em R$, lançado manualmente (ex.: "Frete Rodoviário Extra").
function custosDiretosVenda(venda){
  return (venda.custos_diretos||[]).reduce((s,c)=> s + (parseFloat(c.valor)||0), 0);
}

// Rateia o Custo Real Total do processo por uma venda específica,
// proporcional à quantidade que ela levou, e soma os custos diretos dela
// por cima (esses não são rateados — são só dessa venda).
function calcularRateioVenda(p, venda, custoRealTotal){
  const totalQtd = totalQuantidadeProdutos(p);
  const qtdVenda = quantidadeVenda(venda);
  const fracao = totalQtd > 0 ? (qtdVenda / totalQtd) : 0;
  const custoRateado = (custoRealTotal||0) * fracao;
  const custoDireto = custosDiretosVenda(venda);
  return { totalQtd, qtdVenda, fracao, custoRateado, custoDireto, custoTotal: custoRateado + custoDireto };
}

// Lucro de uma venda específica: NF Saída DELA (não do processo) − a fatia
// de custo que lhe cabe (rateado + direto). null quando a venda ainda não
// tem NF Saída lançada (mesma convenção do Lucro Real do processo inteiro).
function calcularLucroVenda(p, venda, custoRealTotal){
  const rateio = calcularRateioVenda(p, venda, custoRealTotal);
  const nfSaida = parseFloat(venda.nf_saida_valor);
  const temNf = !isNaN(nfSaida) && nfSaida > 0;
  const lucro = temNf ? (nfSaida - rateio.custoTotal) : null;
  const pctLucro = (temNf && lucro != null && nfSaida > 0) ? (lucro / nfSaida) : null;
  return { ...rateio, nfSaida: temNf?nfSaida:null, temNf, lucro, pctLucro };
}

// Prazo negociado de uma venda (pedido do Jean/Ayslan, 03/09/2026): À Vista
// ou A Prazo (N dias, sempre contados a partir da Data NF Saída — não da
// data de embarque, diferente do prazo de pagamento da PI de compra que já
// existe em pi_prazo_dias). Retorna null quando a venda não tem forma de
// pagamento definida ainda (vendas antigas, criadas antes deste campo
// existir) — nesse caso a tela de Fechamento simplesmente não mostra nada,
// sem quebrar.
function calcularVencimentoVenda(venda){
  if(!venda || !venda.forma_pagamento) return null;
  if(venda.forma_pagamento === 'avista'){
    return { formaPagamento: 'avista', texto: null };
  }
  if(venda.forma_pagamento === 'prazo'){
    return { formaPagamento: 'prazo', texto: (venda.prazo_texto||'').trim() };
  }
  // Compat: registros antigos gravados enquanto o campo ainda era estruturado
  // (dias/parcelas) — nunca chegou a ir pra produção, mas mantém a leitura
  // segura em vez de sumir com o dado caso algum registro exista.
  if(venda.forma_pagamento === 'aprazo'){
    const dias = parseInt(venda.prazo_dias, 10);
    return { formaPagamento: 'prazo', texto: isNaN(dias) ? '' : `${dias} dias` };
  }
  if(venda.forma_pagamento === 'parcelado' && Array.isArray(venda.parcelas)){
    const texto = venda.parcelas.map(pc => `${pc.dias||'?'}d (${pc.percentual||'?'}%)`).join(' · ');
    return { formaPagamento: 'prazo', texto };
  }
  return null;
}

// Ajusta uma lista de valores fracionários (em R$) que deveriam somar
// "totalAlvo" pra somarem EXATAMENTE isso até o centavo — método do maior
// resto (largest remainder / Hamilton), o mesmo usado pra distribuir
// cadeiras em sistemas proporcionais. Sem isso, ratear R$100.000,00 em 3
// partes de 33.333,33... e converter cada uma pra centavos pode deixar 1-2
// centavos "perdidos" ou "sobrando" que nunca aparecem em lugar nenhum —
// pequeno, mas incomoda numa tela financeira onde a soma devia bater exato.
function arredondarComRestoExato(valores, totalAlvo){
  const totalCentavosAlvo = Math.round((totalAlvo||0) * 100);
  const centavosBase = valores.map(v => Math.floor((v||0) * 100));
  const somaBase = centavosBase.reduce((s,c)=> s+c, 0);
  let restante = totalCentavosAlvo - somaBase;
  // Distribui o restante (positivo ou negativo) 1 centavo de cada vez,
  // priorizando quem tem a maior parte fracionária "perdida" no floor.
  const ordem = valores
    .map((v,i)=>({ i, frac: (v||0)*100 - Math.floor((v||0)*100) }))
    .sort((a,b)=> b.frac - a.frac);
  const resultado = [...centavosBase];
  for(let k=0; k<ordem.length && restante>0; k++){ resultado[ordem[k].i] += 1; restante--; }
  for(let k=ordem.length-1; k>=0 && restante<0; k--){ resultado[ordem[k].i] -= 1; restante++; }
  return resultado.map(c => c/100);
}

// Resumo agregado de todas as vendas de um processo — null quando não há
// nenhuma venda cadastrada (processo continua no modelo antigo, 1 NF Saída
// única pro processo inteiro).
function itensFaltantesVenda(p){
  if(!p || !p.produtos_json) return [];
  try{
    const produtos = JSON.parse(p.produtos_json);
    if(!Array.isArray(produtos)) return [];
    const norm = s => String(s||'').trim().toUpperCase().replace(/\s+/g,' ');
    const totais = {};
    const labels = {};
    produtos.forEach(it => {
      if(!it || !it.descricao) return;
      const k = norm(it.descricao);
      if(!k) return;
      totais[k] = (totais[k]||0) + (parseFloat(it.quantidade)||0);
      if(!labels[k]) labels[k] = it.descricao;
    });
    const vendas = parseVendas(p);
    vendas.forEach(venda => {
      (venda.itens||[]).forEach(it => {
        if(!it || !it.descricao) return;
        const k = norm(it.descricao);
        if(!(k in totais)) return;
        totais[k] -= (parseFloat(it.quantidade)||0);
      });
    });
    return Object.keys(totais)
      .map(k => ({ descricao: labels[k], quantidade: totais[k] }))
      .filter(x => x.quantidade > 0.009)
      .sort((a,b) => b.quantidade - a.quantidade);
  }catch(e){ return []; }
}

function calcularVendasResumo(p){
  const vendas = parseVendas(p);
  if(!vendas.length) return null;
  const custosReais = calcularCustoRealTotal(p);
  const custoRealTotal = custosReais ? custosReais.total : 0;
  let linhas = vendas.map(venda => ({ venda, ...calcularLucroVenda(p, venda, custoRealTotal) }));
  const totalQtd = totalQuantidadeProdutos(p);
  const qtdAlocada = linhas.reduce((s,l)=> s + l.qtdVenda, 0);

  // Correção de arredondamento (maior resto): só faz sentido quando o
  // processo está 100% alocado entre as vendas (senão a soma parcial dos
  // custos rateados É o comportamento correto — ver saldoNaoAlocado) e
  // quando há mais de 1 venda (com 1 venda só não existe erro de soma pra
  // corrigir). Recalcula custoTotal/lucro/pctLucro de cada linha em cima
  // do custoRateado ajustado.
  if(totalQtd > 0 && qtdAlocada === totalQtd && custoRealTotal > 0 && linhas.length > 1){
    const ajustados = arredondarComRestoExato(linhas.map(l=>l.custoRateado), custoRealTotal);
    linhas = linhas.map((l,i) => {
      const custoRateado = ajustados[i];
      const custoTotal = custoRateado + l.custoDireto;
      const lucro = l.temNf ? (l.nfSaida - custoTotal) : null;
      const pctLucro = (l.temNf && lucro != null && l.nfSaida > 0) ? (lucro / l.nfSaida) : null;
      return { ...l, custoRateado, custoTotal, lucro, pctLucro };
    });
  }

  const nfSaidaTotal = linhas.reduce((s,l)=> s + (l.temNf?l.nfSaida:0), 0);
  const todasComNf = linhas.length>0 && linhas.every(l=>l.temNf);
  const lucroTotal = todasComNf ? linhas.reduce((s,l)=> s + l.lucro, 0) : null;
  return {
    linhas, custosReais, custoRealTotal, totalQtd, qtdAlocada,
    saldoNaoAlocado: totalQtd - qtdAlocada,
    nfSaidaTotal, todasComNf, lucroTotal,
    itensFaltantes: itensFaltantesVenda(p),
  };
}

function calcularFechamento(p){
  const est = p.estimativa_json || null;
  const nfEntrada = parseFloat(p.nf_entrada_valor);

  // Custo real detalhado (aba "Custos Reais") — quando o processo tem pelo
  // menos um item lançado ali, ele é MAIS PRECISO que o cálculo grosseiro
  // NF Saída − NF Entrada (que ignora frete, seguro, impostos, comissões e
  // taxas operacionais — cada processo tem uma combinação diferente do que
  // teve ou não). Sem nenhum item lançado, mantém o cálculo antigo por NF.
  const custosReais = calcularCustoRealTotal(p);
  const custoRealTotal = custosReais ? custosReais.total : null;
  // Margem por taxa (compra × venda) — só existe quando o usuário também
  // lançou valores "cobrado do cliente" na aba Custos Reais, não é
  // obrigatório preencher. Independente do Lucro Real (que usa a NF Saída
  // inteira); esta é uma visão à parte, item a item, das taxas específicas.
  const receitaReais = calcularReceitaRealTotal(p);
  const margemTaxas = (custosReais && receitaReais)
    ? { total: receitaReais.total - custosReais.total, custoTotal: custosReais.total, receitaTotal: receitaReais.total }
    : null;

  // Vendas multi-cliente (rateio de custo) — quando o processo foi vendido
  // a mais de um cliente (ver calcularVendasResumo acima), o Lucro Real do
  // processo vira a SOMA do lucro de cada venda (NF dela − sua fatia de
  // custo), e a "NF Saída" do processo vira a soma das NFs de cada venda.
  // Sem nenhuma venda cadastrada, cai exatamente no cálculo antigo abaixo.
  const vendasResumo = calcularVendasResumo(p);
  let nfSaida, temReal, lucroReal, pctLucroReal;
  if(vendasResumo){
    nfSaida = vendasResumo.nfSaidaTotal || null;
    temReal = vendasResumo.linhas.some(l=>l.temNf);
    lucroReal = vendasResumo.todasComNf ? vendasResumo.lucroTotal : null;
    pctLucroReal = (lucroReal != null && nfSaida) ? (lucroReal / nfSaida) : null;
  } else {
    const nfSaidaRaw = parseFloat(p.nf_saida_valor);
    temReal = !isNaN(nfSaidaRaw) && nfSaidaRaw > 0;
    nfSaida = isNaN(nfSaidaRaw) ? null : nfSaidaRaw;
    lucroReal = custosReais
      ? (temReal ? (nfSaida - custoRealTotal) : null)
      : (temReal ? (nfSaida - (isNaN(nfEntrada)?0:nfEntrada)) : null);
    pctLucroReal = (temReal && lucroReal != null) ? (lucroReal / nfSaida) : null;
  }

  // Notas Fiscais BOSS (G56 na planilha) - soma ao Lucro Bruto do Processo
  // JA CALCULADO acima (single-NF ou soma das vendas, tanto faz), igual a
  // planilha faz em G58=G44+G56 independente de quantas notas de saida
  // compoem o G44. So mexe quando o usuario de fato lancou o valor da nota
  // Boss (calcularNotasBoss retorna null quando nunca foi preenchido) E ja
  // existe um lucroReal pra ajustar (senao nao ha "Lucro Bruto do Processo"
  // base pra somar). O percentual usa NF Saida + valor Boss no denominador,
  // igual a planilha (H58=G58/(G15+G46)).
  // Juros cobrado do cliente (ver calcularJurosCobrado acima) — soma como
  // receita adicional ANTES do ajuste da Nota Boss, que usa essa receita ja
  // somada ao juro como parte do denominador do percentual (igual a
  // planilha: H58 = G58/(G15+G46), onde G15 ja inclui o juro).
  let jurosCobrado;
  if(vendasResumo){
    const jurosTotal = vendasResumo.linhas.reduce((soma,l) => soma + calcularJurosVenda(p, l.venda, vendasResumo.linhas.length), 0);
    jurosCobrado = jurosTotal > 0 ? { valor: jurosTotal } : null;
  } else {
    jurosCobrado = calcularJurosCobrado(p);
  }
  let receitaTotalReal = nfSaida;
  if(jurosCobrado && lucroReal != null){
    lucroReal = lucroReal + jurosCobrado.valor;
    receitaTotalReal = (nfSaida||0) + jurosCobrado.valor;
    pctLucroReal = receitaTotalReal > 0 ? (lucroReal / receitaTotalReal) : null;
  }

  const notasBoss = calcularNotasBoss(p);
  if(notasBoss && lucroReal != null){
    lucroReal = lucroReal + notasBoss.totalReceber;
    const denomComBoss = receitaTotalReal + notasBoss.valorBoss;
    pctLucroReal = denomComBoss > 0 ? (lucroReal / denomComBoss) : null;
  }

  let custoEstimado = null, faturamentoEstimado = null, lucroEstimado = null, pctLucroEstimado = null;
  if(est){
    custoEstimado = est.custo_total ?? null;
    const cenComSt = est.cenarios && est.cenarios.com_st; if(cenComSt && cenComSt.faturamento_total != null){
      faturamentoEstimado = cenComSt.faturamento_total;
    } else if(est.faturamento != null){
      faturamentoEstimado = est.faturamento; // cotações salvas antes dos 2 cenários
    }
    if(cenComSt && cenComSt.lucro_bruto != null){
      lucroEstimado = cenComSt.lucro_bruto;
      pctLucroEstimado = cenComSt.pct_lucro != null ? cenComSt.pct_lucro / 100 : null;
    } else if(est.lucro_bruto != null){
      lucroEstimado = est.lucro_bruto;
      pctLucroEstimado = est.pct_lucro != null ? est.pct_lucro / 100 : null;
    }
  }

  const temComparacao = temReal && lucroEstimado != null;
  const deltaValor = temComparacao ? (lucroReal - lucroEstimado) : null;
  const deltaPct   = (temComparacao && pctLucroReal != null && pctLucroEstimado != null) ? (pctLucroReal - pctLucroEstimado) : null;

  return {
    temEstimativa: !!est, temReal, temComparacao,
    custoEstimado, faturamentoEstimado, lucroEstimado, pctLucroEstimado,
    nfEntrada: isNaN(nfEntrada)?null:nfEntrada, nfSaida,
    lucroReal, pctLucroReal, deltaValor, deltaPct,
    custosReais, custoRealTotal, // detalhamento por item — null se a aba Custos Reais nunca foi preenchida
    receitaReais, margemTaxas, // margem por taxa (compra × venda) — null se "cobrado do cliente" nunca foi preenchido
    vendasResumo, // null se o processo não foi vendido a mais de um cliente
    notasBoss, // null se real_json.notas_boss_valor nunca foi preenchido — detalhe do sub-livro (IR/ISS/PIS/COFINS/IRPJ/CSLL/IBS/CBS + Total a Receber) já somado a lucroReal/pctLucroReal acima
    jurosCobrado, // null se real_json.juros_valor nunca foi preenchido — já somado a lucroReal/pctLucroReal acima (custo operacional do juro entra à parte, em diferenca_pis/diferenca_cofins)
  };
}

// ─────────────────────────────────────────────────────────────────────────
// FECHAMENTO — layout rico (espelha a aba Fechamento da planilha, porém em
// grid de 2 colunas + cards compactos, sem precisar rolar a página inteira
// pra ver tudo). Três blocos novos abaixo (breakdown itemizado por grupo,
// parcelas/câmbio e timeline) + o renderFechamentoInfo original reorganizado
// num "stat strip" de KPIs no topo e 2 colunas de detalhe embaixo.
// ─────────────────────────────────────────────────────────────────────────

// Itemizado de Custos Reais (Pago x Cobrado x Margem), agrupado igual a
// planilha (Compra e Frete / Impostos de Importação / Comissões / Taxas
// Operacionais / Diferenças de Impostos) — usa os totalizadores que já
// existem (calcularTotalizadorPorGrupo) e o detalhe item a item
// (calcularCustoRealTotal/calcularReceitaRealTotal) só pra montar as linhas.
function renderFechamentoBreakdown(p){
  const totais = calcularTotalizadorPorGrupo(p);
  if(!totais) return '';
  const custoReal = calcularCustoRealTotal(p) || { detalhe: [] };
  const receitaReal = calcularReceitaRealTotal(p) || { detalhe: [] };
  const r2 = v => v==null ? '—' : `R$ ${v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const porGrupoPago = {}, porGrupoCobrado = {};
  (custoReal.detalhe||[]).forEach(it => { (porGrupoPago[it.grupo] = porGrupoPago[it.grupo]||[]).push(it); });
  (receitaReal.detalhe||[]).forEach(it => { (porGrupoCobrado[it.grupo] = porGrupoCobrado[it.grupo]||[]).push(it); });

  const linhasGrupo = totais.filter(g => g.temPago || g.temCobrado).map(g => {
    const itensPago = porGrupoPago[g.grupo] || [];
    const detalheItens = itensPago.map(it => {
      const cobrado = (porGrupoCobrado[g.grupo]||[]).find(c => c.id === it.id);
      return `<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0;color:var(--muted);">
        <span>${esc(it.label)}</span>
        <span style="display:flex;gap:10px;"><span>${r2(it.valorBrl)}</span>${cobrado?`<span style="color:var(--dim);">/ ${r2(cobrado.valorBrl)}</span>`:''}</span>
      </div>`;
    }).join('');
    return `<details style="margin-bottom:6px;">
      <summary style="cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;padding:6px 8px;background:var(--card);border:1px solid var(--border);border-radius:var(--r-sm);font-size:13px;">
        <span style="font-weight:700;color:var(--text);">${esc(g.grupo)}</span>
        <span style="display:flex;gap:12px;align-items:center;">
          <span style="color:var(--muted);">${r2(g.totalPago)}</span>
          ${g.margem!=null?`<strong style="color:${g.margem>=0?'var(--ok)':'var(--err)'};font-size:12px;">${g.margem>=0?'+':''}${r2(g.margem)}</strong>`:''}${g.totalCredito>0?(g.slug==='diferencas'?`<span style="color:var(--err);font-size:11px;" title="Diferenca entre o valor da NF e o credito ja pago na importacao - imposto que ainda falta recolher">Impostos a recolher: ${r2(g.totalCredito)}</span>`:`<span style="color:var(--ok);font-size:11px;" title="Impostos pagos na importacao (IPI/PIS/COFINS/ICMS) que geram credito tributario a compensar - nao e margem/lucro nem prejuizo">Credito impostos: ${r2(g.totalCredito)}</span>`):''}
        </span>
      </summary>
      <div style="padding:6px 10px 2px 10px;">${detalheItens||'<span style="font-size:12px;color:var(--dim);">sem itens lançados</span>'}</div>
    </details>`;
  }).join('');

  return `<div>
    <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:8px;">🧮 Custos Reais — detalhado por grupo</div>
    ${linhasGrupo || '<div style="font-size:13px;color:var(--dim);">Nenhum custo lançado na aba Custos Reais ainda.</div>'}
  </div>`;
}

// Parcelas de pagamento com câmbio fechado (Advance Payment 1, 2, ... —
// linhas 17-20 da planilha Fechamento) — lê do mesmo pi_parcelas_json usado
// no modo "Parcelado" da aba Financeiro.
function renderFechamentoParcelasCambio(p){
  let parcelas = [];
  try{ parcelas = p.pi_parcelas_json ? JSON.parse(p.pi_parcelas_json) : []; }catch(e){ parcelas = []; }
  parcelas = parcelas.filter(pc => parseFloat(pc.valor_usd) > 0);
  if(!parcelas.length) return '';
  const r2 = v => v==null ? '—' : `R$ ${v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const linhas = parcelas.map(pc => {
    const usd = parseFloat(pc.valor_usd)||0;
    const cambio = parseFloat(pc.cambio_fechado)||null;
    const brl = cambio ? usd*cambio : null;
    const data = pc.data_vencimento ? parseDataLocal(pc.data_vencimento).toLocaleDateString('pt-BR') : '—';
    return `<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;border-bottom:1px dashed var(--border);">
      <span style="color:var(--muted);">${esc(pc.label||'Parcela')} <span style="color:var(--dim);">(${data})</span></span>
      <span style="display:flex;gap:10px;"><span>US$ ${usd.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}</span><span style="color:var(--dim);">@ ${cambio?cambio.toFixed(4):'—'}</span><strong>${r2(brl)}</strong></span>
    </div>`;
  }).join('');
  return `<div>
    <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:8px;">💱 Parcelas × Câmbio Fechado</div>
    ${linhas}
  </div>`;
}

// Timeline de datas do processo (Data do Pedido / Embarque / Chegada Porto
// — linhas 60-62 da planilha Fechamento), com o tempo decorrido entre elas.
function renderFechamentoTimeline(p){
  if(!p.pi_data && !p.data_embarque && !p.data_chegada) return '';
  const dias = (a,b) => (a && b) ? Math.round((parseDataLocal(b) - parseDataLocal(a))/86400000) : null;
  const pontos = [
    { label:'Data do Pedido', data:p.pi_data },
    { label:'Embarque', data:p.data_embarque },
    { label:'Chegada Porto', data:p.data_chegada },
  ];
  const rotaDias = dias(p.data_embarque, p.data_chegada);
  const totalDias = dias(p.pi_data, p.data_chegada);
  const linhas = pontos.map(pt => `<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0;">
      <span style="color:var(--muted);">${pt.label}</span>
      <strong style="color:${pt.data?'var(--text)':'var(--dim)'};">${pt.data?parseDataLocal(pt.data).toLocaleDateString('pt-BR'):'—'}</strong>
    </div>`).join('');
  return `<div>
    <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:8px;">📅 Timeline</div>
    ${linhas}
    ${(rotaDias!=null || totalDias!=null) ? `<div style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--border);display:flex;gap:14px;font-size:12px;color:var(--muted);">
      ${rotaDias!=null?`<span>Rota: <strong style="color:var(--text);">${rotaDias}d</strong></span>`:''}
      ${totalDias!=null?`<span>Total: <strong style="color:var(--text);">${totalDias}d</strong> (${(totalDias/30.44).toFixed(1)} meses)</span>`:''}
    </div>` : ''}
  </div>`;
}

function renderFechamentoInfo(p){
  const f = calcularFechamento(p);
  const r2 = v => v==null ? '—' : `R$ ${v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const pct2 = v => v==null ? '—' : `${(v*100).toFixed(1)}%`;
  // % com 2 casas (juros/Boss/venda pedem mais precisão que os outros
  // percentuais da tela, ex: 8,29% de juros — pedido Ayslan 08/09/2026,
  // mesma fórmula da planilha: valor cobrado / NF Saída daquela venda).
  const pctPreciso = v => v==null ? '—' : `${(v*100).toFixed(2)}%`;

  // Antes: sem estimativa_json (processo que não passou pela cotação do
  // Calculador) a função parava aqui e nunca mostrava nada — nem o lucro
  // real, mesmo com NF Entrada e NF Saída já preenchidas na aba Documentos.
  // Ou seja, processo criado direto no Controle nunca tinha como saber a
  // margem, mesmo depois de fechado. Agora só cai nesse aviso quando NÃO
  // há estimativa E também não há NF Saída ainda — nesse caso não tem
  // mesmo nada pra mostrar.
  if(!f.temEstimativa && !f.temReal){
    return `<div style="background:rgba(0,0,0,.03);border:1px solid var(--border);border-radius:10px;padding:16px;text-align:center;color:var(--muted);font-size:13px;">
      Este processo não tem um valor estimado (cotação) nem resultado real (NF Entrada/Saída) vinculado ainda — preencha a NF Entrada e a NF Saída na aba Documentos assim que possível pra ver a margem aqui.
    </div>`;
  }

  // Quando a aba "Custos Reais" tem pelo menos um item lançado, o Lucro Real
  // vem de Faturamento (NF Saída) − Custo Real Total (soma item a item) em
  // vez da conta grosseira NF Saída − NF Entrada — mais preciso porque conta
  // frete, seguro, impostos, comissões e taxas operacionais reais também.
  const linhaCustoRealDetalhado = f.custosReais
    ? `<div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Custo Real Total (${f.custosReais.count} ${f.custosReais.count===1?'item lançado':'itens lançados'})</span><strong>${r2(f.custoRealTotal)}</strong></div>`
    : '';
  // Removido a pedido do usuário (2026-08-25): comparava Cobrado (so
  // itens com campo Cobrado) contra Custo Real Total (que inclui impostos
  // apenasPago, sem Cobrado por desenho) — sempre dava um negativo grande
  // sem relacao com a operacao real, e nao existe na planilha (conferido na
  // aba Fechamento do modelo). f.margemTaxas continua calculado/retornado
  // (usado em teste existente), so nao aparece mais na tela.
  const linhaMargemTaxas = '';
  // Prazo negociado da venda (À Vista / A Prazo + vencimento) — pedido do
  // Ayslan (03/09/2026): mostrar aqui, na tela de Fechamento, sem precisar
  // abrir a aba Vendas de novo pra conferir o combinado com o cliente.
  // Forma de pagamento negociada da venda (À Vista / Prazo) — pedido do
  // Ayslan (03/09/2026): mostrar aqui, na tela de Fechamento, junto do
  // Juros Cobrado, embaixo do bloco "Vendido a N cliente(s)", sem precisar
  // abrir a aba Vendas de novo pra conferir o combinado com o cliente.
  // Cada venda mostra sua PRÓPRIA linha de Forma de Pagamento e (se houver)
  // Juros Cobrado — pedido do Ayslan (03/09/2026): quando o processo tem
  // mais de uma NF/cliente, cada uma precisa aparecer com os seus próprios
  // dados aqui embaixo, não um valor único combinado pro processo inteiro.
  const linhaPrazoJurosRows = f.vendasResumo
    ? f.vendasResumo.linhas.map(l => {
        const multiplas = f.vendasResumo.linhas.length > 1;
        const v = calcularVencimentoVenda(l.venda);
        const linhaPrazo = v
          ? (() => {
              const valor = v.formaPagamento === 'avista' ? 'À Vista' : `Prazo: ${v.texto ? esc(v.texto) : 'não informado'}`;
              const rotulo = multiplas ? `🧾 Forma de Pagamento — ${esc(l.venda.cliente||'(sem cliente)')}` : '🧾 Forma de Pagamento';
              return `<div style="display:flex;justify-content:space-between;font-size:12px;margin-top:4px;"><span style="color:var(--muted);">${rotulo}</span><strong>${valor}</strong></div>`;
            })()
          : '';
        const jurosVenda = calcularJurosVenda(p, l.venda, f.vendasResumo.linhas.length);
        const linhaJurosVenda = jurosVenda > 0
          ? (() => {
              const rotulo = multiplas ? `🧾 Juros Cobrado do Cliente — ${esc(l.venda.cliente||'(sem cliente)')}` : '🧾 Juros Cobrado do Cliente (somado ao Lucro Real)';
              const pctJuros = l.nfSaida ? (jurosVenda / l.nfSaida) : null;
              return `<div style="display:flex;justify-content:space-between;font-size:12px;margin-top:4px;"><span style="color:var(--muted);">${rotulo}</span><strong style="color:var(--ok);">${r2(jurosVenda)} <span style="color:var(--muted);font-weight:400;">(${pctPreciso(pctJuros)})</span></strong></div>`;
            })()
          : '';
        return linhaPrazo + linhaJurosVenda;
      }).join('')
    : '';
  const linhaVendas = f.vendasResumo
    ? `<div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);">
        <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:6px;">🧾 Vendido a ${f.vendasResumo.linhas.length} cliente${f.vendasResumo.linhas.length===1?'':'s'} (ver aba Vendas)</div>
        ${f.vendasResumo.linhas.map(l=>`<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0;"><span style="color:var(--muted);">${esc(l.venda.cliente||'(sem cliente)')} <span style="color:var(--dim);">(${(l.fracao*100).toFixed(1)}% do processo)</span></span><strong style="color:${l.lucro==null?'var(--muted)':l.lucro>=0?'var(--ok)':'var(--err)'}">${l.temNf?`${r2(l.lucro)} <span style="color:var(--muted);font-weight:400;">(${pct2(l.pctLucro)})</span>`:'aguardando NF'}</strong></div>`).join('')}
        ${linhaPrazoJurosRows}
      </div>`
    : '';
  const pctJurosUnico = (f.jurosCobrado && f.nfSaida) ? (f.jurosCobrado.valor / f.nfSaida) : null;
  const linhaJuros = (!f.vendasResumo && f.jurosCobrado)
    ? `<div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);">
        <div style="display:flex;justify-content:space-between;font-size:12px;"><span style="color:var(--muted);">🧾 Juros Cobrado do Cliente (somado ao Lucro Real)</span><strong style="color:var(--ok);">${r2(f.jurosCobrado.valor)} <span style="color:var(--muted);font-weight:400;">(${pctPreciso(pctJurosUnico)})</span></strong></div>
      </div>`
    : '';
  const pctNotasBoss = (f.notasBoss && f.nfSaida) ? (f.notasBoss.valorBoss / f.nfSaida) : null;
  const linhaNotasBoss = f.notasBoss
    ? `<div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);">
        <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:6px;">🧾 Notas Fiscais BOSS</div>
        <div style="display:flex;justify-content:space-between;font-size:12px;"><span style="color:var(--muted);">Valor das Notas Boss</span><strong>${r2(f.notasBoss.valorBoss)} <span style="color:var(--muted);font-weight:400;">(${pctPreciso(pctNotasBoss)})</span></strong></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;"><span style="color:var(--muted);">Impostos (IR+ISS+PIS+COFINS+IRPJ+CSLL)</span><strong style="color:var(--err);">− ${r2(f.notasBoss.irRetido+f.notasBoss.iss+f.notasBoss.pis+f.notasBoss.cofins+f.notasBoss.irpj+f.notasBoss.csll)}</strong></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;"><span style="color:var(--muted);">Total a Receber (somado ao Lucro Real)</span><strong style="color:var(--ok);">${r2(f.notasBoss.totalReceber)}</strong></div>
      </div>`
    : '';
  const rotuloLucroReal = [
    f.custosReais ? 'NF Saída − Custo Real Total' : 'NF Saída − NF Entrada',
    f.jurosCobrado ? '+ Juros' : '',
    f.notasBoss ? '+ Notas Boss' : '',
  ].filter(Boolean).join(' ');
  const linhaReal = f.temReal
    ? `${linhaCustoRealDetalhado}<div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Lucro Real (${rotuloLucroReal})</span><strong>${r2(f.lucroReal)} <span style="color:var(--muted);font-weight:400;">(${pct2(f.pctLucroReal)})</span></strong></div>${linhaJuros}${linhaNotasBoss}`
    : `${linhaCustoRealDetalhado}<div style="color:var(--muted);font-size:13px;">Ainda não há NF Saída lançada — preencha NF Entrada e NF Saída na aba Documentos pra ver o resultado real aqui.</div>`;

  const corDelta = f.deltaValor==null ? 'var(--muted)' : f.deltaValor >= 0 ? 'var(--ok)' : 'var(--err)';
  const linhaDelta = f.temComparacao
    ? `<div style="margin-top:8px;padding:8px 10px;background:${f.deltaValor>=0?'rgba(22,163,74,.08)':'rgba(220,38,38,.08)'};border-radius:8px;font-weight:700;color:${corDelta};display:flex;justify-content:space-between;font-size:13px;">
        <span>${f.deltaValor>=0?'📈 Rendeu a mais que o cotado':'📉 Rendeu a menos que o cotado'}</span>
        <span>${f.deltaValor>=0?'+':''}${r2(f.deltaValor)}</span>
      </div>`
    : '';

  const blocoEstimado = f.temEstimativa
    ? `<div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">📐 Estimado na cotação</div>
    <div style="display:flex;flex-direction:column;gap:4px;font-size:13px;margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Custo Total estimado</span><strong>${r2(f.custoEstimado)}</strong></div>
      <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Faturamento estimado (Com S.T.)</span><strong>${r2(f.faturamentoEstimado)}</strong></div>
      <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:4px;"><span style="color:var(--muted);">Lucro estimado</span><strong>${r2(f.lucroEstimado)} <span style="color:var(--muted);font-weight:400;">(${pct2(f.pctLucroEstimado)})</span></strong></div>
    </div>`
    : `<div style="background:rgba(0,0,0,.03);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:12px;color:var(--muted);margin-bottom:10px;">
      Este processo não passou pela cotação do Calculador — sem valor estimado pra comparar.
    </div>`;

  // Stat strip — 4 KPIs de relance no topo (evita ter que ler o resto pra
  // saber se o processo deu lucro, igual olhar o G58 da planilha direto).
  const kpiLucro = f.temReal ? f.lucroReal : null;
  const kpiPct = f.temReal ? f.pctLucroReal : null;
  const statStrip = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:12px;">
    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r-md);padding:10px 12px;">
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.03em;margin-bottom:3px;">NF Entrada</div>
      <div style="font-size:16px;font-weight:700;color:var(--text);">${r2(f.nfEntrada)}</div>
    </div>
    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r-md);padding:10px 12px;">
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.03em;margin-bottom:3px;">NF Saída${f.vendasResumo?' (soma das vendas)':''}</div>
      <div style="font-size:16px;font-weight:700;color:var(--text);">${r2(f.nfSaida)}</div>
    </div>
    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r-md);padding:10px 12px;">
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.03em;margin-bottom:3px;">Custo Real Total</div>
      <div style="font-size:16px;font-weight:700;color:var(--text);">${r2(f.custoRealTotal)}</div>
    </div>
    <div style="background:${kpiLucro==null?'var(--card)':kpiLucro>=0?'var(--ok-bg)':'var(--err-bg)'};border:1px solid ${kpiLucro==null?'var(--border)':kpiLucro>=0?'var(--ok)':'var(--err)'};border-radius:var(--r-md);padding:10px 12px;">
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.03em;margin-bottom:3px;">Lucro Real</div>
      <div style="font-size:16px;font-weight:700;color:${kpiLucro==null?'var(--muted)':kpiLucro>=0?'var(--ok)':'var(--err)'};">${r2(kpiLucro)} <span style="font-size:12px;font-weight:400;">${kpiPct!=null?`(${pct2(kpiPct)})`:''}</span></div>
    </div>
  </div>`;

  const colunaEsquerda = `
    ${blocoEstimado}
    <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">✅ Resultado real</div>
    <div style="display:flex;flex-direction:column;gap:4px;font-size:13px;">
      ${linhaReal}
    </div>
    ${linhaMargemTaxas}
    ${linhaVendas}
    ${linhaDelta}
  `;

  const blocosDireita = [renderFechamentoBreakdown(p), renderFechamentoParcelasCambio(p), renderFechamentoTimeline(p)]
    .filter(Boolean)
    .map(bloco => `<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r-md);padding:10px 12px;margin-bottom:8px;">${bloco}</div>`)
    .join('');

  return `<div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:14px 16px;">
    ${statStrip}
    <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:start;">
      <div>${colunaEsquerda}</div>
      <div>${blocosDireita || '<div style="font-size:13px;color:var(--dim);">Sem detalhamento adicional (custos por grupo, parcelas ou timeline) lançado ainda.</div>'}</div>
    </div>
  </div>`;
}


// ════════════════════════════════════════════════════════════════
// ALERTAS E NOTIFICAÇÕES
// ════════════════════════════════════════════════════════════════
function verificarAlertas(proc, criarNotif){
  const alertas = [];
  const hoje = new Date(); hoje.setHours(0,0,0,0);

  // Demurrage
  const diasDemur = demurrageDias(proc);
  if(diasDemur !== null && diasDemur <= 5 && diasDemur >= 0 && !proc.data_devolucao_vazio){
    alertas.push({tipo:'urgente', titulo:`Demurrage: ${proc.referencia}`, mensagem:`Vence em ${diasDemur} dia(s)! Container ainda não devolvido.`});
  }
  if(diasDemur !== null && diasDemur < 0 && !proc.data_devolucao_vazio){
    alertas.push({tipo:'urgente', titulo:`Demurrage VENCIDO: ${proc.referencia}`, mensagem:`Venceu há ${Math.abs(diasDemur)} dia(s). Custos em andamento.`});
  }

  // Armazenagem (1º período grátis no porto) — mesma ideia do Demurrage
  // acima, só que o vencimento vem da Presença de Carga + dias fixos por
  // porto (ver PORTO_ARMAZENAGEM_FREE_DIAS / armazenagemDias()). Faltava
  // aqui o mesmo "encerra o alerta quando resolvido" que o Demurrage já
  // tinha com data_devolucao_vazio (pedido Emanuelly 04/09/2026) — sem
  // isso, um processo continuava alertando "Armazenagem VENCIDA" pra
  // sempre, mesmo depois da carga já ter saído do porto/terminal. O evento
  // que encerra a armazenagem é a Data de Carregamento (a carga saiu pra
  // ser carregada/entregue), não a devolução do container vazio (que é
  // outra etapa, mais pra frente).
  const diasArmaz = armazenagemDias(proc);
  if(diasArmaz !== null && diasArmaz <= 2 && diasArmaz >= 0 && !proc.data_carregamento){
    alertas.push({tipo:'urgente', titulo:`Armazenagem: ${proc.referencia}`, mensagem:`1º período vence em ${diasArmaz} dia(s)! Retirar do porto.`});
  }
  if(diasArmaz !== null && diasArmaz < 0 && !proc.data_carregamento){
    alertas.push({tipo:'urgente', titulo:`Armazenagem VENCIDA: ${proc.referencia}`, mensagem:`Venceu há ${Math.abs(diasArmaz)} dia(s). Armazenagem adicional em andamento.`});
  }

  // Alerta ETA: ETA passou e processo ainda está Embarcado
  if(proc.eta && proc.fase === 'EMBARCADO'){
    const eta = parseDataLocal(proc.eta);
    const diff = Math.ceil((hoje - eta)/86400000);
    if(diff > 0){
      alertas.push({tipo:'alerta', titulo:`ETA vencido: ${proc.referencia}`, mensagem:`ETA era ${eta.toLocaleDateString('pt-BR')} — processo ainda Embarcado. Verificar chegada.`});
    }
  }

  // Alerta ETA próximo (2 dias)
  if(proc.eta && proc.fase === 'EMBARCADO'){
    const eta = parseDataLocal(proc.eta);
    const diff = Math.ceil((eta - hoje)/86400000);
    if(diff >= 0 && diff <= 2){
      alertas.push({tipo:'info', titulo:`ETA em ${diff === 0 ? 'hoje' : diff + 'd'}: ${proc.referencia}`, mensagem:`Navio previsto para ${eta.toLocaleDateString('pt-BR')}.`});
    }
  }

  // Alerta PI vencimento (prazo pagamento nos próximos 5 dias)
  if(proc.pi_data_saldo && !proc.pi_pago){
    const venc = parseDataLocal(proc.pi_data_saldo);
    const diff = Math.ceil((venc - hoje)/86400000);
    if(diff <= 5 && diff >= 0){
      alertas.push({tipo:'urgente', titulo:`Pagamento PI vence em ${diff}d: ${proc.referencia}`, mensagem:`Saldo da PI vence em ${venc.toLocaleDateString('pt-BR')}.`});
    }
    if(diff < 0){
      alertas.push({tipo:'urgente', titulo:`Pagamento PI VENCIDO: ${proc.referencia}`, mensagem:`Venceu há ${Math.abs(diff)} dia(s).`});
    }
  }

  // Embarque previsto pra semana atual sem CI/PL/Draft anexados (pedido
  // Emanuelly 03/09/2026). Não existe campo estruturado pra Packing List e
  // Draft — a checagem é por nome de arquivo anexado no GED (ver ged_nomes,
  // preenchido no GET /api/controle/v2/processos, server.js). Só faz
  // sentido antes do embarque de fato acontecer (PI/Ag. Embarque).
  if(proc.etd && (proc.fase === 'PI' || proc.fase === 'AGUARDANDO_EMBARQUE')){
    const etd = parseDataLocal(proc.etd);
    const diaSemana = hoje.getDay(); // 0=domingo .. 6=sábado
    const inicioSemana = new Date(hoje); inicioSemana.setDate(hoje.getDate() - (diaSemana===0?6:diaSemana-1)); // segunda-feira
    const fimSemana = new Date(inicioSemana); fimSemana.setDate(inicioSemana.getDate()+6); // domingo
    if(etd >= inicioSemana && etd <= fimSemana){
      const nomes = proc.ged_nomes || [];
      const temCI    = nomes.some(n => /\bci\b/i.test(n) || /invoice/i.test(n));
      const temPL    = nomes.some(n => /\bpl\b/i.test(n) || /packing/i.test(n));
      const temDraft = nomes.some(n => /draft/i.test(n));
      const faltando = [!temCI&&'CI', !temPL&&'PL', !temDraft&&'Draft'].filter(Boolean);
      if(faltando.length){
        alertas.push({tipo:'alerta', titulo:`Embarque esta semana sem documentos: ${proc.referencia}`, mensagem:`ETD ${etd.toLocaleDateString('pt-BR')} — faltando anexar: ${faltando.join(', ')}.`});
      }
    }
  }

  // Aprovação HBL / Solicitação LI pendente após o embarque (pedido
  // Emanuelly 04/09/2026): esses dois campos (aba Logística, entre Booking
  // & Embarque e Carregamento) precisam estar marcados "Sim" — se o
  // processo já embarcou (Data de Embarque preenchida) e algum dos dois
  // ainda não foi marcado como Sim, entra como alerta pra não passar batido.
  // Só faz sentido ENQUANTO o processo ainda está em andamento — uma vez
  // Finalizado não tem mais nada a fazer com HBL/LI, e processos antigos
  // (finalizados antes desses 2 campos existirem, 04/09/2026) nunca vão
  // ter isso preenchido retroativamente. Sem esse corte, ficava alertando
  // pra sempre em processo já encerrado (pedido Emanuelly 09/09/2026: "os
  // que já estejam finalizados não fiquem com o alerta").
  if(proc.data_embarque && proc.fase !== 'FINALIZADO'){
    const pendentes = [];
    if(proc.aprovacao_hbl !== 'Sim') pendentes.push('Aprovação HBL');
    if(proc.solicitacao_li !== 'Sim') pendentes.push('Solicitação LI');
    if(pendentes.length){
      alertas.push({tipo:'alerta', titulo:`Pendência pós-embarque: ${proc.referencia}`, mensagem:`Já embarcou e ainda falta: ${pendentes.join(', ')}.`});
    }
  }

  if(criarNotif){
    if(alertas.length) alertas.forEach(a => criarNotificacao(proc.id, a.tipo, a.titulo, a.mensagem));
    // Limpa notificações antigas do processo cuja condição não é mais
    // verdadeira (pedido Emanuelly 09/09/2026: "os que já estejam
    // finalizados não fiquem com o alerta dos docs" — ex: alerta de
    // "sem documentos" criado quando faltava CI/PL/Draft continuava no
    // sino de notificações pra sempre, mesmo depois de anexar os
    // documentos ou do processo já ter avançado de fase/sido finalizado.
    // Roda a cada save (mesmo gatilho que cria notificação nova acima) —
    // compara o que está com o que DEVERIA estar ativo agora e apaga o
    // resto.
    limparNotificacoesResolvidas(proc.id, alertas.map(a=>a.titulo));
  }
  return alertas;
}

// Função pura (fácil de testar): dado o que já existe no sino de
// notificações pra um processo e a lista de títulos que estão ativos
// AGORA (saída de verificarAlertas), devolve os ids que não representam
// mais uma condição verdadeira e por isso devem ser apagados.
function idsNotificacoesResolvidas(notifsExistentes, titulosAtivos){
  return (notifsExistentes||[])
    .filter(n => !titulosAtivos.includes(n.titulo))
    .map(n => n.id);
}

async function limparNotificacoesResolvidas(processoId, titulosAtivos){
  try{
    const r = await fetch('/api/controle/v2/notificacoes');
    const d = await r.json();
    if(!d.ok) return;
    const doProcesso = (d.notificacoes||[]).filter(n => n.processo_id===processoId);
    const ids = idsNotificacoesResolvidas(doProcesso, titulosAtivos);
    if(!ids.length) return;
    await fetch('/api/controle/v2/notificacoes/limpar', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ ids })
    });
    _notifsCache = [];
  }catch(e){ /* limpeza é best-effort — não bloqueia o save */ }
}

// Cache em memória das notificações já carregadas nesta sessão, usado só
// para evitar duplicatas — não substitui carregarNotificacoes().
let _notifsCache = [];

async function criarNotificacao(processoId, tipo, titulo, mensagem){
  // Evita criar a mesma notificação de novo a cada save do processo: se já
  // existe uma notificação idêntica (mesmo processo + mesmo título) criada
  // nas últimas 24h, não cria outra. Sem isso, salvar o processo várias
  // vezes no mesmo dia (comum durante ajustes) gerava um alerta duplicado
  // a cada save, mesmo sem nada relacionado ao alerta ter mudado.
  try{
    if(!_notifsCache.length){
      const r = await fetch('/api/controle/v2/notificacoes');
      const d = await r.json();
      if(d.ok) _notifsCache = d.notificacoes||[];
    }
    const ja_existe = _notifsCache.some(n=>{
      if(n.processo_id!==processoId || n.titulo!==titulo) return false;
      if(!n.created_at) return false;
      const horas = (Date.now()-new Date(n.created_at).getTime())/3600000;
      return horas < 24;
    });
    if(ja_existe) return;
  }catch(e){ /* se a checagem falhar, segue e cria normalmente */ }

  fetch('/api/controle/v2/notificacao', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({processo_id: processoId, tipo, titulo, mensagem})
  }).then(()=>{ _notifsCache=[]; }).catch(()=>{}); // invalida cache após criar
}

async function carregarNotificacoes(){
  try{
    const r = await fetch('/api/controle/v2/notificacoes');
    const d = await r.json();
    if(!d.ok) return;
    const notifs = d.notificacoes || [];
    const naoLidas = notifs.filter(n => !n.lida_por || !n.lida_por.includes(_user.usuario));
    const count = naoLidas.length;
    const el = document.getElementById('notif-count');
    if(el){
      el.textContent = count;
      el.style.display = count > 0 ? 'block' : 'none';
    }
    // Renderizar lista
    const list = document.getElementById('notif-list');
    if(!list) return;
    if(!notifs.length){
      list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px;">Nenhuma notificação</div>';
      return;
    }
    list.innerHTML = notifs.slice(0,30).map(n => {
      const naoLida = !n.lida_por || !n.lida_por.includes(_user.usuario);
      const cor = n.tipo==='urgente'?'var(--err)':n.tipo==='alerta'?'var(--warn)':'var(--ac)';
      const iniciais = (n.created_by||'?').slice(0,2).toUpperCase();
      const tempo = n.created_at ? tempoRelativo(n.created_at) : '';
      return `<div class="notif-item ${naoLida?'unread':''} ${n.tipo}" onclick="abrirNotificacao(${n.id},'${n.processo_id||''}')">
        <div class="notif-row">
          <div class="notif-avatar" style="background:${cor}">${iniciais}</div>
          <div class="notif-content">
            <div class="notif-title">${esc(n.titulo)}</div>
            <div class="notif-msg">${esc(n.mensagem)}</div>
            <div class="notif-time">${tempo}</div>
          </div>
        </div>
      </div>`;
    }).join('');
  }catch(e){}
}

async function marcarLida(id){
  fetch('/api/controle/v2/notificacao/'+id+'/lida', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({usuario: _user.usuario})
  }).then(()=>carregarNotificacoes()).catch(()=>{});
}

// Clicar numa notificação deve marcá-la como lida E abrir o processo que ela
// se refere — antes só marcava como lida, sem nenhuma forma de chegar ao
// processo a partir da notificação (era preciso buscar manualmente na lista).
function abrirNotificacao(id, processoId){
  marcarLida(id);
  toggleNotif(); // fecha o painel de notificações
  if(processoId){
    abrirProcesso(processoId);
  } else {
    showToast('Esta notificação não está vinculada a um processo','info');
  }
}

async function marcarTodasLidas(){
  try{
    const r = await fetch('/api/controle/v2/notificacoes');
    const d = await r.json();
    if(!d.ok) return;
    const naoLidas = (d.notificacoes||[]).filter(n=>!n.lida_por||!n.lida_por.includes(_user.usuario));
    await Promise.all(naoLidas.map(n=>
      fetch('/api/controle/v2/notificacao/'+n.id+'/lida',{
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({usuario:_user.usuario})
      })
    ));
    await carregarNotificacoes();
    showToast('Todas as notificações marcadas como lidas','ok');
  }catch(e){ showToast('Erro ao marcar notificações','err'); }
}

function toggleNotif(){
  _notifAberto = !_notifAberto;
  document.getElementById('notif-panel').classList.toggle('open', _notifAberto);
  if(_notifAberto) carregarNotificacoes();
}

function tempoRelativo(isoDate){
  const diff = Date.now() - new Date(isoDate).getTime();
  const min = Math.floor(diff/60000);
  if(min < 1) return 'agora';
  if(min < 60) return `${min}min atrás`;
  const h = Math.floor(min/60);
  if(h < 24) return `${h}h atrás`;
  const d = Math.floor(h/24);
  return `${d}d atrás`;
}

// ════════════════════════════════════════════════════════════════
// RENDER
// ════════════════════════════════════════════════════════════════
// Rótulos amigáveis para os filtros financeiros especiais (usados pelos
// cards clicáveis do Dashboard) — sem isso, o usuário não tem como saber
// qual filtro está ativo depois de clicar num card e ir para a tabela.
const FILTRO_FINANCEIRO_LABEL = {
  __chegada_7d:         '🚢 Chegada prevista (ETA) nos próximos 7 dias',
  __pi_vence_30d:       '💰 Saldo a pagar nos próximos 30 dias',
  __capital_parado:     '📦 Capital parado em estoque/trânsito (pago, aguardando finalizar)',
  __pi_aberto:          '💰 Processos com PI em aberto',
  __pi_pago:            '✓ Processos com PI já paga',
  __pi_vencido:         '🚨 Pagamentos vencidos',
  __pi_vence_semana:    '⚠ Pagamentos vencendo em 7 dias',
  __nf_entrada_periodo: '📥 NF Entrada no período selecionado',
  __nf_saida_periodo:   '📤 NF Saída no período selecionado',
  __demur_aberto:       '⏱ Demurrage em aberto',
  __cambio_periodo:     '💱 Câmbio a pagar no período selecionado',
};

function renderFiltroFinanceiroAtivo(){
  const el = document.getElementById('filtro-financeiro-ativo');
  if(!el) return;
  const label = FILTRO_FINANCEIRO_LABEL[_faseFilter];
  if(!label){ el.innerHTML=''; return; }
  el.innerHTML = `<div style="display:flex;align-items:center;gap:10px;background:rgba(26,127,212,.06);border:1px solid rgba(26,127,212,.2);border-radius:8px;padding:8px 14px;margin-bottom:10px;font-size:12px;font-weight:600;color:var(--ac);">
    <span>${label}</span>
    <button type="button" onclick="setFaseFilter('')" style="margin-left:auto;border:none;background:none;color:var(--ac);font-weight:700;cursor:pointer;font-size:12px;">✕ Limpar filtro</button>
  </div>`;
}

function renderFaseFilter(){
  const el = document.getElementById('fase-filter');
  if(!el) return;
  el.innerHTML = `<div class="fase-pill ${_faseFilter===''?'active':''}" onclick="setFaseFilter('')">Todos</div>` +
    FASES.map(f=>`<div class="fase-pill ${_faseFilter===f.id?'active':''}" onclick="setFaseFilter('${f.id}')">${f.icon} ${f.label}</div>`).join('') +
    // Pill "Fechado" à parte — não é uma fase real do pipeline (ver
    // faseParaExibir), é o filtro especial __fechado (FILTROS_FASE_ESPECIAIS)
    // que olha p.fechado direto.
    `<div class="fase-pill ${_faseFilter==='__fechado'?'active':''}" onclick="setFaseFilter('__fechado')">🔒 Fechado</div>`;
}

// Fecha todos os dashboards (Executivo, Financeiro, Resultado, Narcélio,
// Carregamento) e desmarca seus itens no menu lateral. Chamado ao trocar
// de aba/fase ou ao abrir outro dashboard, para a tela trocar de fato em
// vez de empilhar dashboard + tabela (ou dois dashboards ao mesmo tempo).
// Elementos do topo da tela normal do Controle (KPI cards, busca/botoes,
// filtro de data, abas de fase) - escondidos por TODOS os dashboards do
// menu lateral ao abrir (pedido do Ayslan, 08/09/2026, depois de ajustar
// so o Por Cliente/Medida: "da mesma forma tem que ser assim pra todos
// esses. tirar esse 'cabecalho'"). Usado tanto pelos toggles individuais
// (toggleDashExecutivo/Financeiro/Resultado/Narcelio/Carregamento/TV/
// ClienteMedida) quanto por fecharTodosDashboards() abaixo, que restaura
// tudo sempre que nenhum dashboard fica aberto.
const ELEMENTOS_TOPO_DASHBOARD = ['stats-grid','filtro-financeiro-ativo','filtro-data-bar','fase-filter'];

function fecharTodosDashboards(){
  ['executivo','financeiro','resultado','analises','narcelio','carregamento','tv','clientemedida','cambio'].forEach(function(id){
    var el = document.getElementById('dash-'+id);
    if(el) el.style.display = 'none';
    var menu = document.getElementById('menu-'+id);
    if(menu) menu.classList.remove('active');
  });

document.querySelector('.table-wrap') && (document.querySelector('.table-wrap').style.display = '');

// Restaura o topo (KPI cards/busca/botões/filtro de data/abas de fase)
// caso o Por Cliente/Medida tivesse escondido (ver toggleDashClienteMedida
// em controle-dash-cliente-medida.js) — sem isso, trocar de Cliente/Medida
// direto pra outro dashboard deixava o topo sumido pra sempre.
ELEMENTOS_TOPO_DASHBOARD.forEach(function(id){
  var el = document.getElementById(id);
  if(el) el.style.display = '';
});
var toolbarEl = document.querySelector('.toolbar');
if(toolbarEl) toolbarEl.style.display = '';
}

function setFaseFilter(fase){
  fecharTodosDashboards();
  _faseFilter = fase;
  _pagina = 1;
  renderFaseFilter();
  renderFiltroFinanceiroAtivo();
  render();
  // Atualizar sidebar
  document.querySelectorAll('.sidebar-item').forEach(el=>el.classList.remove('active'));
  if(fase==='') document.getElementById('menu-todos')?.classList.add('active');
  else if(fase==='__alertas') document.getElementById('menu-alertas')?.classList.add('active');
  else if(fase==='__cancelados') document.getElementById('menu-cancelados')?.classList.add('active');
  else if(fase==='__cancelamento_solicitado') document.getElementById('menu-solicitacoes-cancelamento')?.classList.add('active');
}

// Usada pelos cards clicáveis do Dashboard Executivo/Financeiro: fecha o
// dashboard que estiver aberto e mostra a tabela principal já filtrada,
// para o usuário poder ver e agir diretamente nos processos daquele número
// (em vez do card ser só um número estático no topo).
function abrirComFiltro(filtro){
  const dashExec = document.getElementById('dash-executivo');
  const dashFin  = document.getElementById('dash-financeiro');
  if(dashExec) dashExec.style.display = 'none';
  if(dashFin)  dashFin.style.display  = 'none';
  document.getElementById('menu-executivo')?.classList.remove('active');
  document.getElementById('menu-financeiro')?.classList.remove('active');
  setFaseFilter(filtro);
  document.querySelector('.table-wrap')?.scrollIntoView({behavior:'smooth', block:'start'});
}

function renderStats(){
  const el = document.getElementById('stats-grid');
  if(!el) return;
  // Processos cancelados nao entram em nenhuma contagem do topo (pedido
  // Emanuelly 03/09/2026) - eles continuam aparecendo na lista/menu
  // "Cancelados" normalmente, so nao contam pro Total/Em andamento/etc.
  const processosAtivos = _processos.filter(p => !p.cancelado);
  const total = processosAtivos.length;
  const emAndamento = processosAtivos.filter(p => p.fase !== 'FINALIZADO').length;
  const finalizados = processosAtivos.filter(p => p.fase === 'FINALIZADO').length;
  // Mantido para o badge "Com alertas" da sidebar (o card do topo agora
  // mostra "Chegada em 7d" no lugar, mas o item do menu lateral continua).
  const comAlerta = processosAtivos.filter(p => verificarAlertas(p,false).length > 0).length;
  // Demurrage crítico
  const demurCrit = processosAtivos.filter(p => { const d=demurrageDias(p); return d!==null&&d<=5&&!p.data_devolucao_vazio; }).length;
  const armazCrit = processosAtivos.filter(p => { const d=armazenagemDias(p); return d!==null&&d<=2&&!p.data_chegada&&!p.data_carregamento; }).length;
  const chegando7d = processosAtivos.filter(p => chegandoEmDias(p,7)).length;

  const refsDuplicadas = (() => {
const norm = s => (s||'').toString().trim().toUpperCase().replace(/\s+/g,'');
const cont = {};
processosAtivos.forEach(p => { const r = norm(p.referencia); if(r) cont[r]=(cont[r]||0)+1; });
return processosAtivos.filter(p => cont[norm(p.referencia)] > 1).length;
})();

const stats = [
    {num:total,       label:'Total',          cor:'var(--ac)',  filtro:''},
    {num:emAndamento, label:'Em andamento',    cor:'var(--warn)',filtro:'__andamento'},
    {num:chegando7d,  label:'Chegada em 7d',  cor:'var(--info)',filtro:'__chegada_7d'},
    {num:demurCrit,   label:'Demurrage ≤5d',  cor:'var(--err)', filtro:'__demur'},
    {num:armazCrit,   label:'Armazenagem ≤2d', cor:'var(--err)', filtro:'__armazenagem'},
    {num:finalizados, label:'Finalizados',     cor:'var(--ok)',  filtro:'FINALIZADO'},
  ];
if (refsDuplicadas > 0) stats.push({num:refsDuplicadas, label:'Referência duplicada', cor:'var(--err)', filtro:'__ref_duplicada'});

  // Badges sidebar por fase — processo fechado (p.fechado) não conta na
  // fase real dele aqui (ex: FINALIZADO), e sim só no badge próprio
  // "🔒 Fechado" — mesmo critério de exibição de faseParaExibir(), pra não
  // contar o mesmo processo em 2 badges ao mesmo tempo.
  const faseCount = {};
  let fechadoCount = 0;
  processosAtivos.forEach(p=>{
    if(p.fechado){ fechadoCount++; return; }
    faseCount[p.fase] = (faseCount[p.fase]||0)+1;
  });
  ['PI','AGUARDANDO_EMBARQUE','EMBARCADO','DESEMBARCADO','REGISTRO_DI',
   'PARAMETRIZACAO','CARREGAMENTO','FATURAMENTO','DEVOLUCAO_VAZIO','FINALIZADO'].forEach(f=>{
    const el = document.getElementById('sb-'+f);
    if(!el) return;
    const n = faseCount[f]||0;
    el.textContent = n;
    el.style.display = n > 0 ? 'inline' : 'none';
  });
  const elFechado = document.getElementById('sb-__fechado');
  if(elFechado){
    elFechado.textContent = fechadoCount;
    elFechado.style.display = fechadoCount > 0 ? 'inline' : 'none';
  }
  const badgeAlerta = document.getElementById('badge-alertas');
  if(badgeAlerta){ badgeAlerta.textContent=comAlerta; badgeAlerta.style.display=comAlerta>0?'block':'none'; }
  const cancelados = _processos.filter(p=>!!p.cancelado).length;
  const badgeCancelados = document.getElementById('badge-cancelados');
  if(badgeCancelados){ badgeCancelados.textContent=cancelados; badgeCancelados.style.display=cancelados>0?'block':'none'; }
  const solicitacoesCancelamento = _processos.filter(p=>!!p.cancelamento_solicitado && !p.cancelado).length;
  const badgeSolicCancelamento = document.getElementById('badge-solicitacoes-cancelamento');
  if(badgeSolicCancelamento){ badgeSolicCancelamento.textContent=solicitacoesCancelamento; badgeSolicCancelamento.style.display=solicitacoesCancelamento>0?'block':'none'; }
  document.getElementById('badge-total').textContent = total;

  // O "0" na fonte Syne (usada em .stat-num) renderiza como uma forma
  // oval/rosquinha decorativa, quase ilegível como numeral -- troca pra
  // fonte padrão só quando o valor é zero, sem mexer na aparência dos
  // outros números (achado na auditoria visual, 10/09/2026).
  el.innerHTML = stats.map(s=>`
    <div class="stat-card" onclick="setFaseFilter('${s.filtro}')">
      <div class="stat-num" style="color:${s.cor}${s.num===0 ? ';font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;font-weight:700;' : ''}">${s.num}</div>
      <div class="stat-label">${s.label}</div>
    </div>`).join('');
}

// Mapa de filtros especiais por "fase" virtual (chaves começando com "__",
// usadas pelos cards clicáveis dos dashboards Executivo/Financeiro). Cada
// função recebe a lista já filtrada por busca/data e devolve a lista final.
// Antes isso era uma cadeia crescente de if/else (uma comparação de string
// atrás da outra) — um mapa deixa mais fácil ver todos os filtros disponíveis
// de uma vez, e adicionar um novo sem alterar uma cadeia gigante.
const FILTROS_FASE_ESPECIAIS = {
  __alertas:    lista => lista.filter(p=>verificarAlertas(p,false).length>0),
  __cancelados: lista => lista.filter(p=>!!p.cancelado),
  __fechado:    lista => lista.filter(p=>!!p.fechado),
  __cancelamento_solicitado: lista => lista.filter(p=>!!p.cancelamento_solicitado && !p.cancelado),
  __andamento:  lista => lista.filter(p=>p.fase!=='FINALIZADO'),
  __demur:      lista => lista.filter(p=>{ const d=demurrageDias(p); return d!==null&&d<=5&&!p.data_devolucao_vazio; }),
  __armazenagem: lista => lista.filter(p=>{ const d=armazenagemDias(p); return d!==null&&d<=2&&!p.data_chegada&&!p.data_carregamento; }),
  __chegada_7d: lista => lista.filter(p=>chegandoEmDias(p,7)),
__ref_duplicada: lista => {
const norm = s => (s||'').toString().trim().toUpperCase().replace(/\s+/g,'');
const cont = {};
lista.forEach(p => { const r = norm(p.referencia); if(r) cont[r]=(cont[r]||0)+1; });
return lista.filter(p => cont[norm(p.referencia)] > 1);
},
  // Filtros financeiros — usados pelos cards clicáveis do Dashboard Financeiro/Executivo
  __pi_aberto:  lista => lista.filter(p=>p.fase!=='FINALIZADO' && p.pi_valor_usd && !p.pi_pago),
  __pi_pago:    lista => lista.filter(p=>p.fase!=='FINALIZADO' && p.pi_valor_usd && p.pi_pago),
  __pi_vencido: lista => lista.filter(p=>{
    if(p.fase==='FINALIZADO'||p.pi_pago||!p.pi_data_saldo) return false;
    const hoje=new Date(); hoje.setHours(0,0,0,0);
    return parseDataLocal(p.pi_data_saldo) < hoje;
  }),
  __pi_vence_semana: lista => lista.filter(p=>{
    if(p.fase==='FINALIZADO'||p.pi_pago||!p.pi_data_saldo) return false;
    const hoje=new Date(); hoje.setHours(0,0,0,0);
    const semFim=new Date(hoje); semFim.setDate(hoje.getDate()+7);
    const d=parseDataLocal(p.pi_data_saldo);
    return d>=hoje && d<=semFim;
  }),
  __pi_vence_30d: lista => lista.filter(p=>{
    if(p.fase==='FINALIZADO'||p.pi_pago||!p.pi_valor_usd) return false;
    const hoje=new Date(); hoje.setHours(0,0,0,0);
    const lim=new Date(hoje); lim.setDate(hoje.getDate()+30);
    const dentro = d => { if(!d) return false; const dt=new Date(d+'T00:00:00'); return dt>=hoje && dt<=lim; };
    return dentro(p.pi_data_entrada) || dentro(p.pi_data_saldo);
  }),
  // Capital parado em estoque/trânsito — usado pelo card do Dashboard
  // Financeiro (v2): já pago integralmente, mas o processo ainda não foi
  // finalizado (mercadoria ainda não virou venda concluída).
  __capital_parado: lista => lista.filter(p=>p.pi_pago && p.fase!=='FINALIZADO'),
  __nf_entrada_periodo: lista => lista.filter(p=>{
    if(p.fase==='FINALIZADO'||!p.nf_entrada_data) return false;
    const {ini,fim} = calcularPeriodo('financeiro');
    const d=parseDataLocal(p.nf_entrada_data);
    return d>=ini && d<=fim;
  }),
  __nf_saida_periodo: lista => lista.filter(p=>{
    if(p.fase==='FINALIZADO'||!p.nf_saida_data) return false;
    const {ini,fim} = calcularPeriodo('financeiro');
    const d=parseDataLocal(p.nf_saida_data);
    return d>=ini && d<=fim;
  }),
  __demur_aberto: lista => lista.filter(p=>!p.data_devolucao_vazio && p.demurrage_vencimento),
  __cambio_periodo: lista => lista.filter(p=>{
    if(p.fase==='FINALIZADO'||p.pi_pago||!p.pi_valor_usd) return false;
    const {ini,fim} = calcularPeriodo('financeiro');
    const checar = data => { if(!data) return false; const d=parseDataLocal(data); return d>=ini && d<=fim; };
    return checar(p.pi_data_saldo) || checar(p.pi_data_entrada);
  }),
};

// ════════════════════════════════════════════════════════════════
// FILTRO AVANÇADO (Fase 2 do filtro inteligente, pedido Ayslan
// 10/09/2026) — reaproveita o mesmo motor genérico criado pro Dashboard
// Resultado (OPERADORES_FILTRO/avaliarCondicaoFiltro/aplicarFiltrosGenericos/
// renderBarraFiltrosGenerico, em controle-dashboards.js) aplicado agora na
// tabela principal de processos, além dos filtros fixos que já existiam
// (busca, cliente, finalidade, pendência, data). Combinável com eles: os
// filtros avançados rodam POR CIMA do resultado dos filtros fixos.
// ════════════════════════════════════════════════════════════════
let _filProcessoAvancado = { condicoes: [] };

// Monta a "linha achatada" de 1 processo pros campos filtráveis — mistura
// campos de cadastro direto (fase, país, forma de pagamento) com campos
// calculados de resultado (margem/lucro real), pra permitir a mesma
// pergunta que motivou o pedido ("margem de lucro por cliente") só que já
// na tela principal, sem precisar abrir o Dashboard Resultado.
function linhaFiltroProcesso(p){
  const fch = calcularFechamento(p);
  const nfSaida = fch.nfSaida != null ? fch.nfSaida : null;
  const margemReal = (fch.pctLucroReal != null) ? fch.pctLucroReal * 100 : null;
  return {
    p,
    referencia: p.referencia || '',
    fornecedor: p.fornecedor || '',
    cliente: (clientesDoProcesso(p)[0] || p.cliente || ''),
    marca: p.brand || '',
    pais: paisDoProcesso(p) || '',
    fase: faseParaExibir(p).label,
    finalidade: {IMPORTACAO_DIRETA:'Importação Própria (Direto)', ENCOMENDA:'Encomenda', CONTA_E_ORDEM:'Conta e Ordem'}[p.finalidade] || '',
    formaPagamento: (typeof LABEL_PI_PAGAMENTO !== 'undefined' ? LABEL_PI_PAGAMENTO[p.pi_pagamento] : null) || '',
    margemReal,
    lucroReal: fch.lucroReal,
    faturamento: nfSaida,
    demurrageDias: demurrageDias(p),
  };
}

// Campos filtráveis da tabela principal — opções de select derivadas dos
// próprios processos carregados (só lista o que de fato existe).
function camposFiltroProcesso(linhas){
  const paises = [...new Set(linhas.map(l=>l.pais).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  const formas = [...new Set(linhas.map(l=>l.formaPagamento).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  return {
    referencia:     { label:'Referência', tipo:'texto' },
    fornecedor:     { label:'Fornecedor', tipo:'texto' },
    cliente:        { label:'Cliente', tipo:'texto' },
    marca:          { label:'Marca', tipo:'texto' },
    pais:           { label:'País de Origem', tipo:'select', opcoes:paises },
    fase:           { label:'Fase', tipo:'select', opcoes:FASES.map(f=>f.label) },
    finalidade:     { label:'Finalidade', tipo:'select', opcoes:['Importação Própria (Direto)','Encomenda','Conta e Ordem'] },
    formaPagamento: { label:'Forma de Pagamento', tipo:'select', opcoes:formas },
    margemReal:     { label:'Margem Real (%)', tipo:'numero' },
    lucroReal:      { label:'Lucro Real (R$)', tipo:'numero' },
    faturamento:    { label:'Faturamento / NF Saída (R$)', tipo:'numero' },
    demurrageDias:  { label:'Dias de Demurrage', tipo:'numero' },
  };
}

function filtroProcessoAdd(){
  _filProcessoAvancado.condicoes.push({ campo:'', operador:'', valor:'', valor2:'' });
  renderFiltroProcessoAvancado();
  render();
}
function filtroProcessoRemove(i){
  _filProcessoAvancado.condicoes.splice(i,1);
  renderFiltroProcessoAvancado();
  render();
}
function filtroProcessoChange(i, campo, valor){
  if(!_filProcessoAvancado.condicoes[i]) return;
  _filProcessoAvancado.condicoes[i][campo] = valor;
  if(campo === 'campo'){ _filProcessoAvancado.condicoes[i].operador=''; _filProcessoAvancado.condicoes[i].valor=''; _filProcessoAvancado.condicoes[i].valor2=''; }
  renderFiltroProcessoAvancado();
  render();
}
// Redesenha só a barra de filtros (chamado no boot e depois de cada
// add/remove/change) — separado de render() pra não remontar a barra a
// cada digitação de busca/paginação, só quando o próprio filtro muda.
function renderFiltroProcessoAvancado(){
  const linhas = _processos.map(linhaFiltroProcesso);
  const defs = camposFiltroProcesso(linhas);
  renderBarraFiltrosGenerico('filtros-processo-avancados', _filProcessoAvancado.condicoes, defs, 'filtroProcessoAdd', 'filtroProcessoRemove', 'filtroProcessoChange');
}

function filtrarProcessos(ignorarFaseFilter){
  let lista = [..._processos];
  const q = (document.getElementById('search')?.value||'').toLowerCase().trim();

  if(q) lista = lista.filter(p=>
    (p.referencia||'').toLowerCase().includes(q)||
    (p.fornecedor||'').toLowerCase().includes(q)||
    (p.cliente||'').toLowerCase().includes(q)||
    (p.container||'').toLowerCase().includes(q)||
    (p.hbl||'').toLowerCase().includes(q)||
    (p.mbl||'').toLowerCase().includes(q)||
    (p.numero_di||'').toLowerCase().includes(q)||
    (p.navio||'').toLowerCase().includes(q)||
    (p.armador||'').toLowerCase().includes(q)||
    (p.booking_numero||'').toLowerCase().includes(q)||
    (p.brand||'').toLowerCase().includes(q)||
clientesDoProcesso(p).some(cl=>cl.toLowerCase().includes(q))
  );

  // Filtro por data
  const dtDe  = document.getElementById('filtro-data-de')?.value;
  const dtAte = document.getElementById('filtro-data-ate')?.value;
  const dtCampo = document.getElementById('filtro-data-campo')?.value || 'eta';
  if(dtDe || dtAte){
    lista = lista.filter(p=>{
      const val = p[dtCampo];
      if(!val) return false;
      if(dtDe  && val < dtDe)  return false;
      if(dtAte && val > dtAte) return false;
      return true;
    });
  }

  if(_faseFilter && !ignorarFaseFilter){
    const filtroEspecial = FILTROS_FASE_ESPECIAIS[_faseFilter];
    lista = filtroEspecial ? filtroEspecial(lista) : lista.filter(p=>p.fase===_faseFilter);
  }

  // Filtro por cliente
  const filtroCliente = document.getElementById('filtro-cliente')?.value||'';
  if(filtroCliente) lista = lista.filter(p=>clientesDoProcesso(p).includes(filtroCliente));

  // Filtro por finalidade
  const filtroFinalidade = document.getElementById('filtro-finalidade')?.value||'';
  if(filtroFinalidade) lista = lista.filter(p=>p.finalidade === filtroFinalidade);

  // Filtro por pendência de revisão
  const filtroPendencia = document.getElementById('filtro-pendencia')?.checked;
  if(filtroPendencia) lista = lista.filter(p=>!!p.pendencia_revisao);

  // Filtro avançado (Fase 2 do filtro inteligente) — combinável com todos
  // os filtros acima, roda por último sobre o que já sobrou.
  if(_filProcessoAvancado.condicoes.length){
    const linhasAv = lista.map(linhaFiltroProcesso);
    const defsAv = camposFiltroProcesso(linhasAv);
    const linhasFiltradas = aplicarFiltrosGenericos(linhasAv, _filProcessoAvancado.condicoes, defsAv);
    const idsOk = new Set(linhasFiltradas.map(l=>l.p.id));
    lista = lista.filter(p=>idsOk.has(p.id));
  }

  return lista;
}

function render(){
  const lista = filtrarProcessos();
  const total = lista.length;
  const totalPags = Math.max(1, Math.ceil(total/POR_PAGINA));
  _pagina = Math.min(_pagina, totalPags);
  const inicio = (_pagina-1)*POR_PAGINA;
  const pagina = lista.slice(inicio, inicio+POR_PAGINA);

  const tbody = document.getElementById('table-body');
  if(!tbody) return;

  if(!pagina.length){
    tbody.innerHTML = `<div class="empty"><div class="empty-icon">📭</div><div class="empty-text">Nenhum processo encontrado</div></div>`;
  } else {
    tbody.innerHTML = pagina.map(p=>{
      const fase = faseParaExibir(p);
      const etaDate = p.eta ? parseDataLocal(p.eta).toLocaleDateString('pt-BR') : '—';
      const chegadaDate = p.data_chegada ? parseDataLocal(p.data_chegada).toLocaleDateString('pt-BR') : '';
      const dataDisplay = chegadaDate || etaDate;
      const finBadge = p.pi_pagamento ? `<span class="fin-badge fin-${p.pi_pagamento}">${p.pi_pagamento==='ENTRADA_SALDO'?'ENT+SLD':p.pi_pagamento}</span>` : '—';
      const finalidadeLabel = {IMPORTACAO_DIRETA:'Direto', ENCOMENDA:'Encomenda', CONTA_E_ORDEM:'Conta e Ordem'}[p.finalidade] || '';
      const finalidadeBadge = finalidadeLabel ? `<span style="font-size:9px;font-weight:700;background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:1px 5px;margin-left:4px;color:var(--muted);">${finalidadeLabel}</span>` : '';
      const pendenciaBadge = p.pendencia_revisao ? `<span title="${esc(p.pendencia_revisao).replace(/"/g,'&quot;')}" style="font-size:10px;font-weight:700;background:rgba(243,156,18,.15);border:1px solid rgba(243,156,18,.4);border-radius:4px;padding:1px 6px;margin-left:4px;color:#f39c12;">⚠ Revisar</span>` : '';
      // referencia/fornecedor são texto livre (fornecedor às vezes vem de
      // extração por IA de documento externo) — escapar sempre antes de
      // colocar em innerHTML, senão um valor malicioso/malformado vira HTML
      // executável pra QUALQUER usuário que abrir esta lista (XSS
      // persistente). Ver esc() em controle-campos.js.
      const canceladoBadge = p.cancelado ? `<span title="${p.cancelado_motivo?esc(p.cancelado_motivo):'Processo cancelado'}" style="font-size:9px;font-weight:700;background:rgba(100,116,139,.15);border:1px solid rgba(100,116,139,.4);border-radius:4px;padding:1px 6px;margin-left:4px;color:#64748b;">🚫 CANCELADO</span>` : '';
    const solicitacaoCancelamentoBadge = (p.cancelamento_solicitado && !p.cancelado) ? `<span title="${p.cancelado_motivo?esc(p.cancelado_motivo):'Cancelamento solicitado'}" style="font-size:9px;font-weight:700;background:rgba(217,119,6,.15);border:1px solid rgba(217,119,6,.4);border-radius:4px;padding:1px 6px;margin-left:4px;color:#d97706;">📨 CANCEL. SOLICITADO</span>` : '';
      return `<div class="table-row" onclick="abrirProcesso('${p.id}')" style="${p.cancelado?'opacity:.6;':''}">
        <div class="td td-ref" data-label="">
          <div style="display:flex;flex-wrap:wrap;align-items:center;gap:4px;row-gap:2px;">
            <span>${esc(p.referencia)||'—'}</span>${finalidadeBadge}${pendenciaBadge}${canceladoBadge}${solicitacaoCancelamentoBadge}
          </div>
        </div>
        <div class="td td-forn" data-label="Fornecedor">${esc(p.fornecedor)||'—'}</div>
        <div class="td" data-label="Fase" onclick="event.stopPropagation()" style="min-width:0;">
          <span class="inline-edit" onclick="inlineEditFase('${p.id}',this)" style="display:inline-block;max-width:100%;">
            <span class="fase-badge fase-${fase.id}">${fase.icon} ${fase.label}</span>
          </span>
        </div>
        <div class="td td-date" data-label="ETA / Chegada" onclick="event.stopPropagation()">
          <span class="inline-edit" onclick="inlineEditData('${p.id}','eta',this)" title="Clique para editar ETA">${dataDisplay}</span>
        </div>
        <div class="td" data-label="Demurrage">${demurrageDisplay(p)}</div>
        <div class="td" data-label="Financeiro">${finBadge}</div>
        <div class="td" data-label="Ações">
          <button class="btn btn-sm btn-outline" onclick="event.stopPropagation();abrirProcesso('${p.id}')">Abrir</button>
        </div>
      </div>`;
    }).join('');
  }

  // Paginação
  const pag = document.getElementById('paginacao');
  if(pag){
    if(totalPags <= 1){ pag.innerHTML=''; return; }
    let html = `<button class="pag-btn" onclick="_pagina--;render()" ${_pagina<=1?'disabled':''}>‹</button>`;
    for(let i=1;i<=totalPags;i++){
      if(i===1||i===totalPags||Math.abs(i-_pagina)<=1)
        html+=`<button class="pag-btn ${i===_pagina?'active':''}" onclick="_pagina=${i};render()">${i}</button>`;
      else if(Math.abs(i-_pagina)===2)
        html+=`<span class="pag-info">…</span>`;
    }
    html+=`<button class="pag-btn" onclick="_pagina++;render()" ${_pagina>=totalPags?'disabled':''}>›</button>`;
    html+=`<span class="pag-info">${total} processos</span>`;
    pag.innerHTML = html;
  }
}

// ════════════════════════════════════════════════════════════════
// MODAL — ABRIR / NOVO
// ════════════════════════════════════════════════════════════════

// ── ALERTA DE CAMPOS-CHAVE NAO PREENCHIDOS (pedido Emanuelly, 27/08/2026) ──
//
// Ao salvar o processo, se um campo de uma fase mais avancada ja foi preenchido
// (ex: numero da DI) mas o campo-chave de uma fase anterior ainda esta vazio
// (ex: Presenca de Carga), isso quase sempre e esquecimento -- o sistema deve
// avisar em vez de ficar silencioso. Usa a mesma ordem de fases de calcularFase(),
// acha a fase mais avancada "desbloqueada" e confere se todo campo-chave anterior
// a ela tambem foi preenchido; usado por coletarESalvar() em controle-campos.js.
const FASE_CAMPOS_ORDEM = [
  { label: 'ETD (Previsão de Embarque)', ok: p => !!p.etd, ids: ['f_etd'] },
  { label: 'Data de Embarque', ok: p => !!p.data_embarque, ids: ['f_data_embarque'] },
  { label: 'Presença de Carga / Data de Chegada', ok: p => !!(p.data_presenca || p.data_chegada), ids: ['f_data_presenca','f_data_chegada'] },
  { label: 'Nº DI / Data de Registro da DI', ok: p => !!(p.numero_di || p.data_registro_di), ids: ['f_numero_di','f_data_registro_di'] },
  { label: 'Canal / Data de Parametrização', ok: p => !!(p.canal || p.data_parametrizacao), ids: ['f_canal','f_data_parametrizacao'] },
  { label: 'Data de Liberação', ok: p => !!p.data_liberacao, ids: ['f_data_liberacao'] },
  { label: 'Data de Agendamento / NF Saída / NF Entrada', ok: p => !!(p.data_agendamento || p.nf_saida_numero || p.nf_entrada_numero), ids: ['f_data_agendamento','f_nf_saida_numero','f_nf_entrada_numero'] },
  { label: 'Data de Carregamento', ok: p => !!p.data_carregamento, ids: ['f_data_carregamento'] },
  { label: 'Data de Devolução de Vazio', ok: p => !!p.data_devolucao_vazio, ids: ['f_data_devolucao_vazio'] },
  ];

function camposFaseFaltantes(p){
    let maisAvancada = -1;
    for (let i = FASE_CAMPOS_ORDEM.length - 1; i >= 0; i--) {
          if (FASE_CAMPOS_ORDEM[i].ok(p)) { maisAvancada = i; break; }
    }
    if (maisAvancada < 0) return [];
    const faltantes = [];
    for (let i = 0; i < maisAvancada; i++) {
          if (!FASE_CAMPOS_ORDEM[i].ok(p)) faltantes.push(FASE_CAMPOS_ORDEM[i]);
    }
    return faltantes;
}
