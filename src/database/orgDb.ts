import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
    OrgParser,
    OrgDocument,
    OrgHeading,
    OrgSourceBlock,
    OrgLink,
    parseMarkdownCodeBlocks,
    extractHashtags,
    extractMentions
} from '../parser/orgParser';

/**
 * Database record types
 */
export interface FileRecord {
    id: number;
    path: string;
    mtime: number;
    hash: string;
}

export interface HeadingRecord {
    id: number;
    fileId: number;
    filePath: string;
    level: number;
    title: string;
    lineNumber: number;
    todoState?: string;
    priority?: string;
    tags: string[];
    properties: Record<string, string>;
}

export interface SourceBlockRecord {
    id: number;
    fileId: number;
    filePath: string;
    language: string;
    content: string;
    lineNumber: number;
}

export interface LinkRecord {
    id: number;
    fileId: number;
    filePath: string;
    type: string;
    target: string;
    description?: string;
    lineNumber: number;
}

export interface SearchResult {
    type: 'heading' | 'block' | 'link' | 'content';
    filePath: string;
    lineNumber: number;
    title?: string;
    preview: string;
    score: number;
}

/**
 * In-memory org database for fast searching
 * Uses Map-based storage for quick lookups
 * Can be persisted to JSON for caching
 */
export class OrgDb {
    private files: Map<string, FileRecord> = new Map();
    private headings: HeadingRecord[] = [];
    private sourceBlocks: SourceBlockRecord[] = [];
    private links: LinkRecord[] = [];
    private hashtags: Map<string, Set<string>> = new Map(); // hashtag -> file paths
    private mentions: Map<string, Set<string>> = new Map(); // @mention -> file paths
    private fullTextIndex: Map<string, string> = new Map(); // file path -> content

    private parser: OrgParser;
    private dbPath: string;
    private context: vscode.ExtensionContext;
    private nextId: number = 1;
    private isDirty: boolean = false;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.parser = new OrgParser();
        this.dbPath = path.join(context.globalStorageUri.fsPath, 'org-db.json');
    }

    /**
     * Initialize the database
     */
    public async initialize(): Promise<void> {
        // Ensure storage directory exists
        const storageDir = this.context.globalStorageUri.fsPath;
        if (!fs.existsSync(storageDir)) {
            fs.mkdirSync(storageDir, { recursive: true });
        }

        // Load existing database if available
        await this.load();
    }

    /**
     * Load database from disk cache
     */
    private async load(): Promise<void> {
        try {
            if (fs.existsSync(this.dbPath)) {
                const data = JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));

                this.files = new Map(Object.entries(data.files || {}));
                this.headings = data.headings || [];
                this.sourceBlocks = data.sourceBlocks || [];
                this.links = data.links || [];
                this.nextId = data.nextId || 1;

                // Rebuild hashtag and mention indexes
                for (const [tag, paths] of Object.entries(data.hashtags || {})) {
                    this.hashtags.set(tag, new Set(paths as string[]));
                }
                for (const [mention, paths] of Object.entries(data.mentions || {})) {
                    this.mentions.set(mention, new Set(paths as string[]));
                }

                console.log(`OrgDb: Loaded ${this.files.size} files from cache`);
            }
        } catch (error) {
            console.error('OrgDb: Failed to load cache', error);
        }
    }

    /**
     * Save database to disk cache
     */
    public async save(): Promise<void> {
        if (!this.isDirty) return;

        try {
            const data = {
                files: Object.fromEntries(this.files),
                headings: this.headings,
                sourceBlocks: this.sourceBlocks,
                links: this.links,
                nextId: this.nextId,
                hashtags: Object.fromEntries(
                    Array.from(this.hashtags.entries()).map(([k, v]) => [k, Array.from(v)])
                ),
                mentions: Object.fromEntries(
                    Array.from(this.mentions.entries()).map(([k, v]) => [k, Array.from(v)])
                )
            };

            fs.writeFileSync(this.dbPath, JSON.stringify(data, null, 2), 'utf8');
            this.isDirty = false;
            console.log('OrgDb: Saved cache');
        } catch (error) {
            console.error('OrgDb: Failed to save cache', error);
        }
    }

    /**
     * Index a directory recursively
     */
    public async indexDirectory(
        directory: string,
        progress?: vscode.Progress<{ message?: string; increment?: number }>
    ): Promise<number> {
        const files = await this.findFiles(directory);
        let indexed = 0;

        for (const filePath of files) {
            const needsUpdate = await this.needsReindex(filePath);
            if (needsUpdate) {
                await this.indexFile(filePath);
                indexed++;
            }

            if (progress) {
                progress.report({
                    message: `Indexing: ${path.basename(filePath)}`,
                    increment: 100 / files.length
                });
            }
        }

        await this.save();
        return indexed;
    }

    /**
     * Find all org and markdown files in a directory
     */
    private async findFiles(directory: string): Promise<string[]> {
        const files: string[] = [];
        const config = vscode.workspace.getConfiguration('scimax.db');
        const excludePatterns = config.get<string[]>('excludePatterns') || [];

        const walk = (dir: string) => {
            const items = fs.readdirSync(dir, { withFileTypes: true });

            for (const item of items) {
                const fullPath = path.join(dir, item.name);

                // Check exclude patterns
                const shouldExclude = excludePatterns.some(pattern => {
                    const minimatch = require('minimatch');
                    return minimatch(fullPath, pattern);
                });

                if (shouldExclude) continue;

                if (item.isDirectory() && !item.name.startsWith('.')) {
                    walk(fullPath);
                } else if (item.isFile()) {
                    const ext = path.extname(item.name).toLowerCase();
                    if (ext === '.org' || ext === '.md') {
                        files.push(fullPath);
                    }
                }
            }
        };

        try {
            walk(directory);
        } catch (error) {
            console.error('OrgDb: Error walking directory', error);
        }

        return files;
    }

    /**
     * Check if a file needs to be reindexed
     */
    private async needsReindex(filePath: string): Promise<boolean> {
        const existing = this.files.get(filePath);
        if (!existing) return true;

        try {
            const stats = fs.statSync(filePath);
            return stats.mtimeMs > existing.mtime;
        } catch {
            return true;
        }
    }

    /**
     * Index a single file
     */
    public async indexFile(filePath: string): Promise<void> {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const stats = fs.statSync(filePath);
            const ext = path.extname(filePath).toLowerCase();

            // Remove old records for this file
            this.removeFileRecords(filePath);

            // Create file record
            const fileId = this.nextId++;
            const hash = this.simpleHash(content);

            this.files.set(filePath, {
                id: fileId,
                path: filePath,
                mtime: stats.mtimeMs,
                hash
            });

            // Store full text for search
            this.fullTextIndex.set(filePath, content);

            // Parse and index content
            if (ext === '.org') {
                const doc = this.parser.parse(content);
                this.indexOrgDocument(fileId, filePath, doc);
            } else if (ext === '.md') {
                this.indexMarkdownDocument(fileId, filePath, content);
            }

            // Extract and index hashtags and mentions
            const hashtags = extractHashtags(content);
            for (const tag of hashtags) {
                if (!this.hashtags.has(tag)) {
                    this.hashtags.set(tag, new Set());
                }
                this.hashtags.get(tag)!.add(filePath);
            }

            const mentions = extractMentions(content);
            for (const mention of mentions) {
                if (!this.mentions.has(mention)) {
                    this.mentions.set(mention, new Set());
                }
                this.mentions.get(mention)!.add(filePath);
            }

            this.isDirty = true;
        } catch (error) {
            console.error(`OrgDb: Failed to index ${filePath}`, error);
        }
    }

    /**
     * Index an org document
     */
    private indexOrgDocument(fileId: number, filePath: string, doc: OrgDocument): void {
        // Index headings
        const flatHeadings = this.parser.flattenHeadings(doc);
        for (const heading of flatHeadings) {
            this.headings.push({
                id: this.nextId++,
                fileId,
                filePath,
                level: heading.level,
                title: heading.title,
                lineNumber: heading.lineNumber,
                todoState: heading.todoState,
                priority: heading.priority,
                tags: heading.tags,
                properties: heading.properties
            });
        }

        // Index source blocks
        for (const block of doc.sourceBlocks) {
            this.sourceBlocks.push({
                id: this.nextId++,
                fileId,
                filePath,
                language: block.language,
                content: block.content,
                lineNumber: block.lineNumber
            });
        }

        // Index links
        for (const link of doc.links) {
            this.links.push({
                id: this.nextId++,
                fileId,
                filePath,
                type: link.type,
                target: link.target,
                description: link.description,
                lineNumber: link.lineNumber
            });
        }
    }

    /**
     * Index a markdown document
     */
    private indexMarkdownDocument(fileId: number, filePath: string, content: string): void {
        const lines = content.split('\n');

        // Index headings (# syntax)
        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(/^(#{1,6})\s+(.*)$/);
            if (match) {
                const level = match[1].length;
                let title = match[2];
                const tags: string[] = [];

                // Extract tags from end of heading
                const tagMatch = title.match(/\s+#(\w+(?:\s+#\w+)*)$/);
                if (tagMatch) {
                    tags.push(...tagMatch[1].split(/\s+#/));
                    title = title.slice(0, -tagMatch[0].length);
                }

                // Check for TODO in brackets
                let todoState: string | undefined;
                const todoMatch = title.match(/^\[([A-Z]+)\]\s+/);
                if (todoMatch) {
                    todoState = todoMatch[1];
                    title = title.slice(todoMatch[0].length);
                }

                this.headings.push({
                    id: this.nextId++,
                    fileId,
                    filePath,
                    level,
                    title: title.trim(),
                    lineNumber: i + 1,
                    todoState,
                    tags,
                    properties: {}
                });
            }
        }

        // Index code blocks
        const blocks = parseMarkdownCodeBlocks(content);
        for (const block of blocks) {
            this.sourceBlocks.push({
                id: this.nextId++,
                fileId,
                filePath,
                language: block.language,
                content: block.content,
                lineNumber: block.lineNumber
            });
        }

        // Index links (markdown syntax)
        const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
        for (let i = 0; i < lines.length; i++) {
            let match;
            while ((match = linkRegex.exec(lines[i])) !== null) {
                const target = match[2];
                let type = 'internal';
                if (target.startsWith('http://') || target.startsWith('https://')) {
                    type = 'http';
                } else if (target.startsWith('/') || target.startsWith('./')) {
                    type = 'file';
                }

                this.links.push({
                    id: this.nextId++,
                    fileId,
                    filePath,
                    type,
                    target,
                    description: match[1],
                    lineNumber: i + 1
                });
            }
        }
    }

    /**
     * Remove all records for a file
     */
    private removeFileRecords(filePath: string): void {
        this.files.delete(filePath);
        this.headings = this.headings.filter(h => h.filePath !== filePath);
        this.sourceBlocks = this.sourceBlocks.filter(b => b.filePath !== filePath);
        this.links = this.links.filter(l => l.filePath !== filePath);
        this.fullTextIndex.delete(filePath);

        // Remove from hashtag and mention indexes
        for (const [, paths] of this.hashtags) {
            paths.delete(filePath);
        }
        for (const [, paths] of this.mentions) {
            paths.delete(filePath);
        }
    }

    /**
     * Search headings
     */
    public searchHeadings(query: string): HeadingRecord[] {
        const queryLower = query.toLowerCase();
        return this.headings.filter(h =>
            h.title.toLowerCase().includes(queryLower)
        ).sort((a, b) => {
            // Prioritize exact matches and start-of-string matches
            const aTitle = a.title.toLowerCase();
            const bTitle = b.title.toLowerCase();
            const aStarts = aTitle.startsWith(queryLower);
            const bStarts = bTitle.startsWith(queryLower);
            if (aStarts && !bStarts) return -1;
            if (!aStarts && bStarts) return 1;
            return aTitle.localeCompare(bTitle);
        });
    }

    /**
     * Search source blocks by language
     */
    public searchSourceBlocks(language?: string, contentQuery?: string): SourceBlockRecord[] {
        let results = this.sourceBlocks;

        if (language) {
            results = results.filter(b => b.language === language.toLowerCase());
        }

        if (contentQuery) {
            const queryLower = contentQuery.toLowerCase();
            results = results.filter(b => b.content.toLowerCase().includes(queryLower));
        }

        return results;
    }

    /**
     * Search links by type or target
     */
    public searchLinks(type?: string, targetQuery?: string): LinkRecord[] {
        let results = this.links;

        if (type) {
            results = results.filter(l => l.type === type);
        }

        if (targetQuery) {
            const queryLower = targetQuery.toLowerCase();
            results = results.filter(l =>
                l.target.toLowerCase().includes(queryLower) ||
                (l.description?.toLowerCase().includes(queryLower))
            );
        }

        return results;
    }

    /**
     * Full-text search across all files
     */
    public searchFullText(query: string): SearchResult[] {
        const results: SearchResult[] = [];
        const queryLower = query.toLowerCase();

        for (const [filePath, content] of this.fullTextIndex) {
            const contentLower = content.toLowerCase();
            let index = contentLower.indexOf(queryLower);

            while (index !== -1) {
                // Find line number
                const beforeMatch = content.slice(0, index);
                const lineNumber = beforeMatch.split('\n').length;

                // Get context (the line containing the match)
                const lines = content.split('\n');
                const line = lines[lineNumber - 1] || '';

                results.push({
                    type: 'content',
                    filePath,
                    lineNumber,
                    preview: line.trim().slice(0, 100),
                    score: 1
                });

                // Find next occurrence
                index = contentLower.indexOf(queryLower, index + 1);
            }
        }

        return results;
    }

    /**
     * Find files by hashtag
     */
    public findByHashtag(tag: string): string[] {
        const paths = this.hashtags.get(tag.toLowerCase());
        return paths ? Array.from(paths) : [];
    }

    /**
     * Find files by @mention
     */
    public findByMention(mention: string): string[] {
        const paths = this.mentions.get(mention.toLowerCase());
        return paths ? Array.from(paths) : [];
    }

    /**
     * Get all unique hashtags
     */
    public getAllHashtags(): string[] {
        return Array.from(this.hashtags.keys()).sort();
    }

    /**
     * Get all unique mentions
     */
    public getAllMentions(): string[] {
        return Array.from(this.mentions.keys()).sort();
    }

    /**
     * Get all TODO items
     */
    public getTodos(state?: string): HeadingRecord[] {
        return this.headings.filter(h => {
            if (!h.todoState) return false;
            if (state) return h.todoState === state;
            return true;
        });
    }

    /**
     * Get database stats
     */
    public getStats(): { files: number; headings: number; blocks: number; links: number } {
        return {
            files: this.files.size,
            headings: this.headings.length,
            blocks: this.sourceBlocks.length,
            links: this.links.length
        };
    }

    /**
     * Simple hash function for content comparison
     */
    private simpleHash(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString(16);
    }

    /**
     * Clear the database
     */
    public clear(): void {
        this.files.clear();
        this.headings = [];
        this.sourceBlocks = [];
        this.links = [];
        this.hashtags.clear();
        this.mentions.clear();
        this.fullTextIndex.clear();
        this.nextId = 1;
        this.isDirty = true;
    }
}
