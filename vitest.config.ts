import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/**/*.d.ts'],
      thresholds: {
        // Spec §5: >85% on core modules
        'src/anomaly/**': { lines: 85, functions: 85, statements: 85 },
        'src/mcp/tools/**': { lines: 85, functions: 85, statements: 85 },
        'src/chat/cards.ts': { lines: 85, functions: 85, statements: 85 },
        'src/config/**': { lines: 85, functions: 85, statements: 85 },
      },
    },
  },
});
