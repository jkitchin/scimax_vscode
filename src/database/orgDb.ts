import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import {
    OrgParser,
    OrgDocument,
    OrgHeading,
    OrgSourceBlock,
    OrgLink,
    OrgTimestamp,
    parseMarkdownCodeBlocks,
    extractHashtags,
    extractMentions
} from '../parser/orgParser';

/**
 * Database record types - Enhanced for org-db-v3
 */
export interface FileRecord {
    id: number;
    path: string;
    mtime: number;
    hash: string;
    size: number;
    indexedAt: number;
    keywords: Record<string, string>;
}

export interface HeadingRecord {
    id: number;
    fileId: number;
    filePath: string;
    level: number;
    title: string;
    lineNumber: number;
    begin: number;  // Character position
    todoState?: string;
    priority?: string;
    tags: string[];
    inheritedTags: string[];
    properties: Record<string, string>;
    scheduled?: string;
    deadline?: string;
    closed?: string;
}

export interface SourceBlockRecord {
    id: number;
    fileId: number;
    filePath: string;
    language: string;
    content: string;
    lineNumber: number;
    headers: Record<string, string>;
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

export interface TimestampRecord {
    id: number;
    fileId: number;
    filePath: string;
    type: 'active' | 'inactive' | 'scheduled' | 'deadline' | 'closed';
    date: string;
    time?: string;
    repeater?: string;
    lineNumber: number;
}

export interface SearchResult {
    type: 'heading' | 'block' | 'link' | 'content' | 'property';
    filePath: string;
    lineNumber: number;
    title?: string;
    preview: string;
    score: number;
    matchContext?: string;
}

export interface AgendaItem {
    type: 'deadline' | 'scheduled' | 'todo';
    heading: HeadingRecord;
    date?: string;
    daysUntil?: number;
    overdue?: boolean;
}

export interface SearchScope {
    type: 'all' | 'directory' | 'project';
    path?: string;
    keyword?: string;
}

export interface IgnorePattern {
    pattern: string;
    enabled: boolean;
    type: 'glob' | 'regex';
}

export interface DbStats {
    files: number;
    headings: number;
    blocks: number;
    links: number;
    timestamps: number;
    todoItems: number;
    deadlines: number;
    scheduled: number;
    lastIndexed?: number;
}

/**
 * Enhanced org database inspired by org-db-v3
 * Features: Full-text search, agenda, property search, scoped queries
 */
export class OrgDb {
    private files: Map<string, FileRecord> = new Map();
    private headings: HeadingRecord[] = [];
    private sourceBlocks: SourceBlockRecord[] = [];
    private links: LinkRecord[] = [];
    private timestamps: TimestampRecord[] = [];
    private hashtags: Map<string, Set<string>> = new Map();
    private mentions: Map<string, Set<string>> = new Map();
    private fullTextIndex: Map<string, string> = new Map();
    private ignorePatterns: IgnorePattern[] = [];

    private parser: OrgParser;
    private dbPath: string;
    private context: vscode.ExtensionContext;
    private nextId: number = 1;
    private isDirty: boolean = false;
    private searchScope: SearchScope = { type: 'all' };
    private fileWatcher: vscode.FileSystemWatcher | undefined;
    private indexQueue: Set<string> = new Set();
    private isIndexing: boolean = false;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.parser = new OrgParser();
        this.dbPath = path.join(context.globalStorageUri.fsPath, 'org-db-v3.json');
    }

    /**
     * Initialize the database
     */
    public async initialize(): Promise<void> {
        const storageDir = this.context.globalStorageUri.fsPath;
        if (!fs.existsSync(storageDir)) {
            fs.mkdirSync(storageDir, { recursive: true });
        }

        await this.load();
        this.setupFileWatcher();
        this.loadIgnorePatterns();
    }

    /**
     * Setup file watcher for auto-indexing
     */
    private setupFileWatcher(): void {
        this.fileWatcher = vscode.workspace.createFileSystemWatcher(
            '**/*.{org,md}',
            false, false, false
        );

        this.fileWatcher.onDidCreate(uri => this.queueIndex(uri.fsPath));
        this.fileWatcher.onDidChange(uri => this.queueIndex(uri.fsPath));
        this.fileWatcher.onDidDelete(uri => this.removeFile(uri.fsPath));

        this.context.subscriptions.push(this.fileWatcher);
    }

    /**
     * Queue a file for indexing (debounced)
     */
    private queueIndex(filePath: string): void {
        if (this.shouldIgnore(filePath)) return;

        this.indexQueue.add(filePath);

        if (!this.isIndexing) {
            setTimeout(() => this.processIndexQueue(), 500);
        }
    }

    /**
     * Process the index queue
     */
    private async processIndexQueue(): Promise<void> {
        if (this.indexQueue.size === 0) return;

        this.isIndexing = true;
        const files = Array.from(this.indexQueue);
        this.indexQueue.clear();

        for (const filePath of files) {
            try {
                await this.indexFile(filePath);
            } catch (error) {
                console.error(`OrgDb: Failed to index ${filePath}`, error);
            }
        }

        await this.save();
        this.isIndexing = false;

        // Check if more files were queued during indexing
        if (this.indexQueue.size > 0) {
            setTimeout(() => this.processIndexQueue(), 100);
        }
    }

    /**
     * Load ignore patterns from configuration
     */
    private loadIgnorePatterns(): void {
        const config = vscode.workspace.getConfiguration('scimax.db');
        const patterns = config.get<string[]>('ignorePatterns') || [
            '**/node_modules/**',
            '**/.git/**',
            '**/dist/**',
            '**/build/**'
        ];

        this.ignorePatterns = patterns.map(p => ({
            pattern: p,
            enabled: true,
            type: 'glob' as const
        }));
    }

    /**
     * Check if a file should be ignored
     */
    private shouldIgnore(filePath: string): boolean {
        const minimatch = require('minimatch');

        for (const pattern of this.ignorePatterns) {
            if (!pattern.enabled) continue;

            if (pattern.type === 'glob') {
                if (minimatch(filePath, pattern.pattern)) return true;
            } else {
                try {
                    if (new RegExp(pattern.pattern).test(filePath)) return true;
                } catch {
                    // Invalid regex, skip
                }
            }
        }

        return false;
    }

    /**
     * Load database from disk cache
     */
    private async load(): Promise<void> {
        try {
            if (fs.existsSync(this.dbPath)) {
                const data = JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));

                this.files = new Map(Object.entries(data.files || {}).map(
                    ([k, v]: [string, any]) => [k, v as FileRecord]
                ));
                this.headings = data.headings || [];
                this.sourceBlocks = data.sourceBlocks || [];
                this.links = data.links || [];
                this.timestamps = data.timestamps || [];
                this.nextId = data.nextId || 1;

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
                timestamps: this.timestamps,
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
     * Set search scope
     */
    public setSearchScope(scope: SearchScope): void {
        this.searchScope = scope;
    }

    /**
     * Get current search scope
     */
    public getSearchScope(): SearchScope {
        return this.searchScope;
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

        const walk = (dir: string) => {
            try {
                const items = fs.readdirSync(dir, { withFileTypes: true });

                for (const item of items) {
                    const fullPath = path.join(dir, item.name);

                    if (this.shouldIgnore(fullPath)) continue;

                    if (item.isDirectory() && !item.name.startsWith('.')) {
                        walk(fullPath);
                    } else if (item.isFile()) {
                        const ext = path.extname(item.name).toLowerCase();
                        if (ext === '.org' || ext === '.md') {
                            files.push(fullPath);
                        }
                    }
                }
            } catch (error) {
                console.error(`OrgDb: Error walking ${dir}`, error);
            }
        };

        walk(directory);
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

            this.removeFileRecords(filePath);

            const fileId = this.nextId++;
            const hash = crypto.createHash('md5').update(content).digest('hex');

            const fileRecord: FileRecord = {
                id: fileId,
                path: filePath,
                mtime: stats.mtimeMs,
                hash,
                size: stats.size,
                indexedAt: Date.now(),
                keywords: {}
            };

            this.fullTextIndex.set(filePath, content);

            if (ext === '.org') {
                const doc = this.parser.parse(content);
                fileRecord.keywords = doc.keywords;
                this.indexOrgDocument(fileId, filePath, doc, content);
            } else if (ext === '.md') {
                this.indexMarkdownDocument(fileId, filePath, content);
            }

            this.files.set(filePath, fileRecord);

            // Extract hashtags and mentions
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
     * Index an org document with enhanced metadata
     */
    private indexOrgDocument(
        fileId: number,
        filePath: string,
        doc: OrgDocument,
        content: string
    ): void {
        const lines = content.split('\n');
        let charPos = 0;
        const linePositions: number[] = [];

        for (const line of lines) {
            linePositions.push(charPos);
            charPos += line.length + 1;
        }

        // Collect inherited tags
        const flatHeadings = this.parser.flattenHeadings(doc);
        const tagStack: string[][] = [];

        for (const heading of flatHeadings) {
            // Manage tag inheritance stack
            while (tagStack.length >= heading.level) {
                tagStack.pop();
            }

            const inheritedTags = tagStack.flat();
            tagStack.push(heading.tags);

            // Find scheduling info in the content after heading
            const headingLine = heading.lineNumber - 1;
            let scheduled: string | undefined;
            let deadline: string | undefined;
            let closed: string | undefined;

            // Look at lines after heading for scheduling
            for (let i = headingLine + 1; i < Math.min(headingLine + 5, lines.length); i++) {
                const line = lines[i];
                if (line.match(/^\*+\s/)) break; // Next heading

                const schedMatch = line.match(/SCHEDULED:\s*<(\d{4}-\d{2}-\d{2}[^>]*)>/);
                if (schedMatch) scheduled = schedMatch[1];

                const deadMatch = line.match(/DEADLINE:\s*<(\d{4}-\d{2}-\d{2}[^>]*)>/);
                if (deadMatch) deadline = deadMatch[1];

                const closedMatch = line.match(/CLOSED:\s*\[(\d{4}-\d{2}-\d{2}[^\]]*)\]/);
                if (closedMatch) closed = closedMatch[1];
            }

            this.headings.push({
                id: this.nextId++,
                fileId,
                filePath,
                level: heading.level,
                title: heading.title,
                lineNumber: heading.lineNumber,
                begin: linePositions[headingLine] || 0,
                todoState: heading.todoState,
                priority: heading.priority,
                tags: heading.tags,
                inheritedTags,
                properties: heading.properties,
                scheduled,
                deadline,
                closed
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
                lineNumber: block.lineNumber,
                headers: block.headers
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

        // Index timestamps
        for (const ts of doc.timestamps) {
            this.timestamps.push({
                id: this.nextId++,
                fileId,
                filePath,
                type: ts.type,
                date: ts.date,
                time: ts.time,
                repeater: ts.repeater,
                lineNumber: ts.lineNumber
            });
        }
    }

    /**
     * Index a markdown document
     */
    private indexMarkdownDocument(fileId: number, filePath: string, content: string): void {
        const lines = content.split('\n');
        let charPos = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNumber = i + 1;

            // Parse headings
            const match = line.match(/^(#{1,6})\s+(.*)$/);
            if (match) {
                const level = match[1].length;
                let title = match[2];
                const tags: string[] = [];

                const tagMatch = title.match(/\s+#(\w+(?:\s+#\w+)*)$/);
                if (tagMatch) {
                    tags.push(...tagMatch[1].split(/\s+#/));
                    title = title.slice(0, -tagMatch[0].length);
                }

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
                    lineNumber,
                    begin: charPos,
                    todoState,
                    tags,
                    inheritedTags: [],
                    properties: {}
                });
            }

            charPos += line.length + 1;
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
                lineNumber: block.lineNumber,
                headers: block.headers
            });
        }

        // Index links
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
     * Remove a file from the database
     */
    public removeFile(filePath: string): void {
        this.removeFileRecords(filePath);
        this.isDirty = true;
    }

    /**
     * Remove all records for a file
     */
    private removeFileRecords(filePath: string): void {
        this.files.delete(filePath);
        this.headings = this.headings.filter(h => h.filePath !== filePath);
        this.sourceBlocks = this.sourceBlocks.filter(b => b.filePath !== filePath);
        this.links = this.links.filter(l => l.filePath !== filePath);
        this.timestamps = this.timestamps.filter(t => t.filePath !== filePath);
        this.fullTextIndex.delete(filePath);

        for (const [, paths] of this.hashtags) {
            paths.delete(filePath);
        }
        for (const [, paths] of this.mentions) {
            paths.delete(filePath);
        }
    }

    /**
     * Apply scope filter to headings
     */
    private applyScopeFilter<T extends { filePath: string }>(items: T[]): T[] {
        if (this.searchScope.type === 'all') return items;

        return items.filter(item => {
            if (this.searchScope.type === 'directory' && this.searchScope.path) {
                if (!item.filePath.startsWith(this.searchScope.path)) return false;
            }

            if (this.searchScope.keyword) {
                const file = this.files.get(item.filePath);
                if (!file) return false;
                const hasKeyword = Object.values(file.keywords).some(
                    v => v.toLowerCase().includes(this.searchScope.keyword!.toLowerCase())
                );
                if (!hasKeyword) return false;
            }

            return true;
        });
    }

    /**
     * Search headings with enhanced ranking
     */
    public searchHeadings(query: string, options?: {
        todoState?: string;
        tag?: string;
        property?: { name: string; value?: string };
        limit?: number;
    }): HeadingRecord[] {
        const queryLower = query.toLowerCase();
        let results = this.applyScopeFilter(this.headings);

        // Filter by query
        if (query) {
            results = results.filter(h =>
                h.title.toLowerCase().includes(queryLower)
            );
        }

        // Filter by TODO state
        if (options?.todoState) {
            results = results.filter(h => h.todoState === options.todoState);
        }

        // Filter by tag (including inherited)
        if (options?.tag) {
            const tagLower = options.tag.toLowerCase();
            results = results.filter(h =>
                h.tags.some(t => t.toLowerCase() === tagLower) ||
                h.inheritedTags.some(t => t.toLowerCase() === tagLower)
            );
        }

        // Filter by property
        if (options?.property) {
            results = results.filter(h => {
                const value = h.properties[options.property!.name];
                if (!value) return false;
                if (options.property!.value) {
                    return value.toLowerCase().includes(options.property!.value.toLowerCase());
                }
                return true;
            });
        }

        // Sort by relevance
        results.sort((a, b) => {
            const aTitle = a.title.toLowerCase();
            const bTitle = b.title.toLowerCase();
            const aStarts = aTitle.startsWith(queryLower);
            const bStarts = bTitle.startsWith(queryLower);
            if (aStarts && !bStarts) return -1;
            if (!aStarts && bStarts) return 1;
            return aTitle.localeCompare(bTitle);
        });

        return options?.limit ? results.slice(0, options.limit) : results;
    }

    /**
     * Search by property
     */
    public searchByProperty(propertyName: string, value?: string): HeadingRecord[] {
        let results = this.applyScopeFilter(this.headings);

        results = results.filter(h => {
            const propValue = h.properties[propertyName];
            if (!propValue) return false;
            if (value) {
                return propValue.toLowerCase().includes(value.toLowerCase());
            }
            return true;
        });

        return results;
    }

    /**
     * Get agenda items (deadlines, scheduled, TODOs)
     */
    public getAgenda(options?: {
        before?: string;  // Date string or relative like '+2w'
        includeUnscheduled?: boolean;
    }): AgendaItem[] {
        const items: AgendaItem[] = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let beforeDate: Date | undefined;
        if (options?.before) {
            beforeDate = this.parseRelativeDate(options.before);
        }

        const headings = this.applyScopeFilter(this.headings);

        for (const heading of headings) {
            // Skip completed items
            if (heading.todoState === 'DONE' || heading.todoState === 'CANCELLED') {
                continue;
            }

            // Deadlines
            if (heading.deadline) {
                const deadlineDate = new Date(heading.deadline.split(' ')[0]);
                const daysUntil = Math.floor((deadlineDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

                if (!beforeDate || deadlineDate <= beforeDate) {
                    items.push({
                        type: 'deadline',
                        heading,
                        date: heading.deadline,
                        daysUntil,
                        overdue: daysUntil < 0
                    });
                }
            }

            // Scheduled
            if (heading.scheduled) {
                const scheduledDate = new Date(heading.scheduled.split(' ')[0]);
                const daysUntil = Math.floor((scheduledDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

                if (!beforeDate || scheduledDate <= beforeDate) {
                    items.push({
                        type: 'scheduled',
                        heading,
                        date: heading.scheduled,
                        daysUntil,
                        overdue: daysUntil < 0
                    });
                }
            }

            // Unscheduled TODOs
            if (options?.includeUnscheduled && heading.todoState && !heading.deadline && !heading.scheduled) {
                items.push({
                    type: 'todo',
                    heading
                });
            }
        }

        // Sort by date (overdue first, then by date)
        items.sort((a, b) => {
            if (a.overdue && !b.overdue) return -1;
            if (!a.overdue && b.overdue) return 1;
            if (a.daysUntil !== undefined && b.daysUntil !== undefined) {
                return a.daysUntil - b.daysUntil;
            }
            // Prioritize by priority
            const aPriority = a.heading.priority || 'Z';
            const bPriority = b.heading.priority || 'Z';
            return aPriority.localeCompare(bPriority);
        });

        return items;
    }

    /**
     * Parse relative date string like '+2w' or '+1m'
     */
    private parseRelativeDate(dateStr: string): Date {
        const date = new Date();

        if (dateStr.startsWith('+')) {
            const match = dateStr.match(/\+(\d+)([dwmy])/);
            if (match) {
                const amount = parseInt(match[1]);
                const unit = match[2];

                switch (unit) {
                    case 'd':
                        date.setDate(date.getDate() + amount);
                        break;
                    case 'w':
                        date.setDate(date.getDate() + amount * 7);
                        break;
                    case 'm':
                        date.setMonth(date.getMonth() + amount);
                        break;
                    case 'y':
                        date.setFullYear(date.getFullYear() + amount);
                        break;
                }
            }
        } else {
            return new Date(dateStr);
        }

        return date;
    }

    /**
     * Search source blocks by language
     */
    public searchSourceBlocks(language?: string, contentQuery?: string): SourceBlockRecord[] {
        let results = this.applyScopeFilter(this.sourceBlocks);

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
        let results = this.applyScopeFilter(this.links);

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
     * Full-text search with BM25-like ranking
     */
    public searchFullText(query: string, options?: {
        limit?: number;
        operator?: 'AND' | 'OR';
    }): SearchResult[] {
        const results: SearchResult[] = [];
        const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 0);
        const operator = options?.operator || 'AND';

        for (const [filePath, content] of this.fullTextIndex) {
            // Apply scope filter
            if (this.searchScope.type === 'directory' && this.searchScope.path) {
                if (!filePath.startsWith(this.searchScope.path)) continue;
            }

            const contentLower = content.toLowerCase();
            const lines = content.split('\n');

            // Check if file matches query
            let matches: boolean;
            if (operator === 'AND') {
                matches = terms.every(term => contentLower.includes(term));
            } else {
                matches = terms.some(term => contentLower.includes(term));
            }

            if (!matches) continue;

            // Find matching lines
            for (let i = 0; i < lines.length; i++) {
                const lineLower = lines[i].toLowerCase();
                const lineMatches = operator === 'AND'
                    ? terms.every(term => lineLower.includes(term))
                    : terms.some(term => lineLower.includes(term));

                if (lineMatches) {
                    // Calculate simple score based on term frequency
                    let score = 0;
                    for (const term of terms) {
                        const matches = lineLower.match(new RegExp(term, 'g'));
                        if (matches) score += matches.length;
                    }

                    results.push({
                        type: 'content',
                        filePath,
                        lineNumber: i + 1,
                        preview: lines[i].trim().slice(0, 150),
                        score,
                        matchContext: this.getContext(lines, i)
                    });
                }
            }
        }

        // Sort by score
        results.sort((a, b) => b.score - a.score);

        return options?.limit ? results.slice(0, options.limit) : results;
    }

    /**
     * Get context lines around a match
     */
    private getContext(lines: string[], lineIndex: number, contextSize: number = 1): string {
        const start = Math.max(0, lineIndex - contextSize);
        const end = Math.min(lines.length, lineIndex + contextSize + 1);
        return lines.slice(start, end).join('\n');
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
     * Get all unique tags from headings
     */
    public getAllTags(): string[] {
        const tags = new Set<string>();
        for (const heading of this.headings) {
            for (const tag of heading.tags) {
                tags.add(tag);
            }
        }
        return Array.from(tags).sort();
    }

    /**
     * Get all unique property names
     */
    public getAllPropertyNames(): string[] {
        const props = new Set<string>();
        for (const heading of this.headings) {
            for (const name of Object.keys(heading.properties)) {
                props.add(name);
            }
        }
        return Array.from(props).sort();
    }

    /**
     * Get all TODO items
     */
    public getTodos(state?: string): HeadingRecord[] {
        let results = this.applyScopeFilter(this.headings);

        return results.filter(h => {
            if (!h.todoState) return false;
            if (state) return h.todoState === state;
            return true;
        });
    }

    /**
     * Get all unique TODO states
     */
    public getAllTodoStates(): string[] {
        const states = new Set<string>();
        for (const heading of this.headings) {
            if (heading.todoState) {
                states.add(heading.todoState);
            }
        }
        return Array.from(states).sort();
    }

    /**
     * Get all files
     */
    public getFiles(): FileRecord[] {
        return Array.from(this.files.values());
    }

    /**
     * Get all languages used in source blocks
     */
    public getAllLanguages(): string[] {
        const langs = new Set<string>();
        for (const block of this.sourceBlocks) {
            langs.add(block.language);
        }
        return Array.from(langs).sort();
    }

    /**
     * Get file keywords
     */
    public getFileKeywords(filePath: string): Record<string, string> {
        return this.files.get(filePath)?.keywords || {};
    }

    /**
     * Get database stats
     */
    public getStats(): DbStats {
        const deadlines = this.headings.filter(h => h.deadline).length;
        const scheduled = this.headings.filter(h => h.scheduled).length;
        const todoItems = this.headings.filter(h => h.todoState).length;

        let lastIndexed: number | undefined;
        for (const file of this.files.values()) {
            if (!lastIndexed || file.indexedAt > lastIndexed) {
                lastIndexed = file.indexedAt;
            }
        }

        return {
            files: this.files.size,
            headings: this.headings.length,
            blocks: this.sourceBlocks.length,
            links: this.links.length,
            timestamps: this.timestamps.length,
            todoItems,
            deadlines,
            scheduled,
            lastIndexed
        };
    }

    /**
     * Clear the database
     */
    public clear(): void {
        this.files.clear();
        this.headings = [];
        this.sourceBlocks = [];
        this.links = [];
        this.timestamps = [];
        this.hashtags.clear();
        this.mentions.clear();
        this.fullTextIndex.clear();
        this.nextId = 1;
        this.isDirty = true;
    }

    /**
     * Optimize the database (clean up orphaned records)
     */
    public optimize(): void {
        // Remove entries for files that no longer exist
        const filesToRemove: string[] = [];

        for (const [filePath] of this.files) {
            if (!fs.existsSync(filePath)) {
                filesToRemove.push(filePath);
            }
        }

        for (const filePath of filesToRemove) {
            this.removeFileRecords(filePath);
        }

        if (filesToRemove.length > 0) {
            this.isDirty = true;
            console.log(`OrgDb: Removed ${filesToRemove.length} stale file entries`);
        }
    }
}
