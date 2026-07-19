# Testes

## `calculador-regressao.js`

Rede de segurança pro motor de cálculo do Calculador (`calcular()`, em
`calculador.html`). Esse é o código mais sensível do sistema — cada fórmula
já passou por auditoria manual contra planilhas e processos reais (dá pra ver
os comentários `FIX (auditoria ...)` espalhados pelo `calcular()`), então uma
mudança que pareça inofensiva pode sem querer desfazer uma correção que levou
tempo pra descobrir.

Este script guarda 3 casos com valores já conferidos (2 deles à mão, contra
fórmula e exemplo real documentados no próprio código; o 3º é uma foto ampla
do resultado atual, pra pegar qualquer mudança não intencional numa parte
maior do cálculo) e confere se `calcular()` ainda produz os mesmos números.

### Como rodar

1. Abra a tela **/calculador** no navegador, já logado.
2. Abra o Console do navegador (F12 → aba "Console").
3. Cole o conteúdo de `calculador-regressao.js` inteiro e aperte Enter.
4. Leia o relatório: cada linha mostra `✓ PASS` ou `✗ FAIL`. Se aparecer
   algum `FAIL`, pare e investigue antes de continuar — alguma mudança
   recente alterou uma conta que já tinha sido conferida.

### Quando rodar

- Depois de qualquer mudança em `calcular()`, `lerTaxasOperacionais()`,
  `lerCustosReais()`, `calcularArmazenagemUI()` ou na tabela `TABELA_NCM`.
- Antes de levar qualquer mudança de cálculo do `lab` pro `main`.

### Como adicionar um caso novo

Sempre que auditar um número novo contra uma planilha ou processo real,
adicione um caso aqui também: os inputs exatos usados, o valor esperado, e
de onde esse valor veio (comentário no código, print de conversa, processo
real). Isso transforma cada correção manual numa trava permanente — se
alguém (ou algum agente) mexer na fórmula de novo no futuro sem querer
desfazer a correção, o teste acusa na hora.

Se a mudança for **intencional** (uma regra de negócio nova, não um bug),
atualize o valor esperado do caso junto com a mudança de código, no mesmo
commit — assim o teste continua servindo de documentação viva de "isso é
assim de propósito, não é um bug esperando ser corrigido".
