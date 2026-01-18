/**
 * Image Overlay Provider for Org-mode
 * Renders inline image thumbnails for image links, similar to Emacs overlays.
 *
 * VS Code Limitations:
 * - VS Code decorations cannot display arbitrary-sized inline images like Emacs overlays
 * - We use a combination of gutter icons and after-content decorations
 * - Thumbnails are cached in globalStorageUri for performance
 *
 * Supported link formats:
 * - [[file:./path/to/img.png]]
 * - [[./path/to/img.png]]
 * - [[file:/absolute/path/img.jpg]]
 * - [[file:./img.png][description]]
 * - [[./img.png][description]]
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import * as os from 'os';

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Parsed image link information
 */
export interface ImageLink {
    /** Full match text */
    fullMatch: string;
    /** Image file path (relative or absolute) */
    imagePath: string;
    /** Resolved absolute path */
    resolvedPath: string;
    /** Optional description text */
    description?: string;
    /** Range in the document */
    range: vscode.Range;
    /** Line number (0-indexed) */
    line: number;
    /** Start column */
    startCol: number;
    /** End column */
    endCol: number;
    /** Whether the file exists */
    exists: boolean;
    /** Image dimensions (if available) */
    dimensions?: { width: number; height: number };
    /** File modification time */
    mtime?: number;
}

/**
 * Cached thumbnail information
 */
interface ThumbnailCache {
    /** Original file path */
    originalPath: string;
    /** Thumbnail file path */
    thumbnailPath: string;
    /** Original file mtime when thumbnail was generated */
    originalMtime: number;
    /** Thumbnail dimensions */
    width: number;
    height: number;
}

/**
 * Configuration for image overlays
 */
interface ImageOverlayConfig {
    enabled: boolean;
    maxWidth: number;
    maxHeight: number;
    renderMode: 'after' | 'gutter' | 'both' | 'hover-only';
    onlyWhenCursorNotInLink: boolean;
    excludePatterns: string[];
    maxOverlaysPerDocument: number;
    showDimensions: boolean;
    cacheEnabled: boolean;
}

/**
 * Per-editor state
 */
interface EditorState {
    decorationType: vscode.TextEditorDecorationType;
    gutterDecorationTypes: vscode.TextEditorDecorationType[];
    imageLinks: ImageLink[];
    enabled: boolean;
    updateTimer?: NodeJS.Timeout;
}

// =============================================================================
// Constants
// =============================================================================

const IMAGE_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.tiff', '.tif'
]);

// Regex for org image links - handles various formats
// [[file:path]] or [[path]] or [[file:path][desc]] or [[path][desc]]
const IMAGE_LINK_PATTERN = /\[\[(?:file:)?([^\]]+?\.(?:png|jpe?g|gif|webp|svg|bmp|ico|tiff?))(?:\]\[([^\]]*))?\]\]/gi;

// Alternative simpler pattern for just the path
const SIMPLE_IMAGE_PATH_PATTERN = /\[\[(?:file:)?([^\]]+)\]\]/gi;

// =============================================================================
// Image Overlay Manager
// =============================================================================

/**
 * Manages image overlays for org-mode files
 */
export class ImageOverlayManager {
    private context: vscode.ExtensionContext;
    private editorStates: Map<string, EditorState> = new Map();
    private thumbnailCache: Map<string, ThumbnailCache> = new Map();
    private cacheDir: string = '';
    private globalEnabled: boolean = true;
    private config: ImageOverlayConfig;
    private disposables: vscode.Disposable[] = [];
    private outputChannel: vscode.OutputChannel;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.config = this.loadConfig();
        this.outputChannel = vscode.window.createOutputChannel('Org Image Overlays');

        // Initialize cache directory
        this.initCacheDir();

        // Register event handlers
        this.registerEventHandlers();

        // Load existing thumbnail cache metadata
        this.loadThumbnailCacheMetadata();

        // Initialize overlays for visible editors
        this.initializeVisibleEditors();
    }

    /**
     * Initialize the cache directory
     */
    private initCacheDir(): void {
        this.cacheDir = path.join(this.context.globalStorageUri.fsPath, 'image-overlay-cache');
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }
    }

    /**
     * Load configuration
     */
    private loadConfig(): ImageOverlayConfig {
        const config = vscode.workspace.getConfiguration('scimax.imageOverlays');
        return {
            enabled: config.get<boolean>('enabled', true),
            maxWidth: config.get<number>('maxWidth', 96),
            maxHeight: config.get<number>('maxHeight', 96),
            renderMode: config.get<'after' | 'gutter' | 'both' | 'hover-only'>('renderMode', 'hover-only'),
            onlyWhenCursorNotInLink: config.get<boolean>('onlyWhenCursorNotInLink', true),
            excludePatterns: config.get<string[]>('excludePatterns', []),
            maxOverlaysPerDocument: config.get<number>('maxOverlaysPerDocument', 200),
            showDimensions: config.get<boolean>('showDimensions', true),
            cacheEnabled: config.get<boolean>('cacheEnabled', true),
        };
    }

    /**
     * Register event handlers
     */
    private registerEventHandlers(): void {
        // Configuration changes
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration((e: vscode.ConfigurationChangeEvent) => {
                if (e.affectsConfiguration('scimax.imageOverlays')) {
                    this.config = this.loadConfig();
                    this.refreshAllEditors();
                }
            })
        );

        // Active editor changes
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor((editor: vscode.TextEditor | undefined) => {
                if (editor && this.isOrgDocument(editor.document)) {
                    this.updateEditorOverlays(editor);
                }
            })
        );

        // Document changes (debounced)
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument((e: vscode.TextDocumentChangeEvent) => {
                if (this.isOrgDocument(e.document)) {
                    const editor = vscode.window.visibleTextEditors.find(
                        ed => ed.document === e.document
                    );
                    if (editor) {
                        this.scheduleUpdate(editor);
                    }
                }
            })
        );

        // Document save
        this.disposables.push(
            vscode.workspace.onDidSaveTextDocument((doc: vscode.TextDocument) => {
                if (this.isOrgDocument(doc)) {
                    const editor = vscode.window.visibleTextEditors.find(
                        ed => ed.document === doc
                    );
                    if (editor) {
                        this.updateEditorOverlays(editor);
                    }
                }
            })
        );

        // Editor visibility changes
        this.disposables.push(
            vscode.window.onDidChangeVisibleTextEditors((editors: readonly vscode.TextEditor[]) => {
                // Clean up states for non-visible editors
                const visibleUris = new Set(editors.map(e => e.document.uri.toString()));
                for (const [uri, state] of this.editorStates) {
                    if (!visibleUris.has(uri)) {
                        this.disposeEditorState(state);
                        this.editorStates.delete(uri);
                    }
                }

                // Update visible org editors
                for (const editor of editors) {
                    if (this.isOrgDocument(editor.document)) {
                        this.updateEditorOverlays(editor);
                    }
                }
            })
        );

        // Selection changes (for cursor-in-link detection)
        this.disposables.push(
            vscode.window.onDidChangeTextEditorSelection((e: vscode.TextEditorSelectionChangeEvent) => {
                if (this.config.onlyWhenCursorNotInLink && this.isOrgDocument(e.textEditor.document)) {
                    this.updateEditorOverlays(e.textEditor);
                }
            })
        );
    }

    /**
     * Check if document is an org file
     */
    private isOrgDocument(document: vscode.TextDocument): boolean {
        return document.languageId === 'org' ||
               document.fileName.endsWith('.org');
    }

    /**
     * Initialize overlays for visible editors
     */
    private initializeVisibleEditors(): void {
        for (const editor of vscode.window.visibleTextEditors) {
            if (this.isOrgDocument(editor.document)) {
                this.updateEditorOverlays(editor);
            }
        }
    }

    /**
     * Schedule a debounced update
     */
    private scheduleUpdate(editor: vscode.TextEditor): void {
        const uri = editor.document.uri.toString();
        const state = this.editorStates.get(uri);

        if (state?.updateTimer) {
            clearTimeout(state.updateTimer);
        }

        const timer = setTimeout(() => {
            this.updateEditorOverlays(editor);
        }, 250);

        if (state) {
            state.updateTimer = timer;
        }
    }

    /**
     * Update overlays for an editor
     */
    async updateEditorOverlays(editor: vscode.TextEditor): Promise<void> {
        if (!this.globalEnabled || !this.config.enabled) {
            this.clearEditorOverlays(editor);
            return;
        }

        const uri = editor.document.uri.toString();

        // Check if file-specific toggle is off
        let state = this.editorStates.get(uri);
        if (state && !state.enabled) {
            return;
        }

        // Parse image links
        const imageLinks = await this.parseImageLinks(editor.document);

        // Check limit
        if (imageLinks.length > this.config.maxOverlaysPerDocument) {
            vscode.window.showWarningMessage(
                `Found ${imageLinks.length} image links, limiting to ${this.config.maxOverlaysPerDocument}`
            );
            imageLinks.splice(this.config.maxOverlaysPerDocument);
        }

        // Filter by cursor position if configured
        const filteredLinks = this.config.onlyWhenCursorNotInLink
            ? this.filterByCursorPosition(imageLinks, editor.selections)
            : imageLinks;

        // Create or update state
        if (!state) {
            state = this.createEditorState();
            this.editorStates.set(uri, state);
        }
        state.imageLinks = imageLinks;

        // Generate decorations
        await this.applyDecorations(editor, filteredLinks, state);
    }

    /**
     * Parse image links from document
     */
    private async parseImageLinks(document: vscode.TextDocument): Promise<ImageLink[]> {
        const links: ImageLink[] = [];
        const text = document.getText();
        const docDir = path.dirname(document.uri.fsPath);

        let match;
        IMAGE_LINK_PATTERN.lastIndex = 0;

        while ((match = IMAGE_LINK_PATTERN.exec(text)) !== null) {
            const fullMatch = match[0];
            const imagePath = match[1];
            const description = match[2];

            // Skip excluded patterns
            if (this.isExcluded(imagePath)) {
                continue;
            }

            // Skip remote URLs
            if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
                continue;
            }

            // Resolve path
            const resolvedPath = this.resolvePath(imagePath, docDir);
            if (!resolvedPath) {
                continue;
            }

            // Check if file exists
            const exists = fs.existsSync(resolvedPath);

            // Get position
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + fullMatch.length);

            const link: ImageLink = {
                fullMatch,
                imagePath,
                resolvedPath,
                description,
                range: new vscode.Range(startPos, endPos),
                line: startPos.line,
                startCol: startPos.character,
                endCol: endPos.character,
                exists,
            };

            // Get file info if exists
            if (exists) {
                try {
                    const stat = fs.statSync(resolvedPath);
                    link.mtime = stat.mtimeMs;
                    link.dimensions = await this.getImageDimensions(resolvedPath);
                } catch {
                    // Ignore errors
                }
            }

            links.push(link);
        }

        return links;
    }

    /**
     * Resolve image path
     */
    private resolvePath(imagePath: string, docDir: string): string | null {
        try {
            // Remove file: prefix if present
            let cleanPath = imagePath.replace(/^file:/, '');

            // Handle URL encoding
            cleanPath = decodeURIComponent(cleanPath);

            // Expand ~ on Unix
            if (cleanPath.startsWith('~') && (process.platform === 'darwin' || process.platform === 'linux')) {
                cleanPath = cleanPath.replace(/^~/, os.homedir());
            }

            // Handle Windows paths
            if (process.platform === 'win32') {
                cleanPath = cleanPath.replace(/\//g, '\\');
            }

            // Resolve relative paths
            if (!path.isAbsolute(cleanPath)) {
                cleanPath = path.resolve(docDir, cleanPath);
            }

            // Normalize
            return path.normalize(cleanPath);
        } catch {
            return null;
        }
    }

    /**
     * Check if path matches exclude patterns
     */
    private isExcluded(imagePath: string): boolean {
        for (const pattern of this.config.excludePatterns) {
            try {
                const regex = new RegExp(pattern);
                if (regex.test(imagePath)) {
                    return true;
                }
            } catch {
                // Invalid regex, try glob-like matching
                if (imagePath.includes(pattern)) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Filter links by cursor position
     */
    private filterByCursorPosition(
        links: ImageLink[],
        selections: readonly vscode.Selection[]
    ): ImageLink[] {
        return links.filter(link => {
            for (const selection of selections) {
                if (link.range.contains(selection.active)) {
                    return false; // Cursor is in this link, don't show overlay
                }
            }
            return true;
        });
    }

    /**
     * Create editor state
     */
    private createEditorState(): EditorState {
        // Create decoration type for after-content
        const decorationType = vscode.window.createTextEditorDecorationType({
            after: {
                margin: '0 0 0 8px',
                color: new vscode.ThemeColor('editorInfo.foreground'),
            },
        });

        return {
            decorationType,
            gutterDecorationTypes: [],
            imageLinks: [],
            enabled: true,
        };
    }

    /**
     * Apply decorations to editor
     */
    private async applyDecorations(
        editor: vscode.TextEditor,
        links: ImageLink[],
        state: EditorState
    ): Promise<void> {
        // Dispose old gutter decoration types
        for (const decType of state.gutterDecorationTypes) {
            decType.dispose();
        }
        state.gutterDecorationTypes = [];

        const afterDecorations: vscode.DecorationOptions[] = [];

        for (const link of links) {
            if (!link.exists) {
                // Show error decoration for missing files
                afterDecorations.push({
                    range: link.range,
                    renderOptions: {
                        after: {
                            contentText: ' ⚠️ (not found)',
                            color: new vscode.ThemeColor('errorForeground'),
                        },
                    },
                    hoverMessage: new vscode.MarkdownString(`**Image not found**\n\n\`${link.resolvedPath}\``),
                });
                continue;
            }

            // Get or generate thumbnail
            const thumbnailPath = await this.getThumbnail(link);

            // Create hover message
            const hoverMd = new vscode.MarkdownString();
            hoverMd.isTrusted = true;
            hoverMd.supportHtml = true;

            if (link.dimensions) {
                hoverMd.appendMarkdown(`**${path.basename(link.resolvedPath)}** (${link.dimensions.width}×${link.dimensions.height})\n\n`);
            } else {
                hoverMd.appendMarkdown(`**${path.basename(link.resolvedPath)}**\n\n`);
            }

            // Add clickable image
            const imageUri = vscode.Uri.file(link.resolvedPath);
            hoverMd.appendMarkdown(`<img src="${imageUri.toString()}" width="300" />\n\n`);
            hoverMd.appendMarkdown(`[Open in editor](command:vscode.open?${encodeURIComponent(JSON.stringify([imageUri]))})`);

            // Hover-only mode - just add hover message without any visible decoration
            if (this.config.renderMode === 'hover-only') {
                afterDecorations.push({
                    range: link.range,
                    hoverMessage: hoverMd,
                });
            }

            // After-content decoration
            if (this.config.renderMode === 'after' || this.config.renderMode === 'both') {
                const dimText = link.dimensions && this.config.showDimensions
                    ? ` [${link.dimensions.width}×${link.dimensions.height}]`
                    : '';

                afterDecorations.push({
                    range: link.range,
                    renderOptions: {
                        after: {
                            contentText: ` 🖼️${dimText}`,
                            color: new vscode.ThemeColor('editorInfo.foreground'),
                        },
                    },
                    hoverMessage: hoverMd,
                });
            }

            // Gutter decoration - create a per-image decoration type since gutterIconPath
            // must be set on the decoration type, not per-decoration instance
            if ((this.config.renderMode === 'gutter' || this.config.renderMode === 'both') && thumbnailPath) {
                const gutterDecType = vscode.window.createTextEditorDecorationType({
                    gutterIconPath: vscode.Uri.file(thumbnailPath),
                    gutterIconSize: 'contain',
                });
                state.gutterDecorationTypes.push(gutterDecType);
                editor.setDecorations(gutterDecType, [{
                    range: new vscode.Range(link.line, 0, link.line, 0),
                    hoverMessage: hoverMd,
                }]);
            }
        }

        // Apply after-content decorations
        editor.setDecorations(state.decorationType, afterDecorations);
    }

    /**
     * Get or generate thumbnail for an image
     */
    private async getThumbnail(link: ImageLink): Promise<string | null> {
        if (!this.config.cacheEnabled) {
            return link.resolvedPath; // Use original
        }

        // Generate cache key
        const hash = crypto.createHash('md5')
            .update(link.resolvedPath)
            .digest('hex');
        const ext = path.extname(link.resolvedPath).toLowerCase();
        const thumbnailPath = path.join(this.cacheDir, `${hash}_${this.config.maxWidth}x${this.config.maxHeight}${ext}`);

        // Check cache
        const cached = this.thumbnailCache.get(link.resolvedPath);
        if (cached && cached.originalMtime === link.mtime && fs.existsSync(cached.thumbnailPath)) {
            return cached.thumbnailPath;
        }

        // Generate thumbnail
        try {
            await this.generateThumbnail(link.resolvedPath, thumbnailPath);

            // Update cache
            this.thumbnailCache.set(link.resolvedPath, {
                originalPath: link.resolvedPath,
                thumbnailPath,
                originalMtime: link.mtime || 0,
                width: this.config.maxWidth,
                height: this.config.maxHeight,
            });

            this.saveThumbnailCacheMetadata();

            return thumbnailPath;
        } catch (err) {
            this.outputChannel.appendLine(`Failed to generate thumbnail for ${link.resolvedPath}: ${err}`);
            return link.resolvedPath; // Fall back to original
        }
    }

    /**
     * Generate thumbnail using system tools or VS Code
     */
    private async generateThumbnail(sourcePath: string, destPath: string): Promise<void> {
        const ext = path.extname(sourcePath).toLowerCase();

        // For SVG, just copy (they scale well)
        if (ext === '.svg') {
            fs.copyFileSync(sourcePath, destPath);
            return;
        }

        // Try using ImageMagick if available
        const hasImageMagick = await this.checkCommand('convert');
        if (hasImageMagick) {
            await this.generateThumbnailWithImageMagick(sourcePath, destPath);
            return;
        }

        // Try using sips on macOS
        if (process.platform === 'darwin') {
            const hasSips = await this.checkCommand('sips');
            if (hasSips) {
                await this.generateThumbnailWithSips(sourcePath, destPath);
                return;
            }
        }

        // Fall back to copying the original
        fs.copyFileSync(sourcePath, destPath);
    }

    /**
     * Generate thumbnail with ImageMagick
     */
    private generateThumbnailWithImageMagick(sourcePath: string, destPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const args = [
                sourcePath,
                '-thumbnail', `${this.config.maxWidth}x${this.config.maxHeight}>`,
                '-quality', '85',
                destPath,
            ];

            const proc = spawn('convert', args);

            proc.on('close', (code: number | null) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`ImageMagick exited with code ${code}`));
                }
            });

            proc.on('error', reject);
        });
    }

    /**
     * Generate thumbnail with sips (macOS)
     */
    private generateThumbnailWithSips(sourcePath: string, destPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            // First copy, then resize
            fs.copyFileSync(sourcePath, destPath);

            const args = [
                '-Z', `${Math.max(this.config.maxWidth, this.config.maxHeight)}`,
                destPath,
            ];

            const proc = spawn('sips', args);

            proc.on('close', (code: number | null) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`sips exited with code ${code}`));
                }
            });

            proc.on('error', reject);
        });
    }

    /**
     * Check if a command is available
     */
    private checkCommand(cmd: string): Promise<boolean> {
        return new Promise((resolve) => {
            const proc = spawn(cmd, ['--version']);
            proc.on('close', (code: number | null) => resolve(code === 0));
            proc.on('error', () => resolve(false));
        });
    }

    /**
     * Get image dimensions
     */
    private async getImageDimensions(imagePath: string): Promise<{ width: number; height: number } | undefined> {
        const ext = path.extname(imagePath).toLowerCase();

        try {
            // Try using ImageMagick identify
            const hasIdentify = await this.checkCommand('identify');
            if (hasIdentify) {
                return await this.getDimensionsWithIdentify(imagePath);
            }

            // Try using sips on macOS
            if (process.platform === 'darwin') {
                return await this.getDimensionsWithSips(imagePath);
            }

            // Try parsing image header directly for common formats
            return await this.getDimensionsFromHeader(imagePath, ext);
        } catch {
            return undefined;
        }
    }

    /**
     * Get dimensions with ImageMagick identify
     */
    private getDimensionsWithIdentify(imagePath: string): Promise<{ width: number; height: number } | undefined> {
        return new Promise((resolve) => {
            const proc = spawn('identify', ['-format', '%wx%h', imagePath]);
            let output = '';

            proc.stdout?.on('data', (data: Buffer) => {
                output += data.toString();
            });

            proc.on('close', (code: number | null) => {
                if (code === 0) {
                    const match = output.match(/(\d+)x(\d+)/);
                    if (match) {
                        resolve({ width: parseInt(match[1]), height: parseInt(match[2]) });
                        return;
                    }
                }
                resolve(undefined);
            });

            proc.on('error', () => resolve(undefined));
        });
    }

    /**
     * Get dimensions with sips (macOS)
     */
    private getDimensionsWithSips(imagePath: string): Promise<{ width: number; height: number } | undefined> {
        return new Promise((resolve) => {
            const proc = spawn('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', imagePath]);
            let output = '';

            proc.stdout?.on('data', (data: Buffer) => {
                output += data.toString();
            });

            proc.on('close', (code: number | null) => {
                if (code === 0) {
                    const widthMatch = output.match(/pixelWidth:\s*(\d+)/);
                    const heightMatch = output.match(/pixelHeight:\s*(\d+)/);
                    if (widthMatch && heightMatch) {
                        resolve({
                            width: parseInt(widthMatch[1]),
                            height: parseInt(heightMatch[1])
                        });
                        return;
                    }
                }
                resolve(undefined);
            });

            proc.on('error', () => resolve(undefined));
        });
    }

    /**
     * Get dimensions from image header (for common formats)
     */
    private async getDimensionsFromHeader(
        imagePath: string,
        ext: string
    ): Promise<{ width: number; height: number } | undefined> {
        let fd: number | null = null;
        try {
            const buffer = Buffer.alloc(24);
            fd = fs.openSync(imagePath, 'r');
            fs.readSync(fd, buffer, 0, 24, 0);

            if (ext === '.png') {
                // PNG: width at bytes 16-19, height at 20-23
                if (buffer.toString('ascii', 1, 4) === 'PNG') {
                    return {
                        width: buffer.readUInt32BE(16),
                        height: buffer.readUInt32BE(20),
                    };
                }
            } else if (ext === '.gif') {
                // GIF: width at bytes 6-7, height at 8-9 (little endian)
                if (buffer.toString('ascii', 0, 3) === 'GIF') {
                    return {
                        width: buffer.readUInt16LE(6),
                        height: buffer.readUInt16LE(8),
                    };
                }
            } else if (ext === '.bmp') {
                // BMP: width at bytes 18-21, height at 22-25
                if (buffer.toString('ascii', 0, 2) === 'BM') {
                    return {
                        width: buffer.readUInt32LE(18),
                        height: Math.abs(buffer.readInt32LE(22)),
                    };
                }
            }
            // JPEG requires more complex parsing, skip for now
        } catch (error) {
            // Log unexpected errors for debugging (file not found is expected)
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                console.warn(`ImageOverlay: Failed to read image header for ${imagePath}:`, error);
            }
        } finally {
            // Always close file descriptor to prevent resource leak
            if (fd !== null) {
                try {
                    fs.closeSync(fd);
                } catch {
                    // Ignore close errors
                }
            }
        }

        return undefined;
    }

    /**
     * Load thumbnail cache metadata
     */
    private loadThumbnailCacheMetadata(): void {
        const metadataPath = path.join(this.cacheDir, 'cache-metadata.json');
        try {
            if (fs.existsSync(metadataPath)) {
                const data = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
                this.thumbnailCache = new Map(Object.entries(data));
            }
        } catch (error) {
            // Log error for debugging - cache loading failure is not critical
            console.warn('ImageOverlay: Failed to load thumbnail cache metadata:', error);
        }
    }

    /**
     * Save thumbnail cache metadata
     */
    private saveThumbnailCacheMetadata(): void {
        const metadataPath = path.join(this.cacheDir, 'cache-metadata.json');
        try {
            const data = Object.fromEntries(this.thumbnailCache);
            fs.writeFileSync(metadataPath, JSON.stringify(data, null, 2));
        } catch {
            // Ignore errors
        }
    }

    /**
     * Clear overlays for an editor
     */
    private clearEditorOverlays(editor: vscode.TextEditor): void {
        const uri = editor.document.uri.toString();
        const state = this.editorStates.get(uri);

        if (state) {
            editor.setDecorations(state.decorationType, []);
            // Dispose and clear all gutter decoration types
            for (const decType of state.gutterDecorationTypes) {
                decType.dispose();
            }
            state.gutterDecorationTypes = [];
        }
    }

    /**
     * Dispose editor state
     */
    private disposeEditorState(state: EditorState): void {
        if (state.updateTimer) {
            clearTimeout(state.updateTimer);
        }
        state.decorationType.dispose();
        for (const decType of state.gutterDecorationTypes) {
            decType.dispose();
        }
    }

    /**
     * Refresh all editors
     */
    refreshAllEditors(): void {
        for (const editor of vscode.window.visibleTextEditors) {
            if (this.isOrgDocument(editor.document)) {
                this.updateEditorOverlays(editor);
            }
        }
    }

    /**
     * Toggle global overlays
     */
    toggleGlobal(): void {
        this.globalEnabled = !this.globalEnabled;

        if (this.globalEnabled) {
            this.refreshAllEditors();
            vscode.window.showInformationMessage('Image overlays enabled');
        } else {
            for (const editor of vscode.window.visibleTextEditors) {
                this.clearEditorOverlays(editor);
            }
            vscode.window.showInformationMessage('Image overlays disabled');
        }
    }

    /**
     * Toggle overlays for current file
     */
    toggleCurrentFile(): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !this.isOrgDocument(editor.document)) {
            vscode.window.showWarningMessage('No org file is active');
            return;
        }

        const uri = editor.document.uri.toString();
        let state = this.editorStates.get(uri);

        if (!state) {
            state = this.createEditorState();
            this.editorStates.set(uri, state);
        }

        state.enabled = !state.enabled;

        if (state.enabled) {
            this.updateEditorOverlays(editor);
            vscode.window.showInformationMessage('Image overlays enabled for this file');
        } else {
            this.clearEditorOverlays(editor);
            vscode.window.showInformationMessage('Image overlays disabled for this file');
        }
    }

    /**
     * Clear thumbnail cache
     */
    clearCache(): void {
        try {
            const files = fs.readdirSync(this.cacheDir);
            for (const file of files) {
                fs.unlinkSync(path.join(this.cacheDir, file));
            }
            this.thumbnailCache.clear();
            vscode.window.showInformationMessage('Image overlay cache cleared');
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to clear cache: ${err}`);
        }
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): { entries: number; totalSize: number } {
        let totalSize = 0;
        try {
            const files = fs.readdirSync(this.cacheDir);
            for (const file of files) {
                if (file === 'cache-metadata.json') continue;
                const stat = fs.statSync(path.join(this.cacheDir, file));
                totalSize += stat.size;
            }
            return { entries: this.thumbnailCache.size, totalSize };
        } catch {
            return { entries: 0, totalSize: 0 };
        }
    }

    /**
     * Dispose manager
     */
    dispose(): void {
        for (const state of this.editorStates.values()) {
            this.disposeEditorState(state);
        }
        this.editorStates.clear();

        for (const disposable of this.disposables) {
            disposable.dispose();
        }

        this.outputChannel.dispose();
    }
}

// =============================================================================
// Singleton and Registration
// =============================================================================

let imageOverlayManager: ImageOverlayManager | undefined;

/**
 * Initialize image overlay manager
 */
export function initImageOverlays(context: vscode.ExtensionContext): ImageOverlayManager {
    imageOverlayManager = new ImageOverlayManager(context);
    context.subscriptions.push({
        dispose: () => imageOverlayManager?.dispose(),
    });
    return imageOverlayManager;
}

/**
 * Get the image overlay manager instance
 */
export function getImageOverlayManager(): ImageOverlayManager | undefined {
    return imageOverlayManager;
}

/**
 * Register image overlay commands
 */
export function registerImageOverlayCommands(context: vscode.ExtensionContext): void {
    const manager = initImageOverlays(context);

    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.imageOverlays.toggle', () => {
            manager.toggleGlobal();
        }),

        vscode.commands.registerCommand('scimax.imageOverlays.toggleCurrentFile', () => {
            manager.toggleCurrentFile();
        }),

        vscode.commands.registerCommand('scimax.imageOverlays.refresh', () => {
            manager.refreshAllEditors();
            vscode.window.showInformationMessage('Image overlays refreshed');
        }),

        vscode.commands.registerCommand('scimax.imageOverlays.clearCache', () => {
            manager.clearCache();
        }),

        vscode.commands.registerCommand('scimax.imageOverlays.showStats', () => {
            const stats = manager.getCacheStats();
            const sizeKB = (stats.totalSize / 1024).toFixed(1);
            vscode.window.showInformationMessage(
                `Image overlay cache: ${stats.entries} thumbnails, ${sizeKB} KB`
            );
        })
    );
}
