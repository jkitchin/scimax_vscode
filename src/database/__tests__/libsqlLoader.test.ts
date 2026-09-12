import { describe, it, expect } from 'vitest';
import { withSafeProcessReport, loadLibsqlClient } from '../libsqlLoader';

type ProcessReport = { getReport: (...args: unknown[]) => unknown };
const proc = process as unknown as { report?: ProcessReport };

describe('withSafeProcessReport', () => {
    it('turns an undefined report into an empty object and restores getReport', async () => {
        if (!proc.report) return;
        const real = proc.report.getReport;
        const broken = () => undefined;
        proc.report.getReport = broken;
        try {
            const seen = await withSafeProcessReport(async () => proc.report!.getReport());
            expect(seen).toEqual({});
            // detect-libc's check must not throw on the patched report
            expect(() => (seen as { header?: unknown }).header).not.toThrow();
            expect(proc.report.getReport).toBe(broken);
        } finally {
            proc.report.getReport = real;
        }
    });

    it('passes a real report through unchanged', async () => {
        if (!proc.report) return;
        const real = proc.report.getReport;
        const fake = { header: { glibcVersionRuntime: '2.39' } };
        proc.report.getReport = () => fake;
        try {
            expect(await withSafeProcessReport(async () => proc.report!.getReport())).toBe(fake);
        } finally {
            proc.report.getReport = real;
        }
    });

    it('restores getReport when the wrapped function throws', async () => {
        if (!proc.report) return;
        const real = proc.report.getReport;
        await expect(withSafeProcessReport(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
        expect(proc.report.getReport).toBe(real);
    });
});

describe('loadLibsqlClient', () => {
    it('loads createClient', async () => {
        const mod = await loadLibsqlClient();
        expect(typeof mod.createClient).toBe('function');
    });
});
