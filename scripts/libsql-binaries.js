#!/usr/bin/env node
/**
 * Put libsql's native binary for every platform into node_modules, so the
 * one VSIX works on Windows, macOS and Linux (issue #91).
 *
 * npm installs only the @libsql/<platform> package for the machine it runs
 * on, so a VSIX built on the Linux CI runner had only the Linux binary and
 * the database failed to start everywhere else.
 *
 *   node scripts/libsql-binaries.js fetch         download the missing ones
 *   node scripts/libsql-binaries.js check [vsix]  fail unless the VSIX (default:
 *                                                 this version's) has them all
 *
 * The packages are fetched with `npm pack`, which, unlike `npm install`,
 * does not skip packages for another os or cpu.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/** { '@libsql/darwin-arm64': '0.5.22', ... } from the installed libsql */
function platformPackages() {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/libsql/package.json'), 'utf8'));
    const deps = pkg.optionalDependencies || {};
    const names = Object.keys(deps).filter((name) => name.startsWith('@libsql/'));
    if (names.length === 0) throw new Error('libsql lists no @libsql/<platform> packages');
    return Object.fromEntries(names.map((name) => [name, deps[name]]));
}

/** The installed version of a package, or undefined */
function installedVersion(name) {
    try {
        return JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version;
    } catch {
        return undefined;
    }
}

function fetchAll() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-libsql-'));
    try {
        for (const [name, version] of Object.entries(platformPackages())) {
            if (installedVersion(name) === version) {
                console.log(`${name}@${version} already present`);
                continue;
            }
            const out = execFileSync(npm, ['pack', `${name}@${version}`, '--silent', '--pack-destination', tmp],
                { cwd: tmp, encoding: 'utf8' }).trim().split('\n').pop();
            const dest = path.join(root, 'node_modules', name);
            fs.rmSync(dest, { recursive: true, force: true });
            fs.mkdirSync(dest, { recursive: true });
            execFileSync('tar', ['-xzf', path.join(tmp, out), '-C', dest, '--strip-components=1']);
            if (installedVersion(name) !== version) throw new Error(`Unpacking ${name}@${version} failed`);
            console.log(`${name}@${version} added`);
        }
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

function check(vsix) {
    const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
    const file = vsix || path.join(root, `scimax-vscode-${version}.vsix`);
    const listing = execFileSync('unzip', ['-l', file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const missing = Object.keys(platformPackages())
        .filter((name) => !listing.includes(`extension/node_modules/${name}/index.node`));
    if (missing.length > 0) {
        console.error(`${path.basename(file)} is missing libsql binaries: ${missing.join(', ')}`);
        console.error('Run: node scripts/libsql-binaries.js fetch, then package again');
        process.exit(1);
    }
    console.log(`${path.basename(file)} has libsql binaries for all ${Object.keys(platformPackages()).length} platforms`);
}

const [command, arg] = process.argv.slice(2);
if (command === 'fetch') fetchAll();
else if (command === 'check') check(arg);
else {
    console.error('Usage: node scripts/libsql-binaries.js fetch | check [vsix]');
    process.exit(2);
}
