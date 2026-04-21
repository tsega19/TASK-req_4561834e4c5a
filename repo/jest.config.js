module.exports = {
  preset: 'jest-preset-angular',
  setupFiles: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jsdom',
  testTimeout: 30000,
  testMatch: ['**/src/**/*.spec.ts', '**/tests/unit/**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'html'],
  collectCoverageFrom: [
    'src/app/**/*.ts',
    '!src/app/**/*.spec.ts',
    '!src/app/**/index.ts',
    // Istanbul cannot instrument `new Worker(new URL(..., import.meta.url))` —
    // the editor is still unit-tested by its spec, but excluded from coverage collection.
    '!src/app/features/canvas/canvas-editor.component.ts'
  ],
  coverageDirectory: '.tmp/coverage',
  coverageReporters: ['text-summary', 'lcov', 'json-summary'],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 90,
      lines: 90,
      statements: 90
    }
  },
  transform: {
    '^.+\\.(ts|mjs|js|html)$': ['jest-preset-angular', {
      tsconfig: '<rootDir>/tsconfig.spec.json',
      stringifyContentPathRegex: '\\.(html|svg)$'
    }]
  },
  transformIgnorePatterns: ['node_modules/(?!.*\\.mjs$|@angular|rxjs|idb)']
};
