/**
 * Zotero integration service using Better BibTeX JSON-RPC API
 * Provides citation insertion from Zotero with automatic .bib file sync
 */

import * as http from 'http';
import type { IncomingMessage } from 'http';

const BBT_BASE_URL = 'http://127.0.0.1:23119';
const BBT_JSON_RPC_PATH = '/better-bibtex/json-rpc';
const BBT_CAYW_PATH = '/better-bibtex/cayw';

/**
 * Check if Zotero with Better BibTeX is running
 */
export async function isZoteroRunning(): Promise<boolean> {
    return new Promise((resolve) => {
        const req = http.request({
            hostname: '127.0.0.1',
            port: 23119,
            path: BBT_JSON_RPC_PATH,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            timeout: 2000
        }, (res: IncomingMessage) => {
            // Any response means Zotero is running
            resolve(true);
            res.resume(); // Consume response to free up memory
        });

        req.on('error', () => {
            resolve(false);
        });

        req.on('timeout', () => {
            req.destroy();
            resolve(false);
        });

        // Send a simple API ready check
        req.write(JSON.stringify({
            jsonrpc: '2.0',
            method: 'api.ready',
            id: 1
        }));
        req.end();
    });
}

/**
 * Result from CAYW picker - citation keys selected by user
 */
export interface CAYWResult {
    keys: string[];
    raw: string;
}

/**
 * Open Zotero's citation picker (CAYW - Cite As You Write)
 * Returns the selected citation keys
 */
export async function openCitationPicker(): Promise<CAYWResult | null> {
    return new Promise((resolve) => {
        // Use pandoc format to get @citekey format, which we can parse
        const url = `${BBT_CAYW_PATH}?format=pandoc&brackets=1`;

        const req = http.request({
            hostname: '127.0.0.1',
            port: 23119,
            path: url,
            method: 'GET',
            timeout: 300000 // 5 minutes - user may take time to select
        }, (res: IncomingMessage) => {
            let data = '';

            res.on('data', (chunk: Buffer | string) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 200 && data.trim()) {
                    // Parse pandoc format: [@key1; @key2; @key3]
                    const raw = data.trim();
                    const keyMatches = raw.match(/@([a-zA-Z0-9_:-]+)/g);
                    if (keyMatches && keyMatches.length > 0) {
                        const keys = keyMatches.map(k => k.slice(1)); // Remove @ prefix
                        resolve({ keys, raw });
                    } else {
                        // User cancelled or no selection
                        resolve(null);
                    }
                } else {
                    resolve(null);
                }
            });
        });

        req.on('error', (err: Error) => {
            console.error('CAYW request failed:', err);
            resolve(null);
        });

        req.on('timeout', () => {
            req.destroy();
            resolve(null);
        });

        req.end();
    });
}

/**
 * JSON-RPC call to Better BibTeX
 */
async function jsonRpcCall<T>(method: string, params: unknown[] = []): Promise<T | null> {
    return new Promise((resolve) => {
        const body = JSON.stringify({
            jsonrpc: '2.0',
            method,
            params,
            id: Date.now()
        });

        const req = http.request({
            hostname: '127.0.0.1',
            port: 23119,
            path: BBT_JSON_RPC_PATH,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            },
            timeout: 30000
        }, (res: IncomingMessage) => {
            let data = '';

            res.on('data', (chunk: Buffer | string) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const result = JSON.parse(data);
                        if (result.error) {
                            console.error('JSON-RPC error:', result.error);
                            resolve(null);
                        } else {
                            resolve(result.result as T);
                        }
                    } catch (e) {
                        console.error('Failed to parse JSON-RPC response:', e);
                        resolve(null);
                    }
                } else {
                    console.error('JSON-RPC request failed with status:', res.statusCode);
                    resolve(null);
                }
            });
        });

        req.on('error', (err: Error) => {
            console.error('JSON-RPC request error:', err);
            resolve(null);
        });

        req.on('timeout', () => {
            req.destroy();
            resolve(null);
        });

        req.write(body);
        req.end();
    });
}

/**
 * Export items as BibTeX from Zotero
 * @param citekeys Array of citation keys to export
 * @returns BibTeX string or null on failure
 */
export async function exportBibTeX(citekeys: string[]): Promise<string | null> {
    // Use item.export method with Better BibTeX translator
    // The translator ID for Better BibTeX is: ca65189f-8815-4afe-8c8b-8c7c15f0edca
    const result = await jsonRpcCall<string>('item.export', [
        citekeys,
        'ca65189f-8815-4afe-8c8b-8c7c15f0edca' // Better BibTeX translator ID
    ]);

    return result;
}

/**
 * Search Zotero library
 * @param terms Search terms
 * @returns Array of matching citation keys
 */
export async function searchZotero(terms: string): Promise<string[]> {
    const result = await jsonRpcCall<Array<{ citekey: string }>>('item.search', [terms]);
    if (result && Array.isArray(result)) {
        return result.map(item => item.citekey).filter(Boolean);
    }
    return [];
}

/**
 * Get attachments for an item
 * @param citekey Citation key
 * @returns Array of attachment paths
 */
export async function getAttachments(citekey: string): Promise<string[]> {
    const result = await jsonRpcCall<Array<{ path: string }>>('item.attachments', [citekey]);
    if (result && Array.isArray(result)) {
        return result.map(item => item.path).filter(Boolean);
    }
    return [];
}
