// erros-amigaveis.js — mensagem técnica → motivo + próximo passo
// (revisão 17/10/2026). Muitas rotas devolviam o texto cru do banco
// ("duplicate key value violates unique constraint...", "fetch failed") e a
// tela mostrava "Erro ao salvar: <isso>". Aqui só se TRADUZ o que é
// reconhecido; mensagem que já é do sistema (em português) passa intacta.
// O texto original vai junto em `detalhe`, pra quem for investigar.
'use strict';

const REGRAS = [
  [/duplicate key value violates unique constraint/i,
    () => 'Registro duplicado: já existe um cadastro igual (mesmo número/código). Atualize a tela e confira se ele já não foi salvo antes de tentar de novo.'],
  [/violates foreign key constraint/i,
    () => 'Este registro está ligado a outro que não existe mais (ou que ainda está em uso). Atualize a tela; se continuar, avise o suporte.'],
  [/null value in column "?([a-z_]+)"?.*violates not-null/i,
    (m) => `Falta preencher um campo obrigatório (${m[1].replace(/_/g, ' ')}).`],
  [/invalid input syntax for type (date|timestamp)|date\/time field value out of range|out of range for type (date|timestamp)/i,
    () => 'Data inválida: confira dia, mês e ano (ano com 4 dígitos).'],
  [/invalid input syntax for type (numeric|integer|bigint|double precision|real)|numeric field overflow/i,
    () => 'Número inválido em algum campo — use só números (vírgula para os centavos).'],
  [/value too long for type/i,
    () => 'Algum texto ficou maior do que o campo aceita. Encurte e tente de novo.'],
  [/fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network ?error|Failed to fetch/i,
    () => 'O servidor não conseguiu falar com o banco de dados agora (instabilidade). Nada foi salvo — tente de novo em alguns segundos.'],
  [/statement timeout|canceling statement due to/i,
    () => 'A consulta demorou demais e foi cancelada. Tente de novo; se repetir, filtre um período menor.'],
  [/JWT|invalid api key|No API key found|permission denied for (table|relation|schema)/i,
    () => 'O servidor está sem permissão no banco de dados. Avise o suporte (suporte@impak.com.br) — nada foi alterado.'],
  [/JSON object requested, multiple \(or no\) rows returned|PGRST116/i,
    () => 'Registro não encontrado — pode ter sido alterado ou removido por outra pessoa. Atualize a tela.'],
  [/Could not find the '([a-z_]+)' column|column "?([a-z_]+)"? (of relation .* )?does not exist|schema cache/i,
    (m) => `O banco ainda não tem um campo novo${(m[1] || m[2]) ? ' (' + (m[1] || m[2]) + ')' : ''} — falta rodar uma atualização do banco. Avise o suporte.`],
  [/relation "?([a-z_]+)"? does not exist/i,
    (m) => `A tabela ${m[1]} ainda não existe no banco — falta rodar uma atualização do banco. Avise o suporte.`],
  [/Corpo da requisi[çc][ãa]o grande demais|request entity too large|entity\.too\.large|PayloadTooLargeError/i,
    () => 'Arquivo grande demais para enviar de uma vez (máximo 50 MB). Envie um arquivo menor ou um de cada vez.'],
  [/^N[ãa]o autenticado$/i,
    () => 'Sua sessão expirou (ou você saiu em outra aba). Entre de novo para continuar — copie antes o que digitou, se não salvou.'],
  [/^Acesso negado a este m[óo]dulo$/i,
    () => 'Seu usuário não tem acesso a esta área. Peça a liberação a um gerente (tela Permissões).'],
  // Armazenamento de arquivos (GED / Supabase Storage).
  [/The object exceeded the maximum allowed size|maximum allowed size/i,
    () => 'Arquivo grande demais para o armazenamento (máximo 15 MB por arquivo). Comprima o PDF ou divida em partes e envie de novo.'],
  [/Bucket not found|Object not found|The resource was not found/i,
    () => 'Arquivo não encontrado no armazenamento (pode ter sido removido). Atualize a tela; se precisar dele, envie de novo.'],
  // Resposta quebrada / erro de programação: não dá pra dizer mais que isso,
  // mas o texto em inglês não ajuda ninguém — o original segue em `detalhe`.
  [/Unexpected token .* in JSON|is not valid JSON|Unexpected end of JSON input/i,
    () => 'Os dados chegaram num formato inválido. Recarregue a tela (F5) e tente de novo; se repetir, avise o suporte.'],
  [/Cannot read propert(y|ies) of (undefined|null)|is not a function|is not iterable|is not defined/i,
    () => 'Erro interno do sistema ao processar o pedido (ficou registrado). Tente de novo; se repetir, avise o suporte com o horário.'],
];

function traduzirErro(msg) {
  const texto = String(msg == null ? '' : msg);
  for (const [re, fn] of REGRAS) {
    const m = re.exec(texto);
    if (m) return { msg: fn(m), traduzido: true };
  }
  return { msg: texto, traduzido: false };
}

// Middleware: toda resposta JSON de erro (status >= 400 ou ok:false) com
// `erro` técnico sai traduzida.
function middlewareErrosAmigaveis(req, res, next) {
  const json = res.json.bind(res);
  res.json = (body) => {
    try {
      if (body && typeof body === 'object' && !Array.isArray(body) && typeof body.erro === 'string'
          && (res.statusCode >= 400 || body.ok === false)) {
        const t = traduzirErro(body.erro);
        if (t.traduzido) body = Object.assign({}, body, { erro: t.msg, detalhe: body.erro.slice(0, 300) });
      }
    } catch (e) { /* nunca quebra a resposta por causa da tradução */ }
    return json(body);
  };
  next();
}

module.exports = { traduzirErro, middlewareErrosAmigaveis, REGRAS };
