import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/*.test.ts'],
        exclude: [
            'out/**',
            'node_modules/**',
            // These tests require a local test-features.org file not in the repo
            'src/parser/__tests__/orgExportPdf.test.ts',
            'src/parser/__tests__/orgParserTiming.test.ts',
        ],
    }
});
