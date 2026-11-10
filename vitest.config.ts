import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@main': resolve('src/main'),
      '@renderer': resolve('src/renderer')
    }
  },
  test: {
    include: ['tests/unit/**/*.spec.ts', 'tests/integration/**/*.spec.ts'],
    environment: 'node',
    reporters: 'default',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/shared/**/*.ts', 'src/main/services/**/*.ts', 'src/main/storage/**/*.ts', 'src/main/reminder/**/*.ts'],
      thresholds: {
        lines: 70
      }
    }
  }
})