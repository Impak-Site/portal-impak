// Verificador de qualidade (24/10/2026). Só regras que apontam ERRO de verdade
// (função declarada duas vezes, chave repetida, código que nunca roda...).
// Roda no "npm test" — então roda também no GitHub antes de cada publicação.
// Estilo (espaços, aspas, ponto e vírgula) não é cobrado.
module.exports = [
  { ignores: ['node_modules/**', '**/*.min.js', 'vendor/**', 'public/vendor/**'] },
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script' },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'no-redeclare': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-dupe-else-if': 'error',
      'no-duplicate-case': 'error',
      'no-dupe-class-members': 'error',
      'no-func-assign': 'error',
      'no-const-assign': 'error',
      'no-unreachable': 'error',
      'no-unsafe-finally': 'error',
      'no-unsafe-negation': 'error',
      'no-self-assign': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      'no-import-assign': 'error',
      'no-setter-return': 'error',
      'getter-return': 'error',
      'no-compare-neg-zero': 'error',
      'no-sparse-arrays': 'error',
    },
  },
];
