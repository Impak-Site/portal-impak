// ════════════════════════════════════════════════════════════════
// IMPAK CHAT — Janela flutuante de IA (injetado em todos os módulos)
// ════════════════════════════════════════════════════════════════
(function() {
  // Evitar duplicata
  if (document.getElementById('impak-chat-root')) return;

  const CSS = `

    /* ── NAV GLOBAL ── */
    #impak-nav {
      position: fixed; top: 0; left: 0; right: 0; z-index: 10000;
      background: #0a2d5e;
      height: 44px;
      display: flex; align-items: center;
      padding: 0 16px; gap: 4px;
      box-shadow: 0 2px 8px rgba(0,0,0,.3);
      font-family: 'DM Sans', sans-serif;
    }
    #impak-nav .nav-logo {
      font-family: 'Syne', 'DM Sans', sans-serif;
      font-size: 15px; font-weight: 800;
      color: #fff; letter-spacing: 1px;
      margin-right: 12px; flex-shrink: 0;
    }
    #impak-nav .nav-link {
      color: rgba(255,255,255,.65);
      text-decoration: none;
      font-size: 12px; font-weight: 600;
      padding: 5px 11px; border-radius: 6px;
      transition: all .15s; white-space: nowrap;
      border: none; background: none; cursor: pointer;
    }
    #impak-nav .nav-link:hover { color: #fff; background: rgba(255,255,255,.1); }
    #impak-nav .nav-link.active { color: #fff; background: rgba(255,255,255,.15); }
    #impak-nav .nav-sep { color: rgba(255,255,255,.2); margin: 0 2px; font-size: 11px; }
    #impak-nav .nav-right { margin-left: auto; display: flex; align-items: center; gap: 8px; }
    #impak-nav .nav-user { font-size: 11px; color: rgba(255,255,255,.5); }
    /* Empurrar conteúdo para baixo */
    body { padding-top: 44px !important; }
    /* Ajustar topbars existentes */
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

    const navModulos = [
      { label: '🚢 Controle',    href: '/controle',   key: 'controle'    },
      { label: '📄 Conferência', href: '/processos',  key: 'processos'   },
      { label: '📦 TyreDesk',    href: '/',           key: 'tyredesk'    },
      { label: '💰 Calculador',  href: '/calculador', key: 'calculador'  },
    ];

    // Detectar módulo atual pelo path
    const path = window.location.pathname;
    const modAtual = path === '/' ? 'tyredesk'
      : path.includes('controle')  ? 'controle'
      : path.includes('processos') ? 'processos'
      : path.includes('calculador')? 'calculador'
      : '';

    // Não mostrar nav na tela de login do servidor (página /login)
    const isLoginPage = window.location.pathname === '/login';
    if (isLoginPage) return;

    const navEl = document.createElement('div');
    navEl.id = 'impak-nav';
    navEl.innerHTML = `
      <div class="nav-logo">IMPAK</div>
      ${navModulos.map(m => `
        <a class="nav-link${modAtual === m.key ? ' active' : ''}" href="${m.href}">${m.label}</a>
      `).join('<span class="nav-sep">·</span>')}
      <div class="nav-right">
        <span class="nav-user" id="nav-user-label">—</span>
      </div>
    `;
    document.body.insertBefore(navEl, document.body.firstChild);

    // Mostrar usuário logado
    fetch('/api/me').then(r=>r.json()).then(d=>{
      const el = document.getElementById('nav-user-label');
      if(el && d.displayName) el.textContent = d.displayName;
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

  const win   = document.getElementById('impak-chat-window');
  const msgs  = document.getElementById('chat-msgs');
  const input = document.getElementById('chat-input');
  const send  = document.getElementById('chat-send');
  const badge = document.getElementById('impak-chat-badge');
  const btn   = document.getElementById('impak-chat-btn');

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

})();
