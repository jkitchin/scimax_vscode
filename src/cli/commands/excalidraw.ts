/**
 * Excalidraw command - build, render, check and inspect drawings.
 *
 * `build` turns a compact JSON spec (see skills/scimax-excalidraw) into a
 * drawing the Excalidraw editor opens. Writing an `.excalidraw.svg` gives one
 * file that is both an editable drawing and an image for exports and GitHub.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
    checkScene,
    ExcalidrawScene,
    normalizeScene,
    parseSceneFile,
    renderSceneSvg,
    sceneLinks,
} from '../../excalidraw/scene';
import { checkSceneLinks } from '../../excalidraw/linkCheck';

interface CliConfig {
    dbPath: string;
    rootDir: string;
}

interface ParsedArgs {
    command: string;
    subcommand?: string;
    args: string[];
    flags: Record<string, string | boolean>;
}

const USAGE = `Usage: scimax excalidraw <subcommand> [options]

Subcommands:
    build <spec.json> -o <out>   Expand a spec (labels, from/to arrows, orgLink)
                                 into a drawing. <out> ending in .svg is an
                                 editable .excalidraw.svg; otherwise JSON.
                                 --stdin reads the spec from standard input.
    render <drawing> [-o <out>]  Write <drawing> as an editable .excalidraw.svg
                                 (default: next to it, same name)
    check <drawing>...           Report broken element references and org links
                                 (exit 1 on any problem)
    links <drawing>              List element links and the org links behind them
    json <drawing>               Print the scene stored in a drawing (also .svg)

Options:
    -o, --output <path>   Output file
    --json                Structured output (check, links)

A drawing is a .excalidraw, .excalidraw.json or .excalidraw.svg file.`;

function fail(message: string): never {
    console.error(message);
    process.exit(1);
}

function readScene(file: string): ExcalidrawScene {
    const filePath = path.resolve(file);
    if (!fs.existsSync(filePath)) fail(`File not found: ${file}`);
    const scene = parseSceneFile(fs.readFileSync(filePath, 'utf8'), filePath);
    if (!scene) fail(`${file}: no Excalidraw scene found`);
    return scene;
}

function readStdin(): string {
    return fs.readFileSync(0, 'utf8');
}

/** Write a scene as JSON or, for .svg paths, as an editable SVG. */
function writeScene(scene: ExcalidrawScene, out: string): void {
    const outPath = path.resolve(out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    if (/\.svg$/i.test(outPath)) {
        const svg = renderSceneSvg(scene, { embedScene: true });
        if (!svg) fail('Nothing to draw: the scene has no elements');
        fs.writeFileSync(outPath, svg);
    } else {
        fs.writeFileSync(outPath, JSON.stringify(scene, null, 2) + '\n');
    }
}

function defaultSvgPath(file: string): string {
    return file.replace(/(\.excalidraw)?(\.json|\.svg)?$/i, '') + '.excalidraw.svg';
}

function reportProblems(file: string, scene: ExcalidrawScene, json: boolean): number {
    const structural = checkScene(scene);
    const links = checkSceneLinks(scene, file);
    if (json) {
        console.log(JSON.stringify({ file, problems: structural, links }, null, 2));
    } else {
        for (const p of structural) console.log(`${file}: ${p}`);
        for (const l of links) console.log(`${file}: ${l.id}${l.text ? ` "${l.text}"` : ''}: ${l.link}: ${l.problem}`);
    }
    return structural.length + links.length;
}

export async function excalidrawCommand(_config: CliConfig, args: ParsedArgs): Promise<void> {
    const sub = args.subcommand;
    const files = args.args.slice(1);
    // The CLI parser reads the word after a flag as its value, so a file
    // written after a boolean flag (--json a.svg) lands there: take it back
    const flag = (name: string): boolean => {
        const value = args.flags[name];
        if (typeof value === 'string') files.push(value);
        return value !== undefined;
    };
    const json = flag('json');
    const stdin = flag('stdin');
    const outFlag = args.flags.output ?? args.flags.o;
    const out = typeof outFlag === 'string' ? outFlag : undefined;

    switch (sub) {
        case 'build': {
            if (!out) fail('build needs -o <out.excalidraw.svg | out.excalidraw>');
            if (!stdin && files.length !== 1) fail(USAGE);
            let spec: unknown;
            try {
                spec = JSON.parse(stdin ? readStdin() : fs.readFileSync(path.resolve(files[0]), 'utf8'));
            } catch (error) {
                fail(`Cannot read spec: ${(error as Error).message}`);
            }
            const scene = normalizeScene(spec);
            writeScene(scene, out);
            const problems = reportProblems(out, scene, false);
            console.log(`Wrote ${out} (${scene.elements.length} elements, ${sceneLinks(scene).length} links)`);
            if (problems > 0) process.exit(1);
            break;
        }
        case 'render': {
            if (files.length !== 1) fail(USAGE);
            const target = out ?? defaultSvgPath(files[0]);
            writeScene(readScene(files[0]), target);
            console.log(`Wrote ${target}`);
            break;
        }
        case 'check': {
            if (files.length === 0) fail(USAGE);
            let total = 0;
            for (const file of files) total += reportProblems(file, readScene(file), json);
            if (!json && total === 0) console.log('No problems found');
            if (total > 0) process.exit(1);
            break;
        }
        case 'links': {
            if (files.length !== 1) fail(USAGE);
            const links = sceneLinks(readScene(files[0]));
            if (json) {
                console.log(JSON.stringify(links, null, 2));
            } else {
                for (const l of links) {
                    console.log(`${l.id}${l.text ? ` "${l.text}"` : ''} -> ${l.orgLink ?? l.link}`);
                }
            }
            break;
        }
        case 'json': {
            if (files.length !== 1) fail(USAGE);
            console.log(JSON.stringify(readScene(files[0]), null, 2));
            break;
        }
        default:
            console.error(USAGE);
            process.exit(sub === undefined ? 0 : 1);
    }
}
