// ════════════════════════════════════════════════════════════════
// IMPAK CHAT — Janela flutuante de IA (injetado em todos os módulos)
// ════════════════════════════════════════════════════════════════
(function() {
// Evitar duplicata
if (document.getElementById('impak-chat-root')) return;

// Em processos.html o <script src="/chat.js"> está no <head>, então
// document.body ainda não existe quando este arquivo roda — isso
// derrubava tudo com "Cannot read properties of null (reading
// 'insertBefore')" e a nav global nunca aparecia nessa tela. Em vez de
// depender de cada página incluir o script no lugar certo, este script
// agora adia a própria execução até o body existir (funciona tanto
// quando incluído no <head> quanto no fim do <body>, como já era o
// caso nas outras telas).
if (!document.body) {
document.addEventListener('DOMContentLoaded', init);
} else {
init();
}

function init() {
if (document.getElementById('impak-chat-root')) return;

const CSS = `

/* ── NAV GLOBAL ──
   Ajustado 11/09/2026 (pedido do Ayslan): com Câmbio/Resultado/Análises/
   Narcélio/Permissões somados aos links originais, a barra passou a ter
   itens de mais pra caber numa janela comum — o texto "Suporte"/usuário e
   o botão Sair ficavam cortados fora da tela, sem jeito de alcançar (a nav
   é position:fixed, então não acompanhava nem o scroll horizontal do
   body). Duas mudanças: (1) espaçamento mais enxuto (padding/gap/fonte
   menores) pra caber mais itens sem cortar nada; (2) os links do meio
   agora ficam num container próprio com flex:1 + overflow-x:auto — se
   ainda não couber tudo (tela bem estreita), esse trecho vira scrollável
   em vez de simplesmente sumir, e a área do usuário + Sair (nav-right)
   fica sempre fixa e visível à direita. */
#impak-nav {
position: fixed; top: 0; left: 0; right: 0; z-index: 10000;
background: #0a2340;
height: 52px;
display: flex; align-items: center;
padding: 0 14px; gap: 8px;
box-shadow: 0 1px 0 rgba(255,255,255,.06), 0 4px 12px rgba(16,24,40,.08);
font-family: 'DM Sans', sans-serif;
}
#impak-nav .nav-logo {
font-family: 'Syne', 'DM Sans', sans-serif;
font-size: 15px; font-weight: 800;
color: #fff; letter-spacing: .5px;
margin-right: 4px; flex-shrink: 0;
}
#impak-nav .nav-links-wrap {
display: flex; align-items: center; gap: 2px;
flex: 1 1 auto; min-width: 0; overflow-x: auto;
scrollbar-width: thin;
}
#impak-nav .nav-links-wrap::-webkit-scrollbar { height: 4px; }
#impak-nav .nav-links-wrap::-webkit-scrollbar-thumb { background: rgba(255,255,255,.2); border-radius: 2px; }
#impak-nav .nav-link {
color: rgba(255,255,255,.65);
text-decoration: none;
font-size: 11.5px; font-weight: 600;
padding: 6px 8px; border-radius: 8px;
transition: all .15s; white-space: nowrap; flex-shrink: 0;
border: none; background: none; cursor: pointer;
}
#impak-nav .nav-link:hover { color: #fff; background: rgba(255,255,255,.1); }
#impak-nav .nav-link.active { color: #fff; background: rgba(255,255,255,.15); }
#impak-nav .nav-sep { color: rgba(255,255,255,.2); margin: 0; font-size: 11px; flex-shrink: 0; }
/* Setores em dropdown — pedido Ayslan 15/09/2026: agrupar os 11 links soltos
   em 4 áreas do negócio (Operacional/Financeiro/Executivo/Comercial) pra
   ficar óbvio o que é o que, em vez de uma lista plana crescendo sem fim
   (ver comentário 11/09/2026 acima — mesmo problema, solução definitiva). */
#impak-nav .nav-sector { position: relative; flex-shrink: 0; }
#impak-nav .nav-sector-btn {
color: rgba(255,255,255,.65); background: none; border: none; cursor: pointer;
font-size: 11.5px; font-weight: 600; padding: 6px 8px; border-radius: 8px;
display: flex; align-items: center; gap: 4px; white-space: nowrap;
transition: all .15s; font-family: inherit;
}
#impak-nav .nav-sector-btn:hover, #impak-nav .nav-sector-btn.active { color: #fff; background: rgba(255,255,255,.1); }
#impak-nav .nav-sector-btn .caret { font-size: 9px; opacity: .6; }
#impak-nav .nav-icon { width: 14px; height: 14px; flex-shrink: 0; vertical-align: -2px; margin-right: 5px; opacity: .85; }
/* O painel NÃO fica dentro de #impak-nav .nav-links-wrap — esse container
   tem overflow-x:auto (pro scroll horizontal quando não cabe tudo, ver
   comentário 11/09/2026 acima), e overflow-x:auto corta o overflow no eixo Y
   também (regra do CSS: só um eixo pode ficar "visible" por vez). Um
   position:absolute allá dentro nunca aparecia — o clique funcionava mas o
   dropdown ficava invisível, cortado pela própria barra de 52px. Por isso o
   painel é anexado direto no body como position:fixed (ver JS), e essa
   classe cuida só da aparência dele, não do posicionamento dentro da nav. */
.impak-nav-sector-panel {
display: none; position: fixed; margin-top: 6px;
background: #0a2340; border: 1px solid rgba(255,255,255,.14); border-radius: 10px;
min-width: 210px; padding: 6px; box-shadow: 0 8px 24px rgba(0,0,0,.35); z-index: 10001;
font-family: 'DM Sans', sans-serif;
}
.impak-nav-sector-panel.open { display: block; }
.impak-nav-sector-panel a {
display: block; padding: 8px 10px; border-radius: 6px;
color: rgba(255,255,255,.75); text-decoration: none;
font-size: 12.5px; font-weight: 600; white-space: nowrap;
}
.impak-nav-sector-panel a:hover { color: #fff; background: rgba(255,255,255,.1); }
.impak-nav-sector-panel a.active { color: #fff; background: rgba(255,255,255,.15); }
#impak-nav .nav-right { flex-shrink: 0; margin-left: 10px; display: flex; align-items: center; gap: 10px; }
#impak-nav .nav-user { font-size: 11.5px; color: rgba(255,255,255,.55); white-space: nowrap; }
#impak-nav .nav-sair {
color: rgba(255,255,255,.65); text-decoration: none;
font-size: 11.5px; font-weight: 600;
padding: 6px 10px; border-radius: 8px;
border: 1px solid rgba(255,255,255,.2); background: rgba(255,255,255,.06);
transition: all .15s; white-space: nowrap; flex-shrink: 0;
}
#impak-nav .nav-sair:hover { color: #fff; background: rgba(255,255,255,.16); }
/* Empurrar conteúdo para baixo */
body { padding-top: 52px !important; }
/* Remover topbars antigos de cada módulo — o nav global já cobre isso */
body > .topbar, body > .app > .topbar { display: none !important; }
.topbar, .nav { position: relative !important; top: auto !important; }

#impak-chat-root {
position: fixed; bottom: 24px; right: 24px; z-index: 190;
font-family: 'DM Sans', sans-serif;
}
#impak-chat-btn {
width: 52px; height: 52px; border-radius: 50%;
background: #1a7fd4; border: none; cursor: pointer;
box-shadow: 0 4px 16px rgba(26,127,212,.4);
display: flex; align-items: center; justify-content: center;
font-size: 22px; transition: transform .15s, box-shadow .15s;
position: relative;
}
#impak-chat-btn:hover { transform: scale(1.08); box-shadow: 0 6px 20px rgba(26,127,212,.5); }
#impak-chat-badge {
position: absolute; top: -2px; right: -2px;
background: #dc2626; color: #fff; border-radius: 50%;
width: 18px; height: 18px; font-size: 10px; font-weight: 700;
display: none; align-items: center; justify-content: center;
}
#impak-chat-window {
position: fixed; bottom: 88px; right: 24px; z-index: 190;
width: 380px; height: 520px;
background: #fff; border-radius: 16px;
box-shadow: 0 8px 40px rgba(0,0,0,.18);
display: none; flex-direction: column; overflow: hidden;
border: 1px solid #c8d8e8;
}
#impak-chat-window.open { display: flex; }
#chat-header {
background: #0a2d5e; color: #fff;
padding: 14px 16px; display: flex; align-items: center; gap: 10px;
}
#chat-header-icon { font-size: 20px; }
#chat-header-text { flex: 1; }
#chat-header-text div:first-child { font-weight: 700; font-size: 14px; }
#chat-header-text div:last-child { font-size: 10px; opacity: .7; margin-top: 1px; }
#chat-close {
background: none; border: none; color: #fff; font-size: 18px;
cursor: pointer; opacity: .7; padding: 0 4px;
}
#chat-close:hover { opacity: 1; }
#chat-msgs {
flex: 1; overflow-y: auto; padding: 14px;
display: flex; flex-direction: column; gap: 10px;
background: #f0f6fc;
}
.chat-msg { max-width: 88%; word-wrap: break-word; }
.chat-msg.user {
align-self: flex-end;
background: #1a7fd4; color: #fff;
border-radius: 16px 16px 4px 16px;
padding: 9px 13px; font-size: 13px;
}
.chat-msg.bot {
align-self: flex-start;
background: #fff; color: #0d1e2e;
border-radius: 16px 16px 16px 4px;
padding: 9px 13px; font-size: 13px;
border: 1px solid #c8d8e8;
white-space: pre-wrap;
}
.chat-msg.bot.loading { color: #7a9ab8; font-style: italic; }
.chat-msg.system {
align-self: center; font-size: 11px; color: #7a9ab8;
background: none; max-width: 100%; text-align: center; padding: 2px 0;
}
#chat-sugestoes {
padding: 8px 12px; display: flex; gap: 6px; flex-wrap: wrap;
background: #fff; border-top: 1px solid #e8f0f8;
}
.chat-sugestao {
font-size: 11px; padding: 4px 10px; border-radius: 12px;
border: 1px solid #1a7fd4; color: #1a7fd4; background: none;
cursor: pointer; white-space: nowrap; transition: all .15s;
}
.chat-sugestao:hover { background: #1a7fd4; color: #fff; }
#chat-input-row {
display: flex; gap: 8px; padding: 10px 12px;
border-top: 1px solid #e8f0f8; background: #fff;
}
#chat-input {
flex: 1; border: 1px solid #c8d8e8; border-radius: 20px;
padding: 8px 14px; font-size: 13px; font-family: 'DM Sans', sans-serif;
outline: none; resize: none; max-height: 80px;
background: #f8fbfe; color: #0d1e2e;
}
#chat-input:focus { border-color: #1a7fd4; background: #fff; }
#chat-send {
width: 36px; height: 36px; border-radius: 50%;
background: #1a7fd4; border: none; cursor: pointer;
color: #fff; font-size: 16px; display: flex;
align-items: center; justify-content: center;
transition: background .15s; flex-shrink: 0;
}
#chat-send:hover { background: #1567b8; }
#chat-send:disabled { opacity: .4; cursor: not-allowed; }
`;

// Injetar CSS
const style = document.createElement('style');
style.textContent = CSS;
document.head.appendChild(style);

// ── NAV GLOBAL ──────────────────────────────────────────────

// "modulo" aqui usa os MESMOS nomes gravados no banco (ver MODULOS_VALIDOS
// em server.js) — cada usuário só tem os módulos marcados pra ele na tela
// de Permissões (/permissoes). Calculador é gated pelo módulo "tyredesk"
// (mesmo módulo do TyreDesk — são a mesma área de trabalho no back-end).
//
// Setorizado em 4 grupos (Operacional/Financeiro/Executivo/Comercial) —
// pedido Ayslan 15/09/2026: antes eram 11 links soltos, sem organização
// por área do negócio, o que já tinha até forçado um ajuste de CSS pra
// caber tudo na barra (ver comentário 11/09/2026 acima). Cada setor só
// aparece na nav se o usuário tiver acesso a pelo menos 1 item dele.
//
// 15/09/2026 (2ª parte do mesmo pedido): os "Dashboards" que ficavam numa
// seção separada da barra lateral do Controle subiram pra cá também —
// cada um foi pro setor correspondente. Os 4 que ainda não tinham rota
// própria (Executivo, Carregamentos, Por Cliente/Medida, DRE Consolidado)
// usam /controle?dash=X, que controle-core.js lê no load e chama o mesmo
// toggleDashX() de antes (ver controle-core.js). TV, Cadastros e
// Permissões ficam fora dos setores — TV é uma tela de exibição física,
// Cadastros é cadastro-base (não é "dashboard" nem some de nenhum setor
// específico) e Permissões é administrativo — nenhum dos três é "área de
// negócio".
// Ícones de linha (estilo Feather) pros 7 itens da barra principal —
// substituem os emojis antigos (pedido Ayslan 18/09/2026: "deixar algo
// mais profissional"). SVG inline (sem dependência externa), herdam a cor
// do texto via stroke="currentColor", então acompanham o hover/active da
// nav de graça.
const ICONE_SVG_BASE = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="nav-icon"';
const ICONES_NAV = {
  // Operacional: âncora — remete a operação portuária/logística.
  operacional: `<svg ${ICONE_SVG_BASE}><circle cx="12" cy="5" r="3"/><line x1="12" y1="22" x2="12" y2="8"/><path d="M5 12H2a10 10 0 0020 0h-3"/></svg>`,
  // Financeiro: cifrão.
  financeiro: `<svg ${ICONE_SVG_BASE}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>`,
  // Executivo/BI: gráfico de barras.
  executivo: `<svg ${ICONE_SVG_BASE}><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
  // Comercial: sacola de compras.
  comercial: `<svg ${ICONE_SVG_BASE}><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>`,
  // Cadastros: pessoas.
  cadastros: `<svg ${ICONE_SVG_BASE}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>`,
  // TV: monitor.
  tv: `<svg ${ICONE_SVG_BASE}><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
  // Permissões: cadeado.
  permissoes: `<svg ${ICONE_SVG_BASE}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>`,
  // ── Itens dentro dos menus suspensos (pedido Ayslan 18/09/2026: "faça em todos") ──
  controle: `<svg ${ICONE_SVG_BASE}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
  conferenciaFila: `<svg ${ICONE_SVG_BASE}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  carregamento: `<svg ${ICONE_SVG_BASE}><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`,
  dashFinanceiro: `<svg ${ICONE_SVG_BASE}><path d="M21.21 15.89A10 10 0 118 2.83"/><path d="M22 12A10 10 0 0012 2v10z"/></svg>`,
  cambio: `<svg ${ICONE_SVG_BASE}><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>`,
  dre: `<svg ${ICONE_SVG_BASE}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
  dashExecutivo: `<svg ${ICONE_SVG_BASE}><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg>`,
  resultado: `<svg ${ICONE_SVG_BASE}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`,
  analises: `<svg ${ICONE_SVG_BASE}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
  clienteMedida: `<svg ${ICONE_SVG_BASE}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
  narcelio: `<svg ${ICONE_SVG_BASE}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
  tyredesk: `<svg ${ICONE_SVG_BASE}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>`,
  calculador: `<svg ${ICONE_SVG_BASE}><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>`,
  catalogo: `<svg ${ICONE_SVG_BASE}><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>`,
};

const navSetores = [
  { setor: 'Operacional', icone: 'operacional', itens: [
    { label: 'Controle', icone: 'controle', href: '/controle', key: 'controle', modulo: 'controle' },
    { label: 'Fila de Conferência', icone: 'conferenciaFila', href: '/conferencia-fila', key: 'conferencia-fila', modulo: 'conferencia' }, // renomeado de 'Conferência' pra deixar claro que é a fila (pedido Ayslan 15/09/2026) — aponta pra fila nova dentro do Controle (task #636/#645) — processos.html (antigo) continua no ar por enquanto, só não tem mais link na nav
    { label: 'Dashboard de Carregamentos', icone: 'carregamento', href: '/controle?dash=carregamento', key: 'dash-carregamento', modulo: 'controle' }, // veio da barra lateral (pedido Ayslan 15/09/2026) — sem rota própria, usa toggleDashCarregamento() via ?dash= (ver controle-core.js)
  ]}, // Cadastros saiu daqui e virou link solo (como TV/Permissões) — pedido Ayslan 15/09/2026
  { setor: 'Financeiro', icone: 'financeiro', itens: [
    { label: 'Dashboard Financeiro', icone: 'dashFinanceiro', href: '/financeiro', key: 'financeiro', modulo: 'financeiro' },
    { label: 'Câmbio', icone: 'cambio', href: '/cambio', key: 'cambio', modulo: 'cambio' },
    { label: 'DRE Consolidado', icone: 'dre', href: '/controle?dash=dre', key: 'dash-dre', modulo: 'financeiro' }, // veio da barra lateral (pedido Ayslan 15/09/2026)
  ]},
  { setor: 'Executivo / BI', icone: 'executivo', itens: [
    { label: 'Dashboard Executivo', icone: 'dashExecutivo', href: '/controle?dash=executivo', key: 'dash-executivo', modulo: 'controle' }, // veio da barra lateral (pedido Ayslan 15/09/2026)
    { label: 'Resultado', icone: 'resultado', href: '/resultado', key: 'resultado', modulo: 'resultado' },
    { label: 'Análises', icone: 'analises', href: '/analises', key: 'analises', modulo: 'analises' },
    { label: 'Por Cliente/Medida', icone: 'clienteMedida', href: '/controle?dash=clientemedida', key: 'dash-clientemedida', modulo: 'controle' }, // veio da barra lateral (pedido Ayslan 15/09/2026)
    { label: 'Dashboard Narcélio', icone: 'narcelio', href: '/narcelio', key: 'narcelio', modulo: 'narcelio' }, // dado sensível de faturamento/margem, liberado só pra quem a tela de Permissões marcar
  ]},
  { setor: 'Comercial', icone: 'comercial', itens: [
    { label: 'TyreDesk', icone: 'tyredesk', href: '/', key: 'tyredesk', modulo: 'tyredesk' },
    { label: 'Calculador', icone: 'calculador', href: '/calculador', key: 'calculador', modulo: 'tyredesk' },
    { label: 'Catálogo', icone: 'catalogo', href: '/catalogo-produtos', key: 'catalogo', modulo: 'tyredesk' },
  ]},
];

// Detectar módulo atual pelo path — "financeiro" precisa vir ANTES de
// "controle" na checagem porque as duas telas usam o path /financeiro
// e /controle (não têm substring em comum, mas mantém a ordem por
// segurança caso isso mude no futuro).
const path = window.location.pathname;
const modAtual = path === '/' ? 'tyredesk'
  : path.includes('analises') ? 'analises'
  : path.includes('resultado') ? 'resultado'
: path.includes('cambio') ? 'cambio'
: path.includes('financeiro') ? 'financeiro'
: path.includes('/tv') ? 'tv'
: path.includes('narcelio') ? 'narcelio'
: path.includes('cadastros') ? 'cadastros'
: path.includes('conferencia-fila') ? 'conferencia-fila'
: path.includes('controle') ? 'controle'
: path.includes('processos') ? 'processos'
: path.includes('calculador')? 'calculador'
: path.includes('catalogo-produtos') ? 'catalogo'
: '';

// Não mostrar nav na tela de login do servidor (página /login)
const isLoginPage = window.location.pathname === '/login';
if (isLoginPage) return;

// A nav começa vazia (só logo + área do usuário) e só ganha os links de
// módulo depois que /api/me responder — assim a gente nunca pisca um link
// pra tela que a pessoa não tem acesso (antes os 7 links apareciam todos,
// pra todo mundo, sempre — o back-end até bloqueava o clique, mas a lista
// completa ficava visível igual).
const navEl = document.createElement('div');
navEl.id = 'impak-nav';
navEl.innerHTML = `
<div class="nav-logo">ImpakOS</div>
<div class="nav-links-wrap" id="nav-links-wrap"></div>
<div class="nav-right">
<span class="nav-user" id="nav-user-label">—</span>
<a class="nav-sair" href="/logout">Sair</a>
</div>
`;
document.body.insertBefore(navEl, document.body.firstChild);

fetch('/api/me').then(r=>r.json()).then(d=>{
const el = document.getElementById('nav-user-label');
if(el && d.displayName) el.textContent = d.displayName;

const modulosDoUsuario = d.modulos || [];
const linksWrap = navEl.querySelector('#nav-links-wrap');
let precisaSep = false;
const addSep = () => {
  if(precisaSep){
    const sep = document.createElement('span');
    sep.className = 'nav-sep';
    sep.textContent = '·';
    linksWrap.appendChild(sep);
  }
  precisaSep = true;
};

// Setores em dropdown — cada um só aparece se o usuário tiver acesso a
// pelo menos 1 item dele (mesma lógica de antes, só que agrupada).
//
// Os painéis são anexados no <body> (não dentro de #nav-links-wrap) e
// posicionados via getBoundingClientRect() no clique — ver comentário no
// CSS acima (.impak-nav-sector-panel) sobre por que dentro da nav eles
// ficavam invisíveis (overflow-x:auto cortava o eixo Y também).
const todosPaineis = [];
const fecharPaineis = () => todosPaineis.forEach(p => p.classList.remove('open'));

navSetores.forEach(setor => {
  const itensPermitidos = setor.itens.filter(m => modulosDoUsuario.includes(m.modulo));
  if(!itensPermitidos.length) return;
  addSep();

  const setorAtivo = itensPermitidos.some(m => modAtual === m.key);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'nav-sector-btn' + (setorAtivo ? ' active' : '');
  btn.innerHTML = ICONES_NAV[setor.icone] + setor.setor + ' <span class="caret">▾</span>';

  const panel = document.createElement('div');
  panel.className = 'impak-nav-sector-panel';
  itensPermitidos.forEach(m => {
    const link = document.createElement('a');
    link.className = (modAtual === m.key ? 'active' : '');
    link.href = m.href;
    link.innerHTML = (ICONES_NAV[m.icone] || '') + m.label;
    panel.appendChild(link);
  });
  document.body.appendChild(panel);
  todosPaineis.push(panel);

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const jaAberto = panel.classList.contains('open');
    fecharPaineis();
    if(!jaAberto){
      const r = btn.getBoundingClientRect();
      panel.style.top = r.bottom + 'px';
      panel.style.left = r.left + 'px';
      panel.classList.add('open');
    }
  });

  const wrap = document.createElement('div');
  wrap.className = 'nav-sector';
  wrap.appendChild(btn);
  linksWrap.appendChild(wrap);
});

// Cadastros, TV e Permissões ficam soltos fora dos setores — Cadastros é
// cadastro-base (não é "área de negócio" nem "dashboard"), TV é uma tela
// de exibição física, e Permissões é administrativo. Pedido Ayslan
// 15/09/2026: "ter um especifico para cadastros, tipo a tv, permissoes".
if(modulosDoUsuario.includes('cadastros')){
  addSep();
  const link = document.createElement('a');
  link.className = 'nav-link' + (modAtual === 'cadastros' ? ' active' : '');
  link.href = '/cadastros';
  link.innerHTML = ICONES_NAV.cadastros + 'Cadastros';
  linksWrap.appendChild(link);
}

if(modulosDoUsuario.includes('tv')){
  addSep();
  const link = document.createElement('a');
  link.className = 'nav-link' + (modAtual === 'tv' ? ' active' : '');
  link.href = '/tv';
  link.innerHTML = ICONES_NAV.tv + 'TV';
  linksWrap.appendChild(link);
}

// Link da tela de Permissões — só pra quem pode gerenciar acesso de outros
// (Narcelio, Paula, Ayslan/"suporte" — ver ADMINS_PERMISSOES em server.js).
if(['narcelio', 'paula', 'suporte'].includes(d.usuario)){
  addSep();
  const link = document.createElement('a');
  link.className = 'nav-link' + (path.includes('permissoes') ? ' active' : '');
  link.href = '/permissoes';
  link.innerHTML = ICONES_NAV.permissoes + 'Permissões';
  linksWrap.appendChild(link);
}

// Fecha qualquer dropdown de setor aberto ao clicar fora dele, ou ao
// rolar/redimensionar a tela (o painel é position:fixed e recalculado só
// no clique — sem isso ele ficaria "flutuando" fora do lugar do botão).
document.addEventListener('click', fecharPaineis);
window.addEventListener('scroll', fecharPaineis, true);
window.addEventListener('resize', fecharPaineis);
}).catch(()=>{});

// ── CHAT ─────────────────────────────────────────────────────
// Injetar HTML
const root = document.createElement('div');
root.id = 'impak-chat-root';
root.innerHTML = `
<div id="impak-chat-window">
<div id="chat-header">
<div id="chat-header-icon">🤖</div>
<div id="chat-header-text">
<div>Assistente IMPAK</div>
<div>IA com acesso aos processos em tempo real</div>
</div>
<button id="chat-close">✕</button>
</div>
<div id="chat-msgs"></div>
<div id="chat-sugestoes">
<button class="chat-sugestao">Demurrage crítico</button>
<button class="chat-sugestao">Chegando essa semana</button>
<button class="chat-sugestao">Pagamentos vencidos</button>
<button class="chat-sugestao">Resumo geral</button>
</div>
<div id="chat-input-row">
<textarea id="chat-input" rows="1" placeholder="Pergunte sobre qualquer processo..."></textarea>
<button id="chat-send">➤</button>
</div>
</div>
<button id="impak-chat-btn" title="Assistente IA">
🤖
<div id="impak-chat-badge"></div>
</button>
`;
document.body.appendChild(root);

// Estado
let historico = [];
let aberto = false;
let enviando = false;
let msgNaoLidas = 0;

const win = document.getElementById('impak-chat-window');
const msgs = document.getElementById('chat-msgs');
const input = document.getElementById('chat-input');
const send = document.getElementById('chat-send');
const badge = document.getElementById('impak-chat-badge');
const btn = document.getElementById('impak-chat-btn');

function toggleChat() {
aberto = !aberto;
win.classList.toggle('open', aberto);
if (aberto) {
msgNaoLidas = 0;
badge.style.display = 'none';
input.focus();
if (msgs.children.length === 0) boasVindas();
}
}

function boasVindas() {
const hora = new Date().getHours();
const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
addMsg(`${saudacao}! Sou o assistente da IMPAK. Tenho acesso a todos os processos de importação em tempo real.\n\nPosso te ajudar com:\n• Status de qualquer processo\n• Alertas de demurrage e ETAs\n• Pagamentos vencidos ou a vencer\n• Resumo financeiro\n• Sugestões de ação\n\nO que você precisa saber?`, 'bot');
}

function addMsg(texto, tipo) {
const div = document.createElement('div');
div.className = `chat-msg ${tipo}`;
div.textContent = texto;
msgs.appendChild(div);
msgs.scrollTop = msgs.scrollHeight;
if (tipo === 'bot' && !aberto) {
msgNaoLidas++;
badge.textContent = msgNaoLidas;
badge.style.display = 'flex';
}
return div;
}

async function enviar(texto) {
if (!texto.trim() || enviando) return;
enviando = true;
send.disabled = true;

addMsg(texto, 'user');
historico.push({ role: 'user', content: texto });

const loading = addMsg('Consultando processos...', 'bot loading');

try {
const r = await fetch('/api/chat', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ mensagem: texto, historico: historico.slice(-8) })
});
const d = await r.json();

loading.remove();
if (d.ok) {
addMsg(d.resposta, 'bot');
historico.push({ role: 'assistant', content: d.resposta });
// Manter histórico compacto
if (historico.length > 20) historico = historico.slice(-16);
} else {
addMsg('Erro: ' + (d.erro || 'Tente novamente.'), 'bot');
}
} catch (e) {
loading.remove();
addMsg('Erro de conexão. Verifique sua internet.', 'bot');
}

enviando = false;
send.disabled = false;
input.focus();
}

// Events
document.getElementById('impak-chat-btn').onclick = toggleChat;
document.getElementById('chat-close').onclick = toggleChat;
send.onclick = () => { const t = input.value.trim(); input.value = ''; enviar(t); };

input.addEventListener('keydown', e => {
if (e.key === 'Enter' && !e.shiftKey) {
e.preventDefault();
const t = input.value.trim();
input.value = '';
enviar(t);
}
});

// Auto-resize textarea
input.addEventListener('input', () => {
input.style.height = 'auto';
input.style.height = Math.min(input.scrollHeight, 80) + 'px';
});

// Sugestões rápidas
document.querySelectorAll('.chat-sugestao').forEach(btn => {
btn.onclick = () => {
if (!aberto) toggleChat();
setTimeout(() => enviar(btn.textContent), 100);
};
});

}

})();
