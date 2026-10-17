// tests/tela/auditoria.js — roda DENTRO da página (navegador) e devolve o
// que impede alguém de usar a tela (revisão 17/10/2026, item 6):
//   · rolagem lateral da página inteira (no celular, a tela "anda pro lado");
//   · texto ilegível: letra pequena demais ou com pouco contraste com o fundo;
//   · campo sem nome acessível (sem <label>, aria-label ou title) — leitor de
//     tela e quem navega só pelo teclado não sabem o que digitar ali.
// Usado por tests/tela/testes_tela.js (Playwright, a cada atualização) e pode
// ser colado no console de qualquer tela pra conferir na hora.
(function (raiz) {
  'use strict';

  function rgba(txt) {
    const m = /rgba?\(([^)]+)\)/.exec(String(txt || ''));
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function lum(c) {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function misturar(fg, bg) {
    const a = fg.a == null ? 1 : fg.a;
    return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
  }
  // Fundo efetivo: sobe pelos pais até achar uma cor sólida (camadas
  // semitransparentes são misturadas). Fundo com imagem/gradiente → null
  // (não dá pra medir com segurança, fica fora da conta).
  function fundo(el) {
    const camadas = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      const c = rgba(cs.backgroundColor);
      if (c && c.a > 0) { camadas.push(c); if (c.a >= 1) break; }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = camadas.length - 1; i >= 0; i--) base = misturar(camadas[i], base);
    return base;
  }
  function contraste(a, b) {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
  function visivel(el) {
    if (!el.getClientRects().length) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.visibility === 'hidden' || cs.display === 'none') return false;
      // esmaecido de propósito (linha inativa, botão desabilitado) não conta
      if (parseFloat(cs.opacity) < 1) return false;
      if (n.getAttribute && n.getAttribute('aria-hidden') === 'true') return false;
    }
    return true;
  }
  function descrever(el) {
    const id = el.id ? '#' + el.id : '';
    const cls = (el.className && typeof el.className === 'string') ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    const txt = (el.innerText || el.value || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${el.tagName.toLowerCase()}${id}${cls}${txt ? ' "' + txt + '"' : ''}`;
  }
  // Algum pai rola na horizontal (tabela larga dentro de uma caixa com
  // overflow-x:auto)? Então passar da largura é esperado — a caixa rola,
  // a página não.
  function dentroDeRolagem(el) {
    for (let n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
    }
    return false;
  }

  function auditarTela(opts) {
    opts = opts || {};
    const minFonte = opts.minFonte || 10;         // px — abaixo disso é ilegível
    const minContraste = opts.minContraste || 3;   // 3:1 — piso; WCAG AA pede 4,5:1 em texto normal
    const de = document.documentElement;
    const largura = de.clientWidth;
    const out = { url: location.pathname, largura, rolagemLateral: Math.max(0, de.scrollWidth - largura), culpadosRolagem: [], letraPequena: [], baixoContraste: [], abaixoAA: 0, camposSemNome: [], textosMedidos: 0 };

    if (out.rolagemLateral > 2) {
      // Culpado = o elemento MAIS INTERNO que é mais largo que a tela (tabela,
      // campo com largura fixa...). Os de fora (menu, cartões) só esticam
      // junto. Sem nenhum mais largo, vale quem começa fora da tela.
      const largos = [], fora = [];
      document.querySelectorAll('body *').forEach(el => {
        if (!visivel(el) || dentroDeRolagem(el)) return;
        const r = el.getBoundingClientRect();
        if (r.width > largura + 2) largos.push({ el, r });
        else if (r.right > largura + 2) fora.push({ el, r });
      });
      const base = largos.length ? largos : fora;
      const folhas = base.filter(c => !base.some(o => o !== c && c.el.contains(o.el)));
      folhas.sort((x, y) => y.r.width - x.r.width);
      out.culpadosRolagem = folhas.slice(0, 6).map(c => descrever(c.el) + ` (${Math.round(c.r.width)}px de largura, vai até ${Math.round(c.r.right)}px)`);
    }

    const vistos = new Set();
    const caminhar = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let t = caminhar.nextNode(); t; t = caminhar.nextNode()) {
      // só texto de verdade (letra ou número) — separador "·" e ícone ficam fora
      if (!t.nodeValue || !/[\p{L}\p{N}]/u.test(t.nodeValue)) continue;
      const el = t.parentElement;
      if (!el || vistos.has(el) || /^(SCRIPT|STYLE|NOSCRIPT|OPTION|TITLE)$/.test(el.tagName)) continue;
      vistos.add(el);
      if (!visivel(el)) continue;
      const cs = getComputedStyle(el);
      out.textosMedidos++;
      const tam = parseFloat(cs.fontSize);
      if (tam < minFonte) out.letraPequena.push(descrever(el) + ` (${tam}px)`);
      const bg = fundo(el), fg = rgba(cs.color);
      if (!bg || !fg) continue;
      const c = contraste(misturar(fg, bg), bg);
      const grande = tam >= 18.66 || (tam >= 14 && parseInt(cs.fontWeight, 10) >= 700);
      if (c < (grande ? 3 : 4.5)) out.abaixoAA++;
      if (c < minContraste) out.baixoContraste.push(descrever(el) + ` (${c.toFixed(2)}:1)`);
    }

    document.querySelectorAll('input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=reset]), select, textarea').forEach(el => {
      if (!visivel(el)) return;
      const temNome = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title')
        || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('label');
      if (!temNome) out.camposSemNome.push(descrever(el));
    });
    return out;
  }

  raiz.auditarTela = auditarTela;
  if (typeof module !== 'undefined' && module.exports) module.exports = { auditarTela };
})(typeof window !== 'undefined' ? window : globalThis);
