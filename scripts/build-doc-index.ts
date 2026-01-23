/**
 * Build Documentation Index
 *
 * This script parses all org files in the docs/ directory and creates
 * a searchable JSON index for the apropos help command.
 *
 * Run with: npx ts-node scripts/build-doc-index.ts
 */

import * as fs from 'fs';
import * as path from 'path';

interface DocEntry {
    /** Heading text */
    heading: string;
    /** Heading level (1-6) */
    level: number;
    /** Source file (relative to docs/) */
    file: string;
    /** Line number in the file */
    line: number;
    /** Content under this heading (first paragraph or so) */
    content: string;
    /** Parent heading path for context */
    path: string[];
    /** Commands mentioned (scimax.*) */
    commands: string[];
    /** Keybindings mentioned */
    keybindings: string[];
    /** Keywords for search (extracted from content) */
    keywords: string[];
}

interface DocIndex {
    /** When the index was built */
    buildDate: string;
    /** Number of entries */
    count: number;
    /** All documentation entries */
    entries: DocEntry[];
}

function extractHeadings(content: string, filename: string): DocEntry[] {
    const lines = content.split('\n');
    const entries: DocEntry[] = [];
    const headingStack: { text: string; level: number }[] = [];

    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const headingMatch = line.match(/^(\*+)\s+(?:⚠️\s*|👀\s*|✅\s*)?(.+)$/);

        if (headingMatch) {
            const level = headingMatch[1].length;
            const headingText = headingMatch[2].trim();

            // Update heading stack for path tracking
            while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
                headingStack.pop();
            }

            const pathArr = headingStack.map(h => h.text);
            headingStack.push({ text: headingText, level });

            // Extract content under this heading (up to next heading or 500 chars)
            let contentLines: string[] = [];
            let j = i + 1;
            let charCount = 0;
            while (j < lines.length && charCount < 500) {
                const nextLine = lines[j];
                if (nextLine.match(/^\*+\s/)) break; // Stop at next heading
                if (nextLine.trim()) {
                    contentLines.push(nextLine.trim());
                    charCount += nextLine.length;
                }
                j++;
            }

            const contentText = contentLines.join(' ').substring(0, 500);

            // Extract commands (scimax.*)
            const commands: string[] = [];
            const cmdRegex = /scimax\.[a-zA-Z0-9_.]+/g;
            const fullText = headingText + ' ' + contentText;
            let cmdMatch;
            while ((cmdMatch = cmdRegex.exec(fullText)) !== null) {
                if (!commands.includes(cmdMatch[0])) {
                    commands.push(cmdMatch[0]);
                }
            }

            // Extract keybindings (C-*, M-*, Ctrl+*, etc.)
            const keybindings: string[] = [];
            const kbRegex = /(?:C-[a-zA-Z0-9-]+(?:\s+C-[a-zA-Z0-9-]+)*|M-[a-zA-Z0-9-]+|Ctrl\+[a-zA-Z0-9+]+|Alt\+[a-zA-Z0-9+]+|Shift\+[a-zA-Z0-9+]+)/g;
            let kbMatch;
            while ((kbMatch = kbRegex.exec(fullText)) !== null) {
                const kb = kbMatch[0];
                if (!keybindings.includes(kb)) {
                    keybindings.push(kb);
                }
            }

            // Extract keywords (significant words for search)
            const keywords = extractKeywords(fullText);

            entries.push({
                heading: headingText,
                level,
                file: filename,
                line: i + 1,
                content: contentText,
                path: pathArr,
                commands,
                keybindings,
                keywords
            });
        }

        i++;
    }

    return entries;
}

function extractKeywords(text: string): string[] {
    // Remove org-mode syntax, commands, and common words
    const cleaned = text
        .replace(/scimax\.[a-zA-Z0-9_.]+/g, '')
        .replace(/[`'"~=\[\](){}|]/g, ' ')
        .replace(/#+[A-Z_]+:?/g, '')
        .toLowerCase();

    const words = cleaned.split(/\s+/);

    // Common words to exclude
    const stopWords = new Set([
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
        'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
        'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
        'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these',
        'those', 'it', 'its', 'you', 'your', 'we', 'our', 'they', 'their',
        'if', 'then', 'else', 'when', 'where', 'which', 'who', 'what', 'how',
        'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some',
        'such', 'no', 'not', 'only', 'same', 'so', 'than', 'too', 'very',
        'just', 'also', 'use', 'using', 'used', 'see', 'file', 'files'
    ]);

    const keywords = new Set<string>();
    for (const word of words) {
        const clean = word.replace(/[^a-z0-9-]/g, '');
        if (clean.length >= 3 && !stopWords.has(clean)) {
            keywords.add(clean);
        }
    }

    return Array.from(keywords).slice(0, 20); // Limit keywords per entry
}

function buildIndex(): DocIndex {
    const docsDir = path.join(__dirname, '..', 'docs');
    const entries: DocEntry[] = [];

    // Get all org files
    const files = fs.readdirSync(docsDir)
        .filter(f => f.endsWith('.org'))
        .sort();

    for (const file of files) {
        const filePath = path.join(docsDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const fileEntries = extractHeadings(content, file);
        entries.push(...fileEntries);
    }

    return {
        buildDate: new Date().toISOString(),
        count: entries.length,
        entries
    };
}

// Main execution
const index = buildIndex();

// Write to src/help/ directory for bundling
const outputDir = path.join(__dirname, '..', 'src', 'help');
const outputPath = path.join(outputDir, 'docIndex.json');

// Ensure directory exists
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// Check if content changed (ignore buildDate to avoid unnecessary updates)
let shouldWrite = true;
let existingBuildDate: string | null = null;

if (fs.existsSync(outputPath)) {
    try {
        const existing: DocIndex = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
        existingBuildDate = existing.buildDate;

        // Compare entries (excluding buildDate)
        const existingEntries = JSON.stringify(existing.entries);
        const newEntries = JSON.stringify(index.entries);

        if (existingEntries === newEntries && existing.count === index.count) {
            shouldWrite = false;
            console.log(`Documentation index unchanged, skipping write.`);
            console.log(`  Entries: ${index.count}`);
            console.log(`  Output: ${outputPath}`);
            console.log(`  Build date: ${existingBuildDate} (preserved)`);
        }
    } catch {
        // If we can't read existing file, write new one
    }
}

if (shouldWrite) {
    fs.writeFileSync(outputPath, JSON.stringify(index, null, 2));
    console.log(`Documentation index built successfully!`);
    console.log(`  Entries: ${index.count}`);
    console.log(`  Output: ${outputPath}`);
    console.log(`  Build date: ${index.buildDate}`);
}
