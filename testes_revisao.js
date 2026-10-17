// Testes da revisão de 17/10/2026: datas impossíveis, edição simultânea do
// mesmo processo e tradução de mensagens de erro. Cada caso reproduz um
// problema encontrado nos dados/código antes da correção.
// Rodar: node testes_revisao.js
const VD = require('./validacao-datas.js');
const CP = require('./concorrencia-processo.js');

let total = 0, passaram = 0;
function teste(nome, fn) {
  total++;
  try { fn(); passaram++; console.log('  ✓ ' + nome); }
  catch (e) { console.log('  ✗ ' + nome + '\n      ' + (e.message || e)); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || 'falhou'); }
function iguais(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg ? msg + ' — ' : '') + `esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); }
const HOJE = '2026-10-17';

console.log('\n── Datas impossíveis (validacao-datas.js) ──');
teste('Chegada antes do embarque é erro', () => {
  const r = VD.validar({ data_embarque: '2026-08-07', data_chegada: '2026-07-28' }, { hoje: HOJE });
  ok(VD.erros(r).length === 1, JSON.stringify(r));
  ok(/Data de Chegada \(28\/07\/2026\) está antes de Data de Embarque \(07\/08\/2026\)/.test(VD.erros(r)[0].msg), VD.erros(r)[0].msg);
});
teste('Embarque = chegada (padrão encontrado na base) gera aviso de trânsito curto', () => {
  const r = VD.validar({ data_embarque: '2026-08-07', data_chegada: '2026-08-07' }, { hoje: HOJE });
  iguais(VD.erros(r).length, 0);
  ok(VD.avisos(r).some(a => /0 dia\(s\) entre o Embarque/.test(a.msg)), JSON.stringify(r));
});
teste('Devolução do vazio antes da chegada (padrão encontrado na base) é erro', () => {
  const r = VD.validar({ data_chegada: '2026-08-24', data_devolucao_vazio: '2026-02-09' }, { hoje: HOJE });
  ok(VD.erros(r).some(e => e.campos.includes('data_devolucao_vazio')), JSON.stringify(r));
});
teste('Carga LCL não tem devolução de vazio — regra não se aplica', () => {
  const r = VD.validar({ tipo_container: 'LCL', data_chegada: '2026-08-24', data_devolucao_vazio: '2026-02-09' }, { hoje: HOJE });
  iguais(VD.erros(r).length, 0, JSON.stringify(r));
});
teste('Carregamento antes da chegada é erro', () => {
  const r = VD.validar({ data_chegada: '2026-08-10', data_carregamento: '2026-08-01' }, { hoje: HOJE });
  iguais(VD.erros(r).length, 1);
});
teste('Devolução antes do carregamento é erro', () => {
  const r = VD.validar({ data_chegada: '2026-08-01', data_carregamento: '2026-08-12', data_devolucao_vazio: '2026-08-10' }, { hoje: HOJE });
  ok(VD.erros(r).some(e => e.campos.join() === 'data_carregamento,data_devolucao_vazio'), JSON.stringify(r));
});
teste('ETA antes do ETD é erro', () => {
  const r = VD.validar({ etd: '2026-11-10', eta: '2026-11-01' }, { hoje: HOJE });
  iguais(VD.erros(r).length, 1);
});
teste('Ano digitado pela metade (0026-07-22, visto no histórico) é erro', () => {
  const r = VD.validar({ eta: '0026-07-22' }, { hoje: HOJE });
  ok(VD.erros(r).length >= 1 && /ano 0026/.test(VD.erros(r)[0].msg), JSON.stringify(r));
});
teste('Ano muito no futuro (2099) é erro', () => {
  const r = VD.validar({ pi_data_saldo: '2099-01-01' }, { hoje: HOJE });
  iguais(VD.erros(r).length, 1);
});
teste('Data real no futuro vira aviso (não erro)', () => {
  const r = VD.validar({ data_chegada: '2026-11-30' }, { hoje: HOJE });
  iguais(VD.erros(r).length, 0); ok(VD.avisos(r).length === 1);
});
teste('Sequência normal não gera nada', () => {
  const r = VD.validar({ etd: '2026-06-01', eta: '2026-07-28', data_embarque: '2026-06-03', data_chegada: '2026-07-30', data_presenca: '2026-07-31', data_carregamento: '2026-08-05', data_devolucao_vazio: '2026-08-12' }, { hoje: HOJE });
  iguais(r, []);
});
teste('Só valida regras dos campos alterados (processo antigo com erro não trava outra edição)', () => {
  const p = { data_chegada: '2026-08-24', data_devolucao_vazio: '2026-02-09', obs: 'x' };
  iguais(VD.validar(p, { hoje: HOJE, campos: ['obs'] }), []);
  ok(VD.erros(VD.validar(p, { hoje: HOJE, campos: ['data_chegada'] })).length === 1);
});

console.log('\n── Edição simultânea (concorrencia-processo.js) ──');
const original = { id: 'p1', referencia: 'UD26-900', fase: 'EMBARCADO', obs: 'a', navio: 'MSC X', data_chegada: null, vendas_json: '[]', updated_at: '2026-10-17T10:00:00.000+00:00' };
const atual = { ...original, fase: 'CHEGOU', data_chegada: '2026-10-16', navio: 'MSC Y', updated_at: '2026-10-17T10:05:00.000+00:00', updated_by: 'fulano' };
teste('Detecta o que a outra pessoa mudou (sem contar campos calculados)', () => {
  iguais(CP.alteradosPorOutros(original, atual), ['data_chegada', 'navio']);
});
teste('Campos diferentes: junta sem perguntar e mantém fase/chegada da outra pessoa', () => {
  const meu = { ...original, obs: 'b' };
  iguais(CP.camposEmConflito(original, atual, meu, ['obs']), []);
  const m = CP.mesclar(atual, meu, ['obs']);
  iguais([m.obs, m.data_chegada, m.fase, m.navio], ['b', '2026-10-16', 'CHEGOU', 'MSC Y']);
});
teste('Mesmo campo com valores diferentes: conflito', () => {
  const meu = { ...original, navio: 'MSC Z' };
  const c = CP.camposEmConflito(original, atual, meu, ['navio']);
  iguais(c.map(x => x.campo), ['navio']); iguais(c[0].deles, 'MSC Y');
});
teste('Mesmo campo com o MESMO valor: não é conflito', () => {
  const meu = { ...original, navio: 'MSC Y' };
  iguais(CP.camposEmConflito(original, atual, meu, ['navio']), []);
});
teste('Usuário escolhe manter o valor da outra pessoa num campo', () => {
  const meu = { ...original, navio: 'MSC Z', obs: 'b' };
  const m = CP.mesclar(atual, meu, ['navio', 'obs'], ['navio']);
  iguais([m.navio, m.obs], ['MSC Y', 'b']);
});
teste('Campo calculado (fase) mandado pelo painel nunca vira conflito nem sobrescreve', () => {
  const meu = { ...original, fase: 'EMBARCADO', obs: 'c' };
  iguais(CP.camposEmConflito(original, atual, meu, ['fase', 'obs']), []);
  iguais(CP.mesclar(atual, meu, ['fase', 'obs']).fase, 'CHEGOU');
});
teste('JSON com chaves em outra ordem não conta como diferente', () => {
  ok(!CP.diferente('[{"a":1,"b":2}]', [{ b: 2, a: 1 }]));
  ok(!CP.diferente('5.10', 5.1));
  ok(!CP.diferente(null, ''));
});
teste('real_json: vínculo com fatura gravado pelo servidor é mantido e não é conflito', () => {
  const o = { ...original, real_json: { frete: { valor: 100, moeda: 'USD' } } };
  const a = { ...o, real_json: { frete: { valor: 100, moeda: 'USD' }, _meta: { frete: { fatura_id: 'f1', pago_em: '2026-10-16' } } } };
  const meu = { ...o, real_json: { frete: { valor: 120, moeda: 'USD' } } };
  iguais(CP.camposEmConflito(o, a, meu, ['real_json']), []);
  const m = CP.mesclar(a, meu, ['real_json']);
  iguais(m.real_json.frete.valor, 120); iguais(m.real_json._meta.frete.fatura_id, 'f1');
});
teste('real_json: dois mudando o mesmo custo é conflito', () => {
  const o = { ...original, real_json: { frete: { valor: 100 } } };
  const a = { ...o, real_json: { frete: { valor: 110 } } };
  const meu = { ...o, real_json: { frete: { valor: 120 } } };
  iguais(CP.camposEmConflito(o, a, meu, ['real_json']).map(x => x.campo), ['real_json']);
});

console.log(`\nTotal: ${total} testes, ${passaram} passaram, ${total - passaram} falharam`);
if (passaram !== total) process.exit(1);
