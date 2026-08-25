// controle-core.js
// 
// Estado global, boot (login/DOMContentLoaded), cÃÂÃÂ¢mbio, CRUD de processos (API), cÃÂÃÂ¡lculo de fase/demurrage/fechamento, notificaÃÂÃÂ§ÃÂÃÂµes, filtros/stats e a renderizaÃÂÃÂ§ÃÂÃÂ£o da lista principal.
//
// Parte do controle_v2.html, extraÃÂÃÂ­do do <script> ÃÂÃÂºnico original pra
// facilitar manutenÃÂÃÂ§ÃÂÃÂ£o. Carregado via <script src> junto com os outros
// mÃÂÃÂ³dulos (ver controle_v2.html) ÃÂ¢ÃÂÃÂ nÃÂÃÂ£o ÃÂÃÂ© um ES module, entÃÂÃÂ£o todo
// estado (let/const de topo) e funÃÂÃÂ§ÃÂÃÂµes aqui continuam visÃÂÃÂ­veis pros
// outros arquivos, exatamente como estavam quando tudo era um sÃÂÃÂ³
// <script>. controle-core.js precisa carregar ANTES dos demais (ÃÂÃÂ©
// quem declara o estado global: _processos, _user, FASES etc.).
//
// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ SESSÃÂÃÂO EXPIRADA: mensagem clara em vez de erro de parse ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// Quando a sessÃÂÃÂ£o cai (ex.: reinÃÂÃÂ­cio do servidor), as rotas protegidas
// redirecionam pra /login (HTML) em vez de responder JSON. O cÃÂÃÂ³digo que
// chama fetch(...).then(r=>r.json()) entÃÂÃÂ£o quebra com um erro confuso tipo
// "Unexpected token '<' ... is not valid JSON". Este wrapper detecta esse
// redirecionamento e troca por uma mensagem que o usuÃÂÃÂ¡rio entende, usando os
// mesmos catch() que jÃÂÃÂ¡ existem em cada tela.
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

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// UUID ÃÂ¢ÃÂÃÂ compatÃÂÃÂ­vel com Safari, Chrome, Firefox
// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
function gerarUUID(){
  // Usar crypto.randomUUID se disponÃÂÃÂ­vel (Chrome, Firefox, Edge)
  if(typeof crypto !== 'undefined' && crypto.randomUUID){
    return crypto.randomUUID();
  }
  // Fallback para Safari e browsers mais antigos
  if(typeof crypto !== 'undefined' && crypto.getRandomValues){
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
  }
  // ÃÂÃÂltimo fallback: Math.random
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random()*16|0;
    return (c==='x' ? r : (r&0x3|0x8)).toString(16);
  });
}

// Analisa uma data "sem hora" (ex.: "2026-07-18", vinda de <input type=date>
// ou do banco) SEMPRE no fuso LOCAL do navegador, nunca em UTC.
// `new Date('2026-07-18')` (sem hora) ÃÂÃÂ© interpretado pelo JS como meia-noite
// UTC ÃÂ¢ÃÂÃÂ em fusos negativos (ex.: Brasil, UTC-3) isso exibe/compara como o
// dia ANTERIOR (17/07) em vez do dia certo. `new Date('2026-07-18T00:00:00')`
// (sem "Z") ÃÂÃÂ© interpretado em horÃÂÃÂ¡rio LOCAL, entÃÂÃÂ£o bate com o que a pessoa
// realmente digitou. Antes deste helper, os dois estilos apareciam
// misturados neste arquivo (e em controle-dashboards.js/controle-export.js)
// pro MESMO tipo de campo ÃÂ¢ÃÂÃÂ ex.: renderDemurInfo() lia data_chegada sem
// sufixo (UTC) enquanto calcularFase() lia o mesmo campo com sufixo (local),
// podendo mostrar dias diferentes pro mesmo processo em telas diferentes.
// Use esta funÃÂÃÂ§ÃÂÃÂ£o pra qualquer campo de data-sÃÂÃÂ³ (data_chegada, eta,
// demurrage_vencimento, pi_data_saldo, nf_entrada_data, nf_saida_data etc.).
// Para timestamps completos (created_at/updated_at, que jÃÂÃÂ¡ vÃÂÃÂªm com hora e
// "Z" de toISOString()), continue usando new Date(...) direto ÃÂ¢ÃÂÃÂ nÃÂÃÂ£o passar
// por aqui.
function parseDataLocal(str){
  return str ? new Date(str + 'T00:00:00') : null;
}

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// ESTADO
// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
let _user = null;
let _processos = [];
let _faseFilter = '';
let _searchText = '';
let _pagina = 1;
const POR_PAGINA = 50;
let _editando = null; // processo sendo editado
// Snapshot do processo exatamente como veio do servidor quando o modal foi
// aberto (ou {} pra um processo novo) ÃÂ¢ÃÂÃÂ usado sÃÂÃÂ³ pra saber quais campos o
// usuÃÂÃÂ¡rio de fato alterou nesta sessÃÂÃÂ£o de ediÃÂÃÂ§ÃÂÃÂ£o (ver coletarESalvar). Nunca
// ÃÂÃÂ© mutado depois de setado; existe sÃÂÃÂ³ pra comparaÃÂÃÂ§ÃÂÃÂ£o, nÃÂÃÂ£o ÃÂÃÂ© enviado ao
// servidor. ConcorrÃÂÃÂªncia: com vÃÂÃÂ¡rios usuÃÂÃÂ¡rios editando processos ao mesmo
// tempo, salvar o processo inteiro sempre que alguÃÂÃÂ©m clica em Salvar
// sobrescrevia silenciosamente qualquer campo que outra pessoa tivesse
// alterado nesse meio tempo (quem salvasse por ÃÂÃÂºltimo "vencia" em TUDO, nÃÂÃÂ£o
// sÃÂÃÂ³ no que de fato editou). Agora sÃÂÃÂ³ os campos realmente alterados nesta
// sessÃÂÃÂ£o sÃÂÃÂ£o enviados ÃÂ¢ÃÂÃÂ os demais ficam intocados no banco.
let _editandoOriginal = null;
let _notifAberto = false;
let _cambio = { USD: 1, BRL: 1, EUR: 1 };

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ URL por processo (task #59) ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// _baseUrlPath ÃÂÃÂ© a tela "de baixo" (/controle ou /financeiro) ÃÂ¢ÃÂÃÂ pra onde
// a URL volta quando o painel lateral do processo fecha. Se a pÃÂÃÂ¡gina jÃÂÃÂ¡
// carregou num deep link (ex: /controle/UD26-005), guardamos a referÃÂÃÂªncia
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

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// INIT
// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
window.addEventListener('DOMContentLoaded', function(){
  fetch('/api/me').then(r=>r.json()).then(d=>{
    if(!d.logado){ location.href='/login?destino='+encodeURIComponent(location.pathname); return; }
    _user = d;
    document.getElementById('user-badge').textContent = d.displayName || d.usuario;
    // Link do Dashboard NarcÃÂÃÂ©lio sÃÂÃÂ³ aparece pro prÃÂÃÂ³prio usuÃÂÃÂ¡rio narcelio ÃÂ¢ÃÂÃÂ
    // cosmÃÂÃÂ©tico (a proteÃÂÃÂ§ÃÂÃÂ£o real ÃÂÃÂ© o back-end em GET /narcelio, ver
    // server.js), mas evita mostrar um link "quebrado" (403) pra quem nÃÂÃÂ£o
    // tem acesso.
    document.getElementById('menu-narcelio')?.style.setProperty('display', ['narcelio','suporte'].includes(d.usuario) ? '' : 'none');
// BotÃÂÃÂ£o "Gerar Follow-up Semanal" (task #327): sÃÂÃÂ³ visÃÂÃÂ­vel pra usuÃÂÃÂ¡rios
// gerente ÃÂ¢ÃÂÃÂ mesma role jÃÂÃÂ¡ usada pelo back-end em POST /api/admin/
// followup-semanal (ver server.js), cosmÃÂÃÂ©tico aqui (a proteÃÂÃÂ§ÃÂÃÂ£o real ÃÂÃÂ©
// o back-end checar req.session.role==='gerente').
document.getElementById('btn-followup-semanal')?.style.setProperty('display', d.role==='gerente' ? '' : 'none');
    carregarCambio();
    carregarProcessos().then(()=>{
      if(location.pathname==='/financeiro') ativarTelaFinanceiroExclusiva();
      if(location.pathname==='/resultado') ativarTelaResultadoExclusiva();
      if(location.pathname==='/narcelio') ativarTelaNarcelioExclusiva();
      if(location.pathname==='/tv') ativarTelaTVExclusiva();
      // Deep-link ?processo=<id> ÃÂ¢ÃÂÃÂ usado pelo Calculador pra abrir direto o
      // processo recÃÂÃÂ©m-criado ao aprovar uma cotaÃÂÃÂ§ÃÂÃÂ£o (ver aprovarCotacao()
      // em calculador.html). SÃÂÃÂ³ tenta abrir depois que a lista carregou,
      // senÃÂÃÂ£o abrirProcesso() nÃÂÃÂ£o acha o processo em _processos ainda.
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

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// TELA EXCLUSIVA /financeiro ÃÂ¢ÃÂÃÂ mesma pÃÂÃÂ¡gina (controle_v2.html) e mesmo
// JS do Controle normal, sÃÂÃÂ³ que ao carregar em /financeiro a tela jÃÂÃÂ¡ abre
// direto no Dashboard Financeiro, com o que ÃÂÃÂ© sobre "lista de processos"
// (busca, filtros de fase, cards de status) escondido ÃÂ¢ÃÂÃÂ foco sÃÂÃÂ³ no
// financeiro. A TABELA de processos continua existindo mais abaixo (nÃÂÃÂ£o ÃÂÃÂ©
// removida do DOM), porque os cards e a lista de pagamentos do Dashboard
// Financeiro contam com ela pra "abrir o processo" ao clicar numa linha e
// pro drill-down dos filtros (Saldo a Pagar, ExposiÃÂÃÂ§ÃÂÃÂ£o, Capital Parado)
// funcionar exatamente como jÃÂÃÂ¡ funciona dentro do Controle ÃÂ¢ÃÂÃÂ reaproveitar
// em vez de duplicar essa lÃÂÃÂ³gica evita ter duas versÃÂÃÂµes de "abrir
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

  // Sidebar: esconde "VisÃÂÃÂ£o" e "Por fase" (nÃÂÃÂ£o fazem sentido sem a busca/
  // lista principal em destaque) ÃÂ¢ÃÂÃÂ mantÃÂÃÂ©m Dashboard Executivo e Cadastros.
  document.querySelectorAll('.sidebar-section[data-secao="processos"]').forEach(el=>{
    el.style.display = 'none';
  });
  document.querySelectorAll('.sidebar-item').forEach(el=>el.classList.remove('active'));
  document.getElementById('menu-financeiro')?.classList.add('active');

  const dashFin = document.getElementById('dash-financeiro');
  if(dashFin) dashFin.style.display = 'block';
  renderDashFinanceiro();
}

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// TELA EXCLUSIVA /resultado ÃÂ¢ÃÂÃÂ mesmo esquema do /financeiro acima: o
// Dashboard Resultado responde "quanto lucramos de verdade" cruzando o
// estimado na cotaÃÂÃÂ§ÃÂÃÂ£o (estimativa_json, gravado ao aprovar no Calculador)
// com o resultado real de cada processo (calcularFechamento ÃÂ¢ÃÂÃÂ NF SaÃÂÃÂ­da ÃÂ¢ÃÂÃÂ
// Custo Real Total). Reaproveita _processos e calcularFechamento() em vez
// de duplicar essa lÃÂÃÂ³gica.
function ativarTelaResultadoExclusiva(){
  document.title = 'IMPAK — Dashboard Resultado';
  const titulo = document.querySelector('.topbar-title');
  if(titulo) titulo.textContent = 'Dashboard Resultado';

  ['stats-grid','filtro-financeiro-ativo','filtro-data-bar','fase-filter'].forEach(id=>{
    const el = document.getElementById(id); if(el) el.style.display='none';
  });
  const toolbar = document.querySelector('.toolbar');
  if(toolbar) toolbar.style.display = 'none';

  document.querySelectorAll('.sidebar-section[data-secao="processos"]').forEach(el=>{
    el.style.display = 'none';
  });
  document.querySelectorAll('.sidebar-item').forEach(el=>el.classList.remove('active'));
  document.getElementById('menu-resultado')?.classList.add('active');

  const dashRes = document.getElementById('dash-resultado');
  if(dashRes) dashRes.style.display = 'block';
  renderDashResultado();
}

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// TRAVA DE PROCESSO ("Fechar Processo") ÃÂ¢ÃÂÃÂ ver server.js (POST /api/
// controle/v2/processo) pra a validaÃÂÃÂ§ÃÂÃÂ£o que de fato importa (o front-end
// aqui sÃÂÃÂ³ evita o usuÃÂÃÂ¡rio clicar sem querer; quem garante que ninguÃÂÃÂ©m
// edita um processo fechado ÃÂÃÂ© o servidor).
// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// TELA EXCLUSIVA /narcelio ÃÂ¢ÃÂÃÂ visÃÂÃÂ£o do dono da empresa: containers por fase
// (PI recebida/previsÃÂÃÂ£o de embarque/embarcado/chegando), faturamento por
// perÃÂÃÂ­odo, estoque parado no armazÃÂÃÂ©m (NF entrada lanÃÂÃÂ§ada + NF saÃÂÃÂ­da com
// CFOP 5905 ou ainda nÃÂÃÂ£o emitida) e previsÃÂÃÂ£o de recurso de numerÃÂÃÂ¡rio
// (fluxo de caixa combinando pagamentos de PI com custos reais do
// processo). Acesso jÃÂÃÂ¡ ÃÂÃÂ© restrito no back-end (ver /narcelio em
// server.js) ÃÂ¢ÃÂÃÂ aqui ÃÂÃÂ© sÃÂÃÂ³ a apresentaÃÂÃÂ§ÃÂÃÂ£o.
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

  ['stats-grid','filtro-financeiro-ativo','filtro-data-bar','fase-filter'].forEach(id=>{
    const el = document.getElementById(id); if(el) el.style.display='none';
  });
  const toolbar = document.querySelector('.toolbar');
  if(toolbar) toolbar.style.display = 'none';

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
  const esconderNavGlobal = () => { const nav = document.getElementById('impak-nav'); if(nav) nav.style.display = 'none'; };
  esconderNavGlobal();
  setTimeout(esconderNavGlobal, 500);

  document.querySelectorAll('.sidebar-item').forEach(el=>el.classList.remove('active'));

  const dashTV = document.getElementById('dash-tv');
  if(dashTV) dashTV.style.display = 'block';
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

// Dispara na hora o e-mail de follow-up semanal (task #327) ÃÂ¢ÃÂÃÂ mesma rota
// usada pelo job automÃÂÃÂ¡tico de domingo (ver server.js,
// POST /api/admin/followup-semanal), sÃÂÃÂ³ que sob demanda. Restrito a
// gerente no back-end; o botÃÂÃÂ£o em si jÃÂÃÂ¡ fica escondido no boot (ver
// DOMContentLoaded acima) pra quem nÃÂÃÂ£o ÃÂÃÂ© gerente.
async function gerarFollowUpManual(){
showToast('Gerando follow-up semanal...','info');
try{
const r = await fetch('/api/admin/followup-semanal', { method:'POST' });
const d = await r.json();
if(d.ok) showToast(`✓ Follow-up enviado (${d.processos} processo${d.processos===1?'':'s'})`,'ok');
else showToast('Erro ao gerar follow-up: '+(d.erro||''),'err');
}catch(e){ showToast('Erro de rede ao gerar follow-up: '+e.message,'err'); }
}

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// CÃÂÃÂMBIO
// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
async function carregarCambio(){
  try{
    const r = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL,CNY-BRL');
    const d = await r.json();
    // Valor bruto sem arredondar ÃÂ¢ÃÂÃÂ DÃÂÃÂ³lar Comercial (bid da AwesomeAPI)
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

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// DADOS
// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
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
      carregarNotificacoes();
      if(!silencioso) showToast(`${_processos.length} processos carregados`,'ok');
      // Deep link (task #59) ÃÂ¢ÃÂÃÂ se a pÃÂÃÂ¡gina abriu direto em /controle/UD26-005,
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

// Abre o painel de um processo pela referÃÂÃÂªncia (usado por deep link e pelo
// botÃÂÃÂ£o voltar/avanÃÂÃÂ§ar do navegador), SEM mexer no histÃÂÃÂ³rico ÃÂ¢ÃÂÃÂ quem decide
// se pushState/popstate acontece ÃÂÃÂ© sempre o chamador (abrirProcesso ou o
// listener de popstate), nunca esta funÃÂÃÂ§ÃÂÃÂ£o.
function _abrirProcessoPorReferencia(ref){
  const proc = _processos.find(p=>p.referencia===ref);
  if(!proc) return;
  _editando = {...proc, _camposIA: {}};
  _editandoOriginal = {...proc};
  renderModal();
}

// BotÃÂÃÂ£o voltar/avanÃÂÃÂ§ar do navegador ÃÂ¢ÃÂÃÂ mantÃÂÃÂ©m o painel lateral sincronizado
// com a URL (ex: abrir processo A, abrir processo B, voltar ÃÂ¢ÃÂÃÂ reabre A;
// voltar de novo ÃÂ¢ÃÂÃÂ fecha o painel e volta pra lista).
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

  // Registrar cÃÂÃÂ¢mbio USD no momento do pedido se nÃÂÃÂ£o preenchido
  if(!proc.pi_cambio && proc.pi_valor_usd && _cambio.USD){
    proc.pi_cambio = _cambio.USD;
    if(patchFields) patchFields.push('pi_cambio');
  }

  // Calcular vencimento demurrage automaticamente
  // Usa parseDataLocal (meio-dia local, T00:00:00) em vez de `new Date(string)`
  // direto — evita depender de coincidência de fuso horário nesse cálculo,
  // que tem impacto financeiro direto (multa por atraso na devolução do container).
  if(proc.data_chegada && proc.free_time){
    const chegada = parseDataLocal(proc.data_chegada);
    chegada.setDate(chegada.getDate() + parseInt(proc.free_time||0));
    proc.demurrage_vencimento = chegada.toISOString().split('T')[0];
  }

  // AvanÃÂÃÂ§ar fase automaticamente
  proc.fase = calcularFase(proc);

  // ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ CONCORRÃÂÃÂNCIA: enviar sÃÂÃÂ³ o que mudou ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
  // Se quem chamou informou patchFields (lista de campos de fato alterados
  // nesta sessÃÂÃÂ£o de ediÃÂÃÂ§ÃÂÃÂ£o), manda ao servidor sÃÂÃÂ³ esses campos + os
  // metadados/calculados de sempre ÃÂ¢ÃÂÃÂ nÃÂÃÂ£o o processo inteiro. Isso evita que
  // duas pessoas editando o mesmo processo ao mesmo tempo apaguem uma a
  // mudanÃÂÃÂ§a da outra: cada save sÃÂÃÂ³ toca nos campos que aquele usuÃÂÃÂ¡rio de
  // fato mexeu. Sem patchFields (chamada antiga/desconhecida), mantÃÂÃÂ©m o
  // comportamento de sempre ÃÂ¢ÃÂÃÂ manda o processo inteiro.
  let payload = proc;
  if(patchFields && Array.isArray(patchFields)){
    const camposFixos = ['id','referencia','fase','demurrage_vencimento','pi_cambio',
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
    // Criar notificaÃÂÃÂ§ÃÂÃÂ£o se houver alerta
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

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// FASE AUTOMÃÂÃÂTICA
// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
function calcularFase(p){
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  // "Data Chegada", "Data PresenÃÂÃÂ§a" e "Data de Embarque" sÃÂÃÂ³ contam pra
  // avanÃÂÃÂ§ar a fase se jÃÂÃÂ¡ aconteceram de fato. Se alguÃÂÃÂ©m preencher uma data
  // futura ali (comum quando o booking jÃÂÃÂ¡ traz uma previsÃÂÃÂ£o e a pessoa
  // preenche no campo errado por hÃÂÃÂ¡bito), NÃÂÃÂO trata como jÃÂÃÂ¡ embarcado/
  // desembarcado ÃÂ¢ÃÂÃÂ fica na fase anterior atÃÂÃÂ© a data realmente chegar. Use
  // os campos de previsÃÂÃÂ£o (ETD/ETA/PrevisÃÂÃÂ£o ProntidÃÂÃÂ£o) pra isso ÃÂ¢ÃÂÃÂ e na
  // prÃÂÃÂ¡tica o prÃÂÃÂ³prio formulÃÂÃÂ¡rio jÃÂÃÂ¡ move a data automaticamente pro campo
  // de previsÃÂÃÂ£o certo quando detecta uma data futura nesses campos (ver
  // moverDataFuturaParaPrevisao) ÃÂ¢ÃÂÃÂ isso aqui ÃÂÃÂ© sÃÂÃÂ³ a segunda camada de
  // proteÃÂÃÂ§ÃÂÃÂ£o, pro caso de a data chegar aqui por outro caminho (ex: leitura
  // por IA), sem depender sÃÂÃÂ³ do que roda no onchange do campo.
  const chegadaPassada  = p.data_chegada  && new Date(p.data_chegada+'T00:00:00')  <= hoje ? p.data_chegada  : null;
  const presencaPassada = p.data_presenca && new Date(p.data_presenca+'T00:00:00') <= hoje ? p.data_presenca : null;
  const embarquePassado = p.data_embarque && new Date(p.data_embarque+'T00:00:00') <= hoje ? p.data_embarque : null;

  if(p.data_devolucao_vazio)                                        return 'FINALIZADO';
  // Quando AMBAS as NFs (entrada e saÃÂÃÂ­da) estÃÂÃÂ£o emitidas, isso jÃÂÃÂ¡ ÃÂÃÂ© prova
  // suficiente de que o carregamento aconteceu de fato ÃÂ¢ÃÂÃÂ avanÃÂÃÂ§a direto para
  // DevoluÃÂÃÂ§ÃÂÃÂ£o do Vazio, mesmo sem a data_carregamento manual preenchida,
  // para jÃÂÃÂ¡ acionar o alerta de demurrage dessa etapa.
  if(p.data_carregamento || (p.nf_entrada_numero && p.nf_saida_numero)) return 'DEVOLUCAO_VAZIO';
  if(p.data_agendamento || p.nf_saida_numero || p.nf_entrada_numero) return 'CARREGAMENTO';
  if(p.data_liberacao || (p.canal==='VERDE' && p.data_parametrizacao)) return 'FATURAMENTO';
  if(p.canal || p.data_parametrizacao)                              return 'PARAMETRIZACAO';
  if(p.numero_di || p.data_registro_di)                             return 'REGISTRO_DI';
  if(presencaPassada || chegadaPassada)                             return 'DESEMBARCADO';
  // Igual ao caso do Booking acima: o NÃÂÃÂº HBL costuma ser preenchido antes
  // do embarque acontecer de fato (o armador/agente jÃÂÃÂ¡ manda o HBL com
  // antecedÃÂÃÂªncia), entÃÂÃÂ£o usar sÃÂÃÂ³ "p.hbl" aqui fazia o status pular pra
  // "Embarcado" antes da hora ÃÂ¢ÃÂÃÂ mesmo com o embarque real ainda previsto
  // pra outro dia. Agora sÃÂÃÂ³ a Data de Embarque (Efetiva) ÃÂ¢ÃÂÃÂ quando jÃÂÃÂ¡
  // passou ÃÂ¢ÃÂÃÂ conta como embarque de verdade.
  if(embarquePassado)                                               return 'EMBARCADO';
  // O status avanÃÂÃÂ§a pra "Ag. Embarque" sÃÂÃÂ³ com a PrevisÃÂÃÂ£o de Embarque (ETD)
  // preenchida ÃÂ¢ÃÂÃÂ NÃÂÃÂO mais com o NÃÂÃÂº Booking. Motivo: como o booking real
  // muitas vezes nÃÂÃÂ£o chega a tempo, o time preenche esse campo com a
  // referÃÂÃÂªncia da Royal (nÃÂÃÂ£o o booking de verdade), e o status mudava
  // prematuramente/erradamente por causa disso. O ETD ÃÂÃÂ© um dado mais
  // confiÃÂÃÂ¡vel desse ponto do processo.
  if(p.etd)                                                         return 'AGUARDANDO_EMBARQUE';
  return 'PI';
}

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// DEMURRAGE
// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
function demurrageDias(proc){
  if(!proc.demurrage_vencimento) return null;
  const venc = parseDataLocal(proc.demurrage_vencimento);
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  return Math.ceil((venc-hoje)/86400000);
}

// Processo com chegada prevista (ETA) nos prÃÂÃÂ³ximos N dias e que ainda nÃÂÃÂ£o
// desembarcou de fato (sem data_chegada preenchida ÃÂ¢ÃÂÃÂ assim que a chegada
// efetiva ÃÂÃÂ© registrada, o processo sai naturalmente deste card). Usado
// pelo card "Chegada em 7 dias" do Dashboard e pelo filtro correspondente
// na tabela ÃÂ¢ÃÂÃÂ mesma regra nos dois lugares, pra nÃÂÃÂ£o desalinhar contagem e
// lista exibida ao clicar no card.
function chegandoEmDias(proc, dias){
  if(proc.data_chegada || proc.fase==='FINALIZADO' || !proc.eta) return false;
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const limite = new Date(hoje); limite.setDate(hoje.getDate()+dias);
  const eta = new Date(proc.eta+'T00:00:00');
  return eta>=hoje && eta<=limite;
}

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// PAGAMENTOS DE PI ÃÂ¢ÃÂÃÂ fonte ÃÂÃÂºnica pro Dashboard Financeiro
// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// Um processo com forma "Entrada+Saldo" na verdade tem DUAS datas de
// vencimento e DOIS cÃÂÃÂ¢mbios diferentes ÃÂ¢ÃÂÃÂ tratar isso como "um pagamento sÃÂÃÂ³"
// (como o resto do sistema faz) esconde a parcela de Entrada inteira do
// fluxo de caixa e do controle cambial. Essa funÃÂÃÂ§ÃÂÃÂ£o "achata" cada processo
// em 1 ou 2 parcelas de pagamento individuais, cada uma jÃÂÃÂ¡ com fornecedor,
// paÃÂÃÂ­s (via porto de origem), valor, vencimento, cÃÂÃÂ¢mbio previsto/fechado e
// se jÃÂÃÂ¡ foi paga ÃÂ¢ÃÂÃÂ pra nÃÂÃÂ£o reimplementar essa lÃÂÃÂ³gica 3x (KPIs, calendÃÂÃÂ¡rio,
// cÃÂÃÂ¢mbio) de formas ligeiramente diferentes e desalinhadas entre si.
//
// "Pago" por parcela (nÃÂÃÂ£o usa sÃÂÃÂ³ o pi_pago geral do processo, que sÃÂÃÂ³ vira
// true quando TUDO foi pago):
//  - ÃÂÃÂºnica (Vista/Prazo): usa pi_pago mesmo ÃÂ¢ÃÂÃÂ ÃÂÃÂ© o ÃÂÃÂºnico pagamento do processo.
//  - entrada: considera paga se jÃÂÃÂ¡ tem cÃÂÃÂ¢mbio de entrada fechado registrado.
//  - saldo: usa pi_pago ÃÂ¢ÃÂÃÂ ÃÂÃÂ© a parcela que fecha o processo (ver confirmarCambioComo).
function listarPagamentosPI(processos){
  const pagamentos = [];
  (processos||[]).forEach(p=>{
    const valorTotal = parseFloat(p.pi_valor_usd)||0;
    if(!valorTotal || p.fase==='FINALIZADO') return;
    const base = { referencia:p.referencia, processoId:p.id, fornecedor:p.fornecedor||'—', pais:paisDoProcesso(p), moeda:'USD', cliente:p.cliente||'—' };
    if(p.pi_pagamento==='ENTRADA_SALDO'){
      const pct = parseFloat(p.pi_entrada_pct||30)/100;
      const cambioPrevisto = parseFloat(p.pi_cambio)||null;
      pagamentos.push({...base, parcela:'entrada',
        valorUsd: valorTotal*pct, vencimento: p.pi_data_entrada||null,
        cambioPrevisto, cambioFechado: parseFloat(p.pi_cambio_entrada)||null,
        pago: !!p.pi_cambio_entrada });
      pagamentos.push({...base, parcela:'saldo',
        valorUsd: valorTotal*(1-pct), vencimento: p.pi_data_saldo||null,
        cambioPrevisto, cambioFechado: parseFloat(p.pi_cambio_saldo)||null,
        pago: !!p.pi_pago });
    } else if(p.pi_pagamento==='PARCELADO'){
      // "Parcelado" (N cÃÂÃÂ¢mbios, valor fixo em USD cada) ÃÂ¢ÃÂÃÂ achata cada linha
      // de pi_parcelas_json num pagamento prÃÂÃÂ³prio, mesmo espÃÂÃÂ­rito de
      // Entrada+Saldo acima, sÃÂÃÂ³ que sem limite de 2. "Paga" por parcela usa
      // a presenÃÂÃÂ§a de cÃÂÃÂ¢mbio fechado (mesma regra da parcela "entrada"), jÃÂÃÂ¡
      // que aqui nÃÂÃÂ£o existe um pi_pago ÃÂÃÂºnico cobrindo "a ÃÂÃÂºltima parcela".
      let parcelas = [];
      try{ parcelas = p.pi_parcelas_json ? JSON.parse(p.pi_parcelas_json) : []; }catch(e){ parcelas = []; }
      parcelas.forEach((pc,i)=>{
        const v = parseFloat(pc.valor_usd)||0;
        if(!v) return;
        pagamentos.push({...base, parcela: pc.label || ('parcela '+(i+1)),
          valorUsd: v, vencimento: pc.data_vencimento||null,
          cambioPrevisto: parseFloat(p.pi_cambio)||null, cambioFechado: parseFloat(pc.cambio_fechado)||null,
          pago: !!pc.cambio_fechado });
      });
    } else if(p.pi_pagamento==='VISTA' || p.pi_pagamento==='PRAZO'){
      const vencimento = p.pi_pagamento==='PRAZO' ? p.pi_data_saldo : p.pi_data_entrada;
      pagamentos.push({...base, parcela:'unico',
        valorUsd: valorTotal, vencimento: vencimento||null,
        cambioPrevisto: parseFloat(p.pi_cambio)||null, cambioFechado: parseFloat(p.pi_cambio_fechado)||null,
        pago: !!p.pi_pago });
    }
    // Sem pi_pagamento definido ainda (processo recÃÂÃÂ©m-criado, sÃÂÃÂ³ com valor
    // da PI preenchido): nÃÂÃÂ£o dÃÂÃÂ¡ pra saber vencimento nem parcelas, mas ainda
    // conta pra ExposiÃÂÃÂ§ÃÂÃÂ£o em USD ÃÂ¢ÃÂÃÂ entra como pagamento "sem forma definida".
    else {
      pagamentos.push({...base, parcela:'indefinido',
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
  if(!p.data_chegada && !p.demurrage_vencimento) return '';
  const chegada   = parseDataLocal(p.data_chegada);
  const freeTime  = parseInt(p.free_time||21);
  const vencCalc  = chegada ? new Date(chegada) : null;
  if(vencCalc) vencCalc.setDate(chegada.getDate() + freeTime);
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
      ${chegada ? `<div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">📅 Data de chegada</span><strong>${chegada.toLocaleDateString('pt-BR')}</strong></div>` : ''}
      <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">⏱ Free time</span><strong>${freeTime} dias</strong></div>
      ${vencReal ? `<div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:6px;"><span style="color:var(--muted);">📌 Vencimento</span><strong style="color:${cor}">${vencReal.toLocaleDateString('pt-BR')}</strong></div>` : ''}
      ${statusTxt ? `<div style="margin-top:4px;padding:8px 12px;background:${dias!==null&&dias<0?'rgba(220,38,38,.08)':dias!==null&&dias<=5?'rgba(217,119,6,.08)':'rgba(22,163,74,.08)'};border-radius:6px;font-weight:600;color:${cor};">${statusIcon} ${statusTxt}</div>` : ''}
      ${p.demurrage_valor ? `<div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:6px;"><span style="color:var(--muted);">💸 Valor registrado</span><strong>R$ ${parseFloat(p.demurrage_valor).toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong></div>` : ''}
    </div>
  </div>`;
}

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// FECHAMENTO ÃÂ¢ÃÂÃÂ estimado (da cotaÃÂÃÂ§ÃÂÃÂ£o aprovada) ÃÂÃÂ real (NF Entrada/SaÃÂÃÂ­da)
// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// FunÃÂÃÂ§ÃÂÃÂ£o pura (sem DOM) que compara o que foi cotado no Calculador
// (p.estimativa_json, gravado em POST /api/calculador/cotacoes/:id/aprovar)
// com o resultado real do processo (NF SaÃÂÃÂ­da ÃÂ¢ÃÂÃÂ NF Entrada, jÃÂÃÂ¡ preenchidos
// na aba Documentos). Compara sempre contra o cenÃÂÃÂ¡rio Com S.T. (ÃÂÃÂ© o mais
// comum na prÃÂÃÂ¡tica ÃÂ¢ÃÂÃÂ resumo antigo, salvo antes dos dois cenÃÂÃÂ¡rios existirem,
// cai no faturamento genÃÂÃÂ©rico que tinha na ÃÂÃÂ©poca).
// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ CUSTOS REAIS ÃÂ¢ÃÂÃÂ apuraÃÂÃÂ§ÃÂÃÂ£o de lucro por processo, item a item ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// Mesmos grupos/campos usados no Calculador (TAXAS_CONFIG + FOB/Frete/
// Seguro/Taxa C.E. + Impostos + ComissÃÂÃÂµes) ÃÂ¢ÃÂÃÂ pra dar pra apurar o lucro
// real de QUALQUER processo, com ou sem cotaÃÂÃÂ§ÃÂÃÂ£o aprovada. `cotado(c)` lÃÂÃÂª o
// valor cotado de dentro de p.estimativa_json.custos_cotados_json (gravado
// por resumoParaLista() no calculador.html, ao salvar a cotaÃÂÃÂ§ÃÂÃÂ£o) ÃÂ¢ÃÂÃÂ usado sÃÂÃÂ³
// como REFERÃÂÃÂNCIA/ponto de partida na aba Custos Reais; o cÃÂÃÂ¡lculo do lucro
// real (ver calcularCustoRealTotal) usa exclusivamente o que estÃÂÃÂ¡ em
// p.real_json/p.real_cambio, preenchido pelo usuÃÂÃÂ¡rio no Controle.
//
// p.real_json e p.real_cambio jÃÂÃÂ¡ existem no banco (migration
// 0004_add_custos_reais_processo.sql, aplicada em produÃÂÃÂ§ÃÂÃÂ£o e no lab em
// 2026-07-19) ÃÂ¢ÃÂÃÂ a coluna foi criada antes pra essa mesma finalidade, mas o
// cÃÂÃÂ³digo que a usava nunca chegou a ser commitado. Reaproveitada aqui em vez
// de criar coluna nova. real_json guarda um valor TOTAL (jÃÂÃÂ¡ em R$ ou US$,
// conforme a unidade do item) por chave de item (ver custosReaisItensFlat) ÃÂ¢ÃÂÃÂ
// mais simples que o { fixas, usd } por-container original documentado na
// migration, e cobre tambÃÂÃÂ©m Compra/Impostos/ComissÃÂÃÂµes, nÃÂÃÂ£o sÃÂÃÂ³ as 21 taxas.
// FIX (a pedido do usuÃÂÃÂ¡rio): FOB/Frete/Seguro/Taxa C.E. e as Taxas em USD
// (destino) eram unidade:'USD' aqui ÃÂ¢ÃÂÃÂ exigia conversÃÂÃÂ£o manual toda vez que
// alguÃÂÃÂ©m abria a aba, mesmo o Calculador jÃÂÃÂ¡ parametrizando um cÃÂÃÂ¢mbio
// especÃÂÃÂ­fico pra cada um desses itens (cÃÂÃÂ¢mbio ponderado pelas parcelas pro
// FOB, cÃÂÃÂ¢mbio de abertura+2% pro Frete/Seguro/Taxas em USD, cÃÂÃÂ¢mbio ÃÂÃÂºnico da
// simulaÃÂÃÂ§ÃÂÃÂ£o pra Taxa C.E ÃÂ¢ÃÂÃÂ ver resumoParaLista() em calculador.html). Agora
// unidade:'BRL' em todos ÃÂ¢ÃÂÃÂ os valores que chegam em custos_cotados_json jÃÂÃÂ¡
// vÃÂÃÂªm convertidos pelo cÃÂÃÂ¢mbio correto de cada item, nÃÂÃÂ£o mais em dÃÂÃÂ³lar puro.
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
  // apenasPago:true = imposto nÃÂÃÂ£o tem "compra ÃÂÃÂ venda" ÃÂ¢ÃÂÃÂ ÃÂÃÂ© sÃÂÃÂ³ um valor a
  // pagar pro governo, sempre em R$, sem contrapartida cobrada do cliente
  // (diferente das taxas operacionais, que podem ter margem). A aba mostra
  // sÃÂÃÂ³ um campo "Valor a pagar", sem Cobrado/Margem nem seletor de moeda.
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
    // toggle "dump" estÃÂÃÂ¡ SIM no Calculador) ÃÂ¢ÃÂÃÂ igual aos demais impostos, sem
    // compraÃÂÃÂvenda, sÃÂÃÂ³ existe quando a cotaÃÂÃÂ§ÃÂÃÂ£o de origem teve o toggle ativo.
    { id:'antidumping', label:'Antidumping', unidade:'BRL', apenasPago:true, cotado:c=>c?.impostos?.antidumping },
  ]},
  { grupo:'Comissões', slug:'comissoes', itens:[
    { id:'comissao_br',    label:'Comissão BR (Representante)', unidade:'BRL', cotado:c=>c?.comissoes?.br },
    { id:'comissao_china', label:'Comissão China',              unidade:'BRL', cotado:c=>c?.comissoes?.china },
    { id:'comissao_boss',  label:'Comissão Boss/Lopes',         unidade:'BRL', cotado:c=>c?.comissoes?.boss },
  ]},
  // porContainer:true = no Calculador esse valor ÃÂÃÂ© POR container (r.txOp);
  // usado sÃÂÃÂ³ pra multiplicar corretamente ao calcular o "Cotado" total abaixo
  // (calcularCustoCotadoItem). Os valores REAIS lanÃÂÃÂ§ados na aba sÃÂÃÂ£o sempre o
  // TOTAL do item pro processo inteiro ÃÂ¢ÃÂÃÂ o usuÃÂÃÂ¡rio nÃÂÃÂ£o precisa multiplicar.
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
    // da importaÃÂÃÂ§ÃÂÃÂ£o) ÃÂ¢ÃÂÃÂ ÃÂÃÂ© a taxa de seguro cobrada na proposta ao cliente, que
    // compÃÂÃÂµe total_taxas/custo_total no Calculador (ver comentÃÂÃÂ¡rio em
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
    { id:'reciclagem',                label:'Reciclagem',                                unidade:'BRL', apenasPago:true, cotado:c=>null },
    { id:'despesas_baixa_patio_venda',label:'Despesas Baixa Pátio (Venda/Devolução)',    unidade:'BRL', apenasPago:true, cotado:c=>null },
    { id:'dif_seguro',                label:'Diferença de Seguro',                       unidade:'BRL', apenasPago:true, cotado:c=>null },
    { id:'timp',                      label:'Timp',                                      unidade:'BRL', apenasPago:true, cotado:c=>null },
    { id:'trademaster',               label:'Trademaster',                               unidade:'BRL', apenasPago:true, cotado:c=>null },
  ]},
];

function custosReaisItensFlat(){
  return CUSTOS_REAIS_CONFIG.flatMap(g => g.itens.map(it => ({...it, grupo:g.grupo})));
}

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ MULTI-MOEDA + QUEBRA POR CONTAINER (Pago ÃÂÃÂ Cobrado por taxa) ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// Igual ÃÂÃÂ  tela de Taxas do Conexos: cada taxa pode ter Pago e Cobrado em
// moedas diferentes (BRL/USD/EUR, cada lado com sua prÃÂÃÂ³pria moeda ÃÂ¢ÃÂÃÂ ex.:
// paga o representante em BRL, recebe do importador em USD), e quando o
// processo tem mais de um container, cada taxa "porContainer" pode ser
// detalhada container a container em vez de um valor ÃÂÃÂºnico pro processo
// inteiro. Formato salvo em real_json[item.id] (e o mesmo com sufixo
// "_cobrado"), aceita 3 formatos pra manter compatibilidade com dados jÃÂÃÂ¡
// salvos antes dessa mudanÃÂÃÂ§a:
//   nÃÂÃÂºmero puro            ÃÂ¢ÃÂÃÂ legado: valor na moeda padrÃÂÃÂ£o do item (unidade)
//   { valor, moeda }       ÃÂ¢ÃÂÃÂ valor ÃÂÃÂºnico, moeda escolhida pelo usuÃÂÃÂ¡rio
//   { porContainer:{ 'CONTAINER1':{valor,moeda}, ... } } ÃÂ¢ÃÂÃÂ detalhado
const MOEDAS_REAIS = [
  { code:'BRL', simbolo:'R$' },
  { code:'USD', simbolo:'US$' },
  { code:'EUR', simbolo:'€' },
];

// CÃÂÃÂ¢mbio de uma moeda em relaÃÂÃÂ§ÃÂÃÂ£o a R$ pra este processo. USD usa a mesma
// coluna jÃÂÃÂ¡ existente (p.real_cambio, com fallback pro cÃÂÃÂ¢mbio da PI); EUR
// nÃÂÃÂ£o tem coluna prÃÂÃÂ³pria ÃÂ¢ÃÂÃÂ pra nÃÂÃÂ£o precisar de migration nova, fica salvo
// dentro do prÃÂÃÂ³prio real_json (_cambio_eur), com fallback pro cÃÂÃÂ¢mbio do dia
// (_cambio.EUR, jÃÂÃÂ¡ buscado no boot pra barra do topo).
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

// Lista de containers do processo ÃÂ¢ÃÂÃÂ usada sÃÂÃÂ³ pra oferecer o detalhamento
// por container nas taxas "porContainer". Sem containers cadastrados (ou sÃÂÃÂ³
// 1), a taxa fica como valor ÃÂÃÂºnico, sem opÃÂÃÂ§ÃÂÃÂ£o de detalhar.
//
// Fonte da verdade: p.containers_json, o MESMO campo preenchido na tela
// "+ Adicionar Container" da aba Documentos (ver controle-campos.js,
// renderMultiContainers/sincronizarContainerLegado) ÃÂ¢ÃÂÃÂ array de
// {numero, tipo, lacre}. Antes esta funÃÂÃÂ§ÃÂÃÂ£o lia p.container (o campo texto
// legado, que sÃÂÃÂ³ guarda o nÃÂÃÂºmero do PRIMEIRO container, sincronizado
// automaticamente a partir de containers_json) ÃÂ¢ÃÂÃÂ por isso processos com
// mais de um container apareciam com sÃÂÃÂ³ 1 na aba Custos Reais. MantÃÂÃÂ©m
// fallback pro campo legado sÃÂÃÂ³ pra processos antigos que nunca chegaram a
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
// possÃÂÃÂ­veis, ver comentÃÂÃÂ¡rio acima) pro total em R$ desse item. Retorna
// null quando nÃÂÃÂ£o hÃÂÃÂ¡ nada lanÃÂÃÂ§ado.
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
  // legado: nÃÂÃÂºmero (ou string numÃÂÃÂ©rica) puro, sem objeto {valor,moeda} ÃÂ¢ÃÂÃÂ sÃÂÃÂ³
  // existe em processos criados ANTES do multi-moeda (task #159). Usa
  // unidadeLegado quando existe (itens que mudaram de padrÃÂÃÂ£o USD->BRL nesta
  // correÃÂÃÂ§ÃÂÃÂ£o ÃÂ¢ÃÂÃÂ ver comentÃÂÃÂ¡rio no topo de CUSTOS_REAIS_CONFIG) pra nÃÂÃÂ£o
  // reinterpretar retroativamente valores antigos que foram salvos em USD
  // como se jÃÂÃÂ¡ fossem BRL. Itens que sempre foram BRL nÃÂÃÂ£o tÃÂÃÂªm
  // unidadeLegado, entÃÂÃÂ£o caem direto em item.unidade (sem mudanÃÂÃÂ§a).
  const unidadeParaLegado = item.unidadeLegado || item.unidade;
  const valor = parseFloat(raw);
  if(isNaN(valor)) return null;
  const cambio = taxaCambioMoedaReal(unidadeParaLegado, p);
  return { totalBrl: unidadeParaLegado === 'BRL' ? valor : valor * (cambio || 0), count:1, moeda:unidadeParaLegado };
}

// Valor COTADO de um item, jÃÂÃÂ¡ no TOTAL do processo (multiplicado pelos
// containers quando for porContainer) ÃÂ¢ÃÂÃÂ usado sÃÂÃÂ³ pra prÃÂÃÂ©-preencher/mostrar
// como referÃÂÃÂªncia na aba Custos Reais, nunca entra direto no cÃÂÃÂ¡lculo do
// lucro real (ver calcularCustoRealTotal, que sÃÂÃÂ³ olha p.real_json).
function calcularCustoCotadoItem(item, cotado){
  if(!cotado) return null;
  const base = item.cotado(cotado);
  if(base == null) return null;
  return item.porContainer ? base * (cotado.containers || 1) : base;
}

// Soma tudo que estiver preenchido em p.real_json (valores TOTAIS, jÃÂÃÂ¡
// digitados pelo usuÃÂÃÂ¡rio na aba Custos Reais ÃÂ¢ÃÂÃÂ sem fallback automÃÂÃÂ¡tico pro
// cotado aqui; o fallback acontece sÃÂÃÂ³ visualmente, prÃÂÃÂ©-preenchendo o campo
// quando a aba abre). Itens em USD convertem pelo cÃÂÃÂ¢mbio salvo em
// p.real_cambio ou, na falta dele, pelo cÃÂÃÂ¢mbio da PI do processo. Retorna
// null quando nÃÂÃÂ£o hÃÂÃÂ¡ NENHUM custo real lanÃÂÃÂ§ado ainda ÃÂ¢ÃÂÃÂ nesse caso
// calcularFechamento() cai no cÃÂÃÂ¡lculo antigo (NF SaÃÂÃÂ­da ÃÂ¢ÃÂÃÂ NF Entrada),
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
// item (nÃÂÃÂ£o o que foi pago ao fornecedor/agente) ÃÂ¢ÃÂÃÂ guardado nas mesmas
// chaves de real_json, com sufixo "_cobrado" (ex.: reais.siscomex = pago,
// reais.siscomex_cobrado = cobrado). Isso dÃÂÃÂ¡ pra ver a margem de CADA taxa
// individualmente (compra ÃÂÃÂ venda), igual ao Conexos mostra na aba Taxas ÃÂ¢ÃÂÃÂ
// nÃÂÃÂ£o sÃÂÃÂ³ o total do processo (NF SaÃÂÃÂ­da ÃÂ¢ÃÂÃÂ Custo Real Total).
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

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ VENDAS MULTI-CLIENTE (rateio de custo) ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// Um processo (de qualquer finalidade) pode ser vendido a mais de um
// cliente ÃÂ¢ÃÂÃÂ ex.: meio contÃÂÃÂªiner pra um, meio pra outro. p.vendas_json guarda
// um array de vendas, cada uma com seu prÃÂÃÂ³prio cliente, NF SaÃÂÃÂ­da e a
// quantidade que levou de cada item. Quando existe pelo menos uma venda
// cadastrada, o Lucro Real deixa de ser um nÃÂÃÂºmero ÃÂÃÂºnico do processo (NF
// SaÃÂÃÂ­da ÃÂ¢ÃÂÃÂ Custo Real Total) e passa a ser calculado VENDA A VENDA: cada
// custo real lanÃÂÃÂ§ado na aba Custos Reais ÃÂÃÂ© rateado proporcionalmente ÃÂÃÂ 
// quantidade que aquela venda levou (sobre a quantidade total de produtos do
// processo, ver totalQuantidadeProdutos), e alguns custos podem ser
// lanÃÂÃÂ§ados DIRETO numa venda especÃÂÃÂ­fica (custos_diretos), sem entrar no
// rateio ÃÂ¢ÃÂÃÂ ex.: um frete rodoviÃÂÃÂ¡rio que sÃÂÃÂ³ existiu porque aquele cliente
// pediu entrega em outra cidade.
// Sem nenhuma venda cadastrada (vendas_json vazio/null), calcularFechamento
// continua exatamente como antes ÃÂ¢ÃÂÃÂ 100% retrocompatÃÂÃÂ­vel com todo processo
// jÃÂÃÂ¡ cadastrado.

// Soma a quantidade de todos os itens em produtos_json ÃÂ¢ÃÂÃÂ ÃÂÃÂ© o "tamanho
// total" do processo (ex.: 1400 pneus), denominador do rateio.
function totalQuantidadeProdutos(p){
  if(!p || !p.produtos_json) return 0;
  try{
    const produtos = JSON.parse(p.produtos_json);
    if(!Array.isArray(produtos)) return 0;
    return produtos.reduce((s,it)=> s + (parseFloat(it.quantidade)||0), 0);
  }catch(e){ return 0; }
}

// LÃÂÃÂª e normaliza p.vendas_json ÃÂ¢ÃÂÃÂ nunca lanÃÂÃÂ§a, sempre devolve array (vazio
// se nÃÂÃÂ£o houver nada salvo ou o JSON estiver corrompido).
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

// Soma dos custos diretos (nÃÂÃÂ£o-rateados) de uma venda ÃÂ¢ÃÂÃÂ cada um jÃÂÃÂ¡ ÃÂÃÂ© um
// valor TOTAL em R$, lanÃÂÃÂ§ado manualmente (ex.: "Frete RodoviÃÂÃÂ¡rio Extra").
function custosDiretosVenda(venda){
  return (venda.custos_diretos||[]).reduce((s,c)=> s + (parseFloat(c.valor)||0), 0);
}

// Rateia o Custo Real Total do processo por uma venda especÃÂÃÂ­fica,
// proporcional ÃÂÃÂ  quantidade que ela levou, e soma os custos diretos dela
// por cima (esses nÃÂÃÂ£o sÃÂÃÂ£o rateados ÃÂ¢ÃÂÃÂ sÃÂÃÂ£o sÃÂÃÂ³ dessa venda).
function calcularRateioVenda(p, venda, custoRealTotal){
  const totalQtd = totalQuantidadeProdutos(p);
  const qtdVenda = quantidadeVenda(venda);
  const fracao = totalQtd > 0 ? (qtdVenda / totalQtd) : 0;
  const custoRateado = (custoRealTotal||0) * fracao;
  const custoDireto = custosDiretosVenda(venda);
  return { totalQtd, qtdVenda, fracao, custoRateado, custoDireto, custoTotal: custoRateado + custoDireto };
}

// Lucro de uma venda especÃÂÃÂ­fica: NF SaÃÂÃÂ­da DELA (nÃÂÃÂ£o do processo) ÃÂ¢ÃÂÃÂ a fatia
// de custo que lhe cabe (rateado + direto). null quando a venda ainda nÃÂÃÂ£o
// tem NF SaÃÂÃÂ­da lanÃÂÃÂ§ada (mesma convenÃÂÃÂ§ÃÂÃÂ£o do Lucro Real do processo inteiro).
function calcularLucroVenda(p, venda, custoRealTotal){
  const rateio = calcularRateioVenda(p, venda, custoRealTotal);
  const nfSaida = parseFloat(venda.nf_saida_valor);
  const temNf = !isNaN(nfSaida) && nfSaida > 0;
  const lucro = temNf ? (nfSaida - rateio.custoTotal) : null;
  const pctLucro = (temNf && lucro != null && nfSaida > 0) ? (lucro / nfSaida) : null;
  return { ...rateio, nfSaida: temNf?nfSaida:null, temNf, lucro, pctLucro };
}

// Ajusta uma lista de valores fracionÃÂÃÂ¡rios (em R$) que deveriam somar
// "totalAlvo" pra somarem EXATAMENTE isso atÃÂÃÂ© o centavo ÃÂ¢ÃÂÃÂ mÃÂÃÂ©todo do maior
// resto (largest remainder / Hamilton), o mesmo usado pra distribuir
// cadeiras em sistemas proporcionais. Sem isso, ratear R$100.000,00 em 3
// partes de 33.333,33... e converter cada uma pra centavos pode deixar 1-2
// centavos "perdidos" ou "sobrando" que nunca aparecem em lugar nenhum ÃÂ¢ÃÂÃÂ
// pequeno, mas incomoda numa tela financeira onde a soma devia bater exato.
function arredondarComRestoExato(valores, totalAlvo){
  const totalCentavosAlvo = Math.round((totalAlvo||0) * 100);
  const centavosBase = valores.map(v => Math.floor((v||0) * 100));
  const somaBase = centavosBase.reduce((s,c)=> s+c, 0);
  let restante = totalCentavosAlvo - somaBase;
  // Distribui o restante (positivo ou negativo) 1 centavo de cada vez,
  // priorizando quem tem a maior parte fracionÃÂÃÂ¡ria "perdida" no floor.
  const ordem = valores
    .map((v,i)=>({ i, frac: (v||0)*100 - Math.floor((v||0)*100) }))
    .sort((a,b)=> b.frac - a.frac);
  const resultado = [...centavosBase];
  for(let k=0; k<ordem.length && restante>0; k++){ resultado[ordem[k].i] += 1; restante--; }
  for(let k=ordem.length-1; k>=0 && restante<0; k--){ resultado[ordem[k].i] -= 1; restante++; }
  return resultado.map(c => c/100);
}

// Resumo agregado de todas as vendas de um processo ÃÂ¢ÃÂÃÂ null quando nÃÂÃÂ£o hÃÂÃÂ¡
// nenhuma venda cadastrada (processo continua no modelo antigo, 1 NF SaÃÂÃÂ­da
// ÃÂÃÂºnica pro processo inteiro).
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

  // CorreÃÂÃÂ§ÃÂÃÂ£o de arredondamento (maior resto): sÃÂÃÂ³ faz sentido quando o
  // processo estÃÂÃÂ¡ 100% alocado entre as vendas (senÃÂÃÂ£o a soma parcial dos
  // custos rateados ÃÂÃÂ o comportamento correto ÃÂ¢ÃÂÃÂ ver saldoNaoAlocado) e
  // quando hÃÂÃÂ¡ mais de 1 venda (com 1 venda sÃÂÃÂ³ nÃÂÃÂ£o existe erro de soma pra
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

  // Custo real detalhado (aba "Custos Reais") ÃÂ¢ÃÂÃÂ quando o processo tem pelo
  // menos um item lanÃÂÃÂ§ado ali, ele ÃÂÃÂ© MAIS PRECISO que o cÃÂÃÂ¡lculo grosseiro
  // NF SaÃÂÃÂ­da ÃÂ¢ÃÂÃÂ NF Entrada (que ignora frete, seguro, impostos, comissÃÂÃÂµes e
  // taxas operacionais ÃÂ¢ÃÂÃÂ cada processo tem uma combinaÃÂÃÂ§ÃÂÃÂ£o diferente do que
  // teve ou nÃÂÃÂ£o). Sem nenhum item lanÃÂÃÂ§ado, mantÃÂÃÂ©m o cÃÂÃÂ¡lculo antigo por NF.
  const custosReais = calcularCustoRealTotal(p);
  const custoRealTotal = custosReais ? custosReais.total : null;
  // Margem por taxa (compra ÃÂÃÂ venda) ÃÂ¢ÃÂÃÂ sÃÂÃÂ³ existe quando o usuÃÂÃÂ¡rio tambÃÂÃÂ©m
  // lanÃÂÃÂ§ou valores "cobrado do cliente" na aba Custos Reais, nÃÂÃÂ£o ÃÂÃÂ©
  // obrigatÃÂÃÂ³rio preencher. Independente do Lucro Real (que usa a NF SaÃÂÃÂ­da
  // inteira); esta ÃÂÃÂ© uma visÃÂÃÂ£o ÃÂÃÂ  parte, item a item, das taxas especÃÂÃÂ­ficas.
  const receitaReais = calcularReceitaRealTotal(p);
  const margemTaxas = (custosReais && receitaReais)
    ? { total: receitaReais.total - custosReais.total, custoTotal: custosReais.total, receitaTotal: receitaReais.total }
    : null;

  // Vendas multi-cliente (rateio de custo) ÃÂ¢ÃÂÃÂ quando o processo foi vendido
  // a mais de um cliente (ver calcularVendasResumo acima), o Lucro Real do
  // processo vira a SOMA do lucro de cada venda (NF dela ÃÂ¢ÃÂÃÂ sua fatia de
  // custo), e a "NF SaÃÂÃÂ­da" do processo vira a soma das NFs de cada venda.
  // Sem nenhuma venda cadastrada, cai exatamente no cÃÂÃÂ¡lculo antigo abaixo.
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
  const notasBoss = calcularNotasBoss(p);
  if(notasBoss && lucroReal != null){
    lucroReal = lucroReal + notasBoss.totalReceber;
    const denomComBoss = (nfSaida||0) + notasBoss.valorBoss;
    pctLucroReal = denomComBoss > 0 ? (lucroReal / denomComBoss) : null;
  }

  let custoEstimado = null, faturamentoEstimado = null, lucroEstimado = null, pctLucroEstimado = null;
  if(est){
    custoEstimado = est.custo_total ?? null;
    if(est.cenarios && est.cenarios.com_st && est.cenarios.com_st.faturamento_total != null){
      faturamentoEstimado = est.cenarios.com_st.faturamento_total;
    } else if(est.faturamento != null){
      faturamentoEstimado = est.faturamento; // cotações salvas antes dos 2 cenários
    }
    if(faturamentoEstimado != null && custoEstimado != null){
      lucroEstimado = faturamentoEstimado - custoEstimado;
      pctLucroEstimado = faturamentoEstimado > 0 ? (lucroEstimado / faturamentoEstimado) : null;
    } else if(est.lucro_bruto != null){
      lucroEstimado = est.lucro_bruto;
      pctLucroEstimado = est.pct_lucro ?? null;
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
      return `<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0;color:var(--muted);">
        <span>${esc(it.label)}</span>
        <span style="display:flex;gap:10px;"><span>${r2(it.valorBrl)}</span>${cobrado?`<span style="color:var(--dim);">/ ${r2(cobrado.valorBrl)}</span>`:''}</span>
      </div>`;
    }).join('');
    return `<details style="margin-bottom:6px;">
      <summary style="cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;padding:6px 8px;background:var(--card);border:1px solid var(--border);border-radius:var(--r-sm);font-size:12px;">
        <span style="font-weight:700;color:var(--text);">${esc(g.grupo)}</span>
        <span style="display:flex;gap:12px;align-items:center;">
          <span style="color:var(--muted);">${r2(g.totalPago)}</span>
          ${g.margem!=null?`<strong style="color:${g.margem>=0?'var(--ok)':'var(--err)'};font-size:11px;">${g.margem>=0?'+':''}${r2(g.margem)}</strong>`:''}${g.totalCredito>0?`<span style="color:var(--ok);font-size:10px;" title="Impostos pagos na importacao (IPI/PIS/COFINS/ICMS) que geram credito tributario a compensar - nao e margem/lucro nem prejuizo">Credito impostos: ${r2(g.totalCredito)}</span>`:''}
        </span>
      </summary>
      <div style="padding:6px 10px 2px 10px;">${detalheItens||'<span style="font-size:11px;color:var(--dim);">sem itens lançados</span>'}</div>
    </details>`;
  }).join('');

  return `<div>
    <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">🧮 Custos Reais — detalhado por grupo</div>
    ${linhasGrupo || '<div style="font-size:12px;color:var(--dim);">Nenhum custo lançado na aba Custos Reais ainda.</div>'}
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
    return `<div style="display:flex;justify-content:space-between;font-size:11px;padding:3px 0;border-bottom:1px dashed var(--border);">
      <span style="color:var(--muted);">${esc(pc.label||'Parcela')} <span style="color:var(--dim);">(${data})</span></span>
      <span style="display:flex;gap:10px;"><span>US$ ${usd.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}</span><span style="color:var(--dim);">@ ${cambio?cambio.toFixed(4):'—'}</span><strong>${r2(brl)}</strong></span>
    </div>`;
  }).join('');
  return `<div>
    <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">💱 Parcelas × Câmbio Fechado</div>
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
  const linhas = pontos.map(pt => `<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0;">
      <span style="color:var(--muted);">${pt.label}</span>
      <strong style="color:${pt.data?'var(--text)':'var(--dim)'};">${pt.data?parseDataLocal(pt.data).toLocaleDateString('pt-BR'):'—'}</strong>
    </div>`).join('');
  return `<div>
    <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">📅 Timeline</div>
    ${linhas}
    ${(rotaDias!=null || totalDias!=null) ? `<div style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--border);display:flex;gap:14px;font-size:11px;color:var(--muted);">
      ${rotaDias!=null?`<span>Rota: <strong style="color:var(--text);">${rotaDias}d</strong></span>`:''}
      ${totalDias!=null?`<span>Total: <strong style="color:var(--text);">${totalDias}d</strong> (${(totalDias/30.44).toFixed(1)} meses)</span>`:''}
    </div>` : ''}
  </div>`;
}

function renderFechamentoInfo(p){
  const f = calcularFechamento(p);
  const r2 = v => v==null ? '—' : `R$ ${v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const pct2 = v => v==null ? '—' : `${(v*100).toFixed(1)}%`;

  // Antes: sem estimativa_json (processo que não passou pela cotação do
  // Calculador) a função parava aqui e nunca mostrava nada — nem o lucro
  // real, mesmo com NF Entrada e NF Saída já preenchidas na aba Documentos.
  // Ou seja, processo criado direto no Controle nunca tinha como saber a
  // margem, mesmo depois de fechado. Agora só cai nesse aviso quando NÃO
  // há estimativa E também não há NF Saída ainda — nesse caso não tem
  // mesmo nada pra mostrar.
  if(!f.temEstimativa && !f.temReal){
    return `<div style="background:rgba(0,0,0,.03);border:1px solid var(--border);border-radius:10px;padding:16px;text-align:center;color:var(--muted);font-size:12px;">
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
  const linhaMargemTaxas = f.margemTaxas
    ? `<div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);">
        <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Cobrado do Cliente nas Taxas (${f.receitaReais.count} ${f.receitaReais.count===1?'item':'itens'})</span><strong>${r2(f.margemTaxas.receitaTotal)}</strong></div>
        <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Margem das Taxas (Cobrado − Pago)</span><strong style="color:${f.margemTaxas.total>=0?'var(--ok)':'var(--err)'}">${r2(f.margemTaxas.total)}</strong></div>
      </div>`
    : '';
  const linhaVendas = f.vendasResumo
    ? `<div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);">
        <div style="font-size:11px;font-weight:700;color:var(--text);margin-bottom:6px;">🧾 Vendido a ${f.vendasResumo.linhas.length} cliente${f.vendasResumo.linhas.length===1?'':'s'} (ver aba Vendas)</div>
        ${f.vendasResumo.linhas.map(l=>`<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0;"><span style="color:var(--muted);">${esc(l.venda.cliente||'(sem cliente)')}</span><strong style="color:${l.lucro==null?'var(--muted)':l.lucro>=0?'var(--ok)':'var(--err)'}">${l.temNf?r2(l.lucro):'aguardando NF'}</strong></div>`).join('')}
      </div>`
    : '';
  const linhaNotasBoss = f.notasBoss
    ? `<div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);">
        <div style="font-size:11px;font-weight:700;color:var(--text);margin-bottom:6px;">🧾 Notas Fiscais BOSS</div>
        <div style="display:flex;justify-content:space-between;font-size:11px;"><span style="color:var(--muted);">Valor das Notas Boss</span><strong>${r2(f.notasBoss.valorBoss)}</strong></div>
        <div style="display:flex;justify-content:space-between;font-size:11px;"><span style="color:var(--muted);">Impostos (IR+ISS+PIS+COFINS+IRPJ+CSLL)</span><strong style="color:var(--err);">− ${r2(f.notasBoss.irRetido+f.notasBoss.iss+f.notasBoss.pis+f.notasBoss.cofins+f.notasBoss.irpj+f.notasBoss.csll)}</strong></div>
        <div style="display:flex;justify-content:space-between;font-size:11px;"><span style="color:var(--muted);">Total a Receber (somado ao Lucro Real)</span><strong style="color:var(--ok);">${r2(f.notasBoss.totalReceber)}</strong></div>
      </div>`
    : '';
  const linhaReal = f.temReal
    ? `${linhaCustoRealDetalhado}<div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Lucro Real${f.custosReais?' (NF Saída − Custo Real Total)':' (NF Saída − NF Entrada)'}${f.notasBoss?' + Notas Boss':''}</span><strong>${r2(f.lucroReal)} <span style="color:var(--muted);font-weight:400;">(${pct2(f.pctLucroReal)})</span></strong></div>${linhaNotasBoss}`
    : `${linhaCustoRealDetalhado}<div style="color:var(--muted);font-size:12px;">Ainda não há NF Saída lançada — preencha NF Entrada e NF Saída na aba Documentos pra ver o resultado real aqui.</div>`;

  const corDelta = f.deltaValor==null ? 'var(--muted)' : f.deltaValor >= 0 ? 'var(--ok)' : 'var(--err)';
  const linhaDelta = f.temComparacao
    ? `<div style="margin-top:8px;padding:8px 10px;background:${f.deltaValor>=0?'rgba(22,163,74,.08)':'rgba(220,38,38,.08)'};border-radius:8px;font-weight:700;color:${corDelta};display:flex;justify-content:space-between;font-size:12px;">
        <span>${f.deltaValor>=0?'📈 Rendeu a mais que o cotado':'📉 Rendeu a menos que o cotado'}</span>
        <span>${f.deltaValor>=0?'+':''}${r2(f.deltaValor)}</span>
      </div>`
    : '';

  const blocoEstimado = f.temEstimativa
    ? `<div style="font-size:11px;font-weight:700;color:var(--text);margin-bottom:8px;">📐 Estimado na cotação</div>
    <div style="display:flex;flex-direction:column;gap:4px;font-size:12px;margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Custo Total estimado</span><strong>${r2(f.custoEstimado)}</strong></div>
      <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Faturamento estimado (Com S.T.)</span><strong>${r2(f.faturamentoEstimado)}</strong></div>
      <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:4px;"><span style="color:var(--muted);">Lucro estimado</span><strong>${r2(f.lucroEstimado)} <span style="color:var(--muted);font-weight:400;">(${pct2(f.pctLucroEstimado)})</span></strong></div>
    </div>`
    : `<div style="background:rgba(0,0,0,.03);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:11px;color:var(--muted);margin-bottom:10px;">
      Este processo não passou pela cotação do Calculador — sem valor estimado pra comparar.
    </div>`;

  // Stat strip — 4 KPIs de relance no topo (evita ter que ler o resto pra
  // saber se o processo deu lucro, igual olhar o G58 da planilha direto).
  const kpiLucro = f.temReal ? f.lucroReal : null;
  const kpiPct = f.temReal ? f.pctLucroReal : null;
  const statStrip = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:12px;">
    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r-md);padding:10px 12px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.03em;margin-bottom:3px;">NF Entrada</div>
      <div style="font-size:15px;font-weight:700;color:var(--text);">${r2(f.nfEntrada)}</div>
    </div>
    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r-md);padding:10px 12px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.03em;margin-bottom:3px;">NF Saída${f.vendasResumo?' (soma das vendas)':''}</div>
      <div style="font-size:15px;font-weight:700;color:var(--text);">${r2(f.nfSaida)}</div>
    </div>
    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r-md);padding:10px 12px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.03em;margin-bottom:3px;">Custo Real Total</div>
      <div style="font-size:15px;font-weight:700;color:var(--text);">${r2(f.custoRealTotal)}</div>
    </div>
    <div style="background:${kpiLucro==null?'var(--card)':kpiLucro>=0?'var(--ok-bg)':'var(--err-bg)'};border:1px solid ${kpiLucro==null?'var(--border)':kpiLucro>=0?'var(--ok)':'var(--err)'};border-radius:var(--r-md);padding:10px 12px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.03em;margin-bottom:3px;">Lucro Real</div>
      <div style="font-size:15px;font-weight:700;color:${kpiLucro==null?'var(--muted)':kpiLucro>=0?'var(--ok)':'var(--err)'};">${r2(kpiLucro)} <span style="font-size:11px;font-weight:400;">${kpiPct!=null?`(${pct2(kpiPct)})`:''}</span></div>
    </div>
  </div>`;

  const colunaEsquerda = `
    ${blocoEstimado}
    <div style="font-size:11px;font-weight:700;color:var(--text);margin-bottom:8px;">✅ Resultado real</div>
    <div style="display:flex;flex-direction:column;gap:4px;font-size:12px;">
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
      <div>${blocosDireita || '<div style="font-size:12px;color:var(--dim);">Sem detalhamento adicional (custos por grupo, parcelas ou timeline) lançado ainda.</div>'}</div>
    </div>
  </div>`;
}


// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// ALERTAS E NOTIFICAÃÂÃÂÃÂÃÂES
// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
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

  // Alerta ETA: ETA passou e processo ainda estÃÂÃÂ¡ Embarcado
  if(proc.eta && proc.fase === 'EMBARCADO'){
    const eta = parseDataLocal(proc.eta);
    const diff = Math.ceil((hoje - eta)/86400000);
    if(diff > 0){
      alertas.push({tipo:'alerta', titulo:`ETA vencido: ${proc.referencia}`, mensagem:`ETA era ${eta.toLocaleDateString('pt-BR')} — processo ainda Embarcado. Verificar chegada.`});
    }
  }

  // Alerta ETA prÃÂÃÂ³ximo (2 dias)
  if(proc.eta && proc.fase === 'EMBARCADO'){
    const eta = parseDataLocal(proc.eta);
    const diff = Math.ceil((eta - hoje)/86400000);
    if(diff >= 0 && diff <= 2){
      alertas.push({tipo:'info', titulo:`ETA em ${diff === 0 ? 'hoje' : diff + 'd'}: ${proc.referencia}`, mensagem:`Navio previsto para ${eta.toLocaleDateString('pt-BR')}.`});
    }
  }

  // Alerta PI vencimento (prazo pagamento nos prÃÂÃÂ³ximos 5 dias)
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

  if(criarNotif && alertas.length){
    alertas.forEach(a => criarNotificacao(proc.id, a.tipo, a.titulo, a.mensagem));
  }
  return alertas;
}

// Cache em memÃÂÃÂ³ria das notificaÃÂÃÂ§ÃÂÃÂµes jÃÂÃÂ¡ carregadas nesta sessÃÂÃÂ£o, usado sÃÂÃÂ³
// para evitar duplicatas ÃÂ¢ÃÂÃÂ nÃÂÃÂ£o substitui carregarNotificacoes().
let _notifsCache = [];

async function criarNotificacao(processoId, tipo, titulo, mensagem){
  // Evita criar a mesma notificaÃÂÃÂ§ÃÂÃÂ£o de novo a cada save do processo: se jÃÂÃÂ¡
  // existe uma notificaÃÂÃÂ§ÃÂÃÂ£o idÃÂÃÂªntica (mesmo processo + mesmo tÃÂÃÂ­tulo) criada
  // nas ÃÂÃÂºltimas 24h, nÃÂÃÂ£o cria outra. Sem isso, salvar o processo vÃÂÃÂ¡rias
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

// Clicar numa notificaÃÂÃÂ§ÃÂÃÂ£o deve marcÃÂÃÂ¡-la como lida E abrir o processo que ela
// se refere ÃÂ¢ÃÂÃÂ antes sÃÂÃÂ³ marcava como lida, sem nenhuma forma de chegar ao
// processo a partir da notificaÃÂÃÂ§ÃÂÃÂ£o (era preciso buscar manualmente na lista).
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

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// RENDER
// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// RÃÂÃÂ³tulos amigÃÂÃÂ¡veis para os filtros financeiros especiais (usados pelos
// cards clicÃÂÃÂ¡veis do Dashboard) ÃÂ¢ÃÂÃÂ sem isso, o usuÃÂÃÂ¡rio nÃÂÃÂ£o tem como saber
// qual filtro estÃÂÃÂ¡ ativo depois de clicar num card e ir para a tabela.
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
    FASES.map(f=>`<div class="fase-pill ${_faseFilter===f.id?'active':''}" onclick="setFaseFilter('${f.id}')">${f.icon} ${f.label}</div>`).join('');
}

// Fecha todos os dashboards (Executivo, Financeiro, Resultado, NarcÃÂÃÂ©lio,
// Carregamento) e desmarca seus itens no menu lateral. Chamado ao trocar
// de aba/fase ou ao abrir outro dashboard, para a tela trocar de fato em
// vez de empilhar dashboard + tabela (ou dois dashboards ao mesmo tempo).
function fecharTodosDashboards(){
  ['executivo','financeiro','resultado','narcelio','carregamento','tv'].forEach(function(id){
    var el = document.getElementById('dash-'+id);
    if(el) el.style.display = 'none';
    var menu = document.getElementById('menu-'+id);
    if(menu) menu.classList.remove('active');
  });

document.querySelector('.table-wrap') && (document.querySelector('.table-wrap').style.display = '');
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

// Usada pelos cards clicÃÂÃÂ¡veis do Dashboard Executivo/Financeiro: fecha o
// dashboard que estiver aberto e mostra a tabela principal jÃÂÃÂ¡ filtrada,
// para o usuÃÂÃÂ¡rio poder ver e agir diretamente nos processos daquele nÃÂÃÂºmero
// (em vez do card ser sÃÂÃÂ³ um nÃÂÃÂºmero estÃÂÃÂ¡tico no topo).
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
  const total = _processos.length;
  const emAndamento = _processos.filter(p => p.fase !== 'FINALIZADO').length;
  const finalizados = _processos.filter(p => p.fase === 'FINALIZADO').length;
  // Mantido para o badge "Com alertas" da sidebar (o card do topo agora
  // mostra "Chegada em 7d" no lugar, mas o item do menu lateral continua).
  const comAlerta = _processos.filter(p => verificarAlertas(p,false).length > 0).length;
  // Demurrage crÃÂÃÂ­tico
  const demurCrit = _processos.filter(p => { const d=demurrageDias(p); return d!==null&&d<=5&&!p.data_devolucao_vazio; }).length;
  const chegando7d = _processos.filter(p => chegandoEmDias(p,7)).length;

  const refsDuplicadas = (() => {
const norm = s => (s||'').toString().trim().toUpperCase().replace(/\s+/g,'');
const cont = {};
_processos.forEach(p => { const r = norm(p.referencia); if(r) cont[r]=(cont[r]||0)+1; });
return _processos.filter(p => cont[norm(p.referencia)] > 1).length;
})();

const stats = [
    {num:total,       label:'Total',          cor:'var(--ac)',  filtro:''},
    {num:emAndamento, label:'Em andamento',    cor:'var(--warn)',filtro:'__andamento'},
    {num:chegando7d,  label:'Chegada em 7d',  cor:'var(--info)',filtro:'__chegada_7d'},
    {num:demurCrit,   label:'Demurrage ≤5d',  cor:'var(--err)', filtro:'__demur'},
    {num:finalizados, label:'Finalizados',     cor:'var(--ok)',  filtro:'FINALIZADO'},
  ];
if (refsDuplicadas > 0) stats.push({num:refsDuplicadas, label:'Referência duplicada', cor:'var(--err)', filtro:'__ref_duplicada'});

  // Badges sidebar por fase
  const faseCount = {};
  _processos.forEach(p=>{ faseCount[p.fase] = (faseCount[p.fase]||0)+1; });
  ['PI','AGUARDANDO_EMBARQUE','EMBARCADO','DESEMBARCADO','REGISTRO_DI',
   'PARAMETRIZACAO','CARREGAMENTO','FATURAMENTO','DEVOLUCAO_VAZIO','FINALIZADO'].forEach(f=>{
    const el = document.getElementById('sb-'+f);
    if(!el) return;
    const n = faseCount[f]||0;
    el.textContent = n;
    el.style.display = n > 0 ? 'inline' : 'none';
  });
  const badgeAlerta = document.getElementById('badge-alertas');
  if(badgeAlerta){ badgeAlerta.textContent=comAlerta; badgeAlerta.style.display=comAlerta>0?'block':'none'; }
  const cancelados = _processos.filter(p=>!!p.cancelado).length;
  const badgeCancelados = document.getElementById('badge-cancelados');
  if(badgeCancelados){ badgeCancelados.textContent=cancelados; badgeCancelados.style.display=cancelados>0?'block':'none'; }
  const solicitacoesCancelamento = _processos.filter(p=>!!p.cancelamento_solicitado && !p.cancelado).length;
  const badgeSolicCancelamento = document.getElementById('badge-solicitacoes-cancelamento');
  if(badgeSolicCancelamento){ badgeSolicCancelamento.textContent=solicitacoesCancelamento; badgeSolicCancelamento.style.display=solicitacoesCancelamento>0?'block':'none'; }
  document.getElementById('badge-total').textContent = total;

  el.innerHTML = stats.map(s=>`
    <div class="stat-card" onclick="setFaseFilter('${s.filtro}')">
      <div class="stat-num" style="color:${s.cor}">${s.num}</div>
      <div class="stat-label">${s.label}</div>
    </div>`).join('');
}

// Mapa de filtros especiais por "fase" virtual (chaves comeÃÂÃÂ§ando com "__",
// usadas pelos cards clicÃÂÃÂ¡veis dos dashboards Executivo/Financeiro). Cada
// funÃÂÃÂ§ÃÂÃÂ£o recebe a lista jÃÂÃÂ¡ filtrada por busca/data e devolve a lista final.
// Antes isso era uma cadeia crescente de if/else (uma comparaÃÂÃÂ§ÃÂÃÂ£o de string
// atrÃÂÃÂ¡s da outra) ÃÂ¢ÃÂÃÂ um mapa deixa mais fÃÂÃÂ¡cil ver todos os filtros disponÃÂÃÂ­veis
// de uma vez, e adicionar um novo sem alterar uma cadeia gigante.
const FILTROS_FASE_ESPECIAIS = {
  __alertas:    lista => lista.filter(p=>verificarAlertas(p,false).length>0),
  __cancelados: lista => lista.filter(p=>!!p.cancelado),
  __cancelamento_solicitado: lista => lista.filter(p=>!!p.cancelamento_solicitado && !p.cancelado),
  __andamento:  lista => lista.filter(p=>p.fase!=='FINALIZADO'),
  __demur:      lista => lista.filter(p=>{ const d=demurrageDias(p); return d!==null&&d<=5&&!p.data_devolucao_vazio; }),
  __chegada_7d: lista => lista.filter(p=>chegandoEmDias(p,7)),
__ref_duplicada: lista => {
const norm = s => (s||'').toString().trim().toUpperCase().replace(/\s+/g,'');
const cont = {};
lista.forEach(p => { const r = norm(p.referencia); if(r) cont[r]=(cont[r]||0)+1; });
return lista.filter(p => cont[norm(p.referencia)] > 1);
},
  // Filtros financeiros ÃÂ¢ÃÂÃÂ usados pelos cards clicÃÂÃÂ¡veis do Dashboard Financeiro/Executivo
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
  // Capital parado em estoque/trÃÂÃÂ¢nsito ÃÂ¢ÃÂÃÂ usado pelo card do Dashboard
  // Financeiro (v2): jÃÂÃÂ¡ pago integralmente, mas o processo ainda nÃÂÃÂ£o foi
  // finalizado (mercadoria ainda nÃÂÃÂ£o virou venda concluÃÂÃÂ­da).
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

  // Filtro por pendÃÂÃÂªncia de revisÃÂÃÂ£o
  const filtroPendencia = document.getElementById('filtro-pendencia')?.checked;
  if(filtroPendencia) lista = lista.filter(p=>!!p.pendencia_revisao);

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
      const fase = FASES.find(f=>f.id===p.fase)||FASES[0];
      const etaDate = p.eta ? parseDataLocal(p.eta).toLocaleDateString('pt-BR') : '—';
      const chegadaDate = p.data_chegada ? parseDataLocal(p.data_chegada).toLocaleDateString('pt-BR') : '';
      const dataDisplay = chegadaDate || etaDate;
      const finBadge = p.pi_pagamento ? `<span class="fin-badge fin-${p.pi_pagamento}">${p.pi_pagamento==='ENTRADA_SALDO'?'ENT+SLD':p.pi_pagamento}</span>` : '—';
      const finalidadeLabel = {IMPORTACAO_DIRETA:'Direto', ENCOMENDA:'Encomenda', CONTA_E_ORDEM:'Conta e Ordem'}[p.finalidade] || '';
      const finalidadeBadge = finalidadeLabel ? `<span style="font-size:9px;font-weight:700;background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:1px 5px;margin-left:4px;color:var(--muted);">${finalidadeLabel}</span>` : '';
      const pendenciaBadge = p.pendencia_revisao ? `<span title="${esc(p.pendencia_revisao).replace(/"/g,'&quot;')}" style="font-size:10px;font-weight:700;background:rgba(243,156,18,.15);border:1px solid rgba(243,156,18,.4);border-radius:4px;padding:1px 6px;margin-left:4px;color:#f39c12;">⚠ Revisar</span>` : '';
      // referencia/fornecedor sÃÂÃÂ£o texto livre (fornecedor ÃÂÃÂ s vezes vem de
      // extraÃÂÃÂ§ÃÂÃÂ£o por IA de documento externo) ÃÂ¢ÃÂÃÂ escapar sempre antes de
      // colocar em innerHTML, senÃÂÃÂ£o um valor malicioso/malformado vira HTML
      // executÃÂÃÂ¡vel pra QUALQUER usuÃÂÃÂ¡rio que abrir esta lista (XSS
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
            <span class="fase-badge fase-${p.fase}">${fase.icon} ${fase.label}</span>
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

  // PaginaÃÂÃÂ§ÃÂÃÂ£o
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

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// MODAL ÃÂ¢ÃÂÃÂ ABRIR / NOVO
// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
