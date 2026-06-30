/** @type {import('prettier').Config} */
module.exports = {
  singleQuote: true,
  trailingComma: 'es5',
  printWidth: 100,
  semi: true,
  overrides: [
    {
      files: '*.yaml.tftpl',
      options: {
        parser: 'yaml',
      },
    },
  ],
};
