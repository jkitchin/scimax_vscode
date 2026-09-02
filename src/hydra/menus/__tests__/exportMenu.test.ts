/**
 * The export hydra lists loaded custom exporters (issue #56).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

vi.mock('vscode', () => ({
    workspace: { getConfiguration: vi.fn(() => ({ get: vi.fn(() => '') })) },
    window: {},
}));

import { exportMenu, refreshCustomExporterItems } from '../exportMenu';
import { ExporterRegistry } from '../../../export/customExporter';

function customGroup() {
    return exportMenu.groups.find(g => g.title === 'Custom Exporters')!;
}

async function writeExporter(dir: string, id: string, extra = ''): Promise<void> {
    const exporterDir = path.join(dir, id);
    await fs.promises.mkdir(exporterDir, { recursive: true });
    await fs.promises.writeFile(
        path.join(exporterDir, 'manifest.json'),
        JSON.stringify({
            id,
            name: `${id} export`,
            parent: 'latex',
            outputFormat: 'pdf',
            template: 'template.tex',
        }) + extra
    );
    await fs.promises.writeFile(path.join(exporterDir, 'template.tex'), '{{{body}}}');
}

describe('export hydra - custom exporters', () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'scimax-exporters-'));
        ExporterRegistry.getInstance().clear();
    });

    afterEach(async () => {
        ExporterRegistry.getInstance().clear();
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    it('offers the picker when nothing is loaded', () => {
        refreshCustomExporterItems();
        const keys = customGroup().items.map(i => i.key);
        expect(keys).toEqual(['c']);
    });

    it('lists each loaded exporter on a digit key', async () => {
        await writeExporter(tempDir, 'elsarticle');
        await writeExporter(tempDir, 'cmu-memo');
        await ExporterRegistry.getInstance().loadFromDirectory(tempDir);

        refreshCustomExporterItems();
        const items = customGroup().items;

        const exporterItems = items.filter(i => i.action === 'scimax.export.customById');
        expect(exporterItems).toHaveLength(2);
        expect(exporterItems.map(i => i.key)).toEqual(['1', '2']);
        expect(exporterItems.map(i => i.args?.[0]).sort()).toEqual(['cmu-memo', 'elsarticle']);
        expect(items.some(i => i.key === 'c')).toBe(true);
    });

    it('adds an entry pointing at exporters that failed to load', async () => {
        const broken = path.join(tempDir, 'broken');
        await fs.promises.mkdir(broken);
        await fs.promises.writeFile(path.join(broken, 'manifest.json'), '{ oops');
        await ExporterRegistry.getInstance().loadFromDirectory(tempDir);

        refreshCustomExporterItems();
        const problems = customGroup().items.find(i => i.action === 'scimax.export.showExporterProblems');
        expect(problems).toBeDefined();
        expect(problems?.label).toContain('1 exporter(s) failed to load');
    });

    it('is wired to the menu so it runs every time the hydra opens', () => {
        expect(exportMenu.onShow).toBe(refreshCustomExporterItems);
    });
});
