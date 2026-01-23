import * as https from 'https';
import * as vscode from 'vscode';
import { getOpenAlexApiKey } from '../database/secretStorage';

// Track if we've warned about mailto
let mailtoWarningShown = false;

/**
 * Get OpenAlex request configuration
 * Builds the User-Agent with mailto and adds api_key if available
 */
async function getOpenAlexConfig(): Promise<{ userAgent: string; apiKey?: string }> {
    const config = vscode.workspace.getConfiguration('scimax');
    const mailto = config.get<string>('email');
    const apiKey = await getOpenAlexApiKey();

    // Warn if mailto is not configured (only once per session)
    if (!mailto && !mailtoWarningShown) {
        mailtoWarningShown = true;
        vscode.window.showWarningMessage(
            'Email not configured. Set scimax.email to your email for faster OpenAlex API access (polite pool).',
            'Configure'
        ).then(selection => {
            if (selection === 'Configure') {
                vscode.commands.executeCommand('workbench.action.openSettings', 'scimax.email');
            }
        });
    }

    // Build User-Agent string
    let userAgent = 'scimax-vscode/1.0';
    if (mailto) {
        userAgent += ` (mailto:${mailto})`;
    }

    return { userAgent, apiKey };
}

/**
 * Build URL path with optional api_key parameter
 */
function buildPath(basePath: string, apiKey?: string): string {
    if (!apiKey) {
        return basePath;
    }
    const separator = basePath.includes('?') ? '&' : '?';
    return `${basePath}${separator}api_key=${encodeURIComponent(apiKey)}`;
}

/**
 * OpenAlex Work metadata
 * See: https://docs.openalex.org/api-entities/works/work-object
 */
export interface OpenAlexWork {
    id: string;
    doi?: string;
    title: string;
    publication_year?: number;
    publication_date?: string;
    type?: string;
    cited_by_count: number;
    is_retracted: boolean;
    is_paratext: boolean;

    // Open Access info
    open_access?: {
        is_oa: boolean;
        oa_status: 'gold' | 'green' | 'hybrid' | 'bronze' | 'closed';
        oa_url?: string;
    };

    // Authors
    authorships?: Array<{
        author: {
            id: string;
            display_name: string;
            orcid?: string;
        };
        institutions?: Array<{
            id: string;
            display_name: string;
            country_code?: string;
        }>;
        author_position: 'first' | 'middle' | 'last';
    }>;

    // Source (journal/venue)
    primary_location?: {
        source?: {
            id: string;
            display_name: string;
            issn_l?: string;
            type?: string;
        };
        pdf_url?: string;
        landing_page_url?: string;
    };

    // Topics (AI-assigned)
    primary_topic?: {
        id: string;
        display_name: string;
        score: number;
        subfield?: { display_name: string };
        field?: { display_name: string };
        domain?: { display_name: string };
    };

    topics?: Array<{
        id: string;
        display_name: string;
        score: number;
    }>;

    // Concepts (legacy, but still useful)
    concepts?: Array<{
        id: string;
        display_name: string;
        score: number;
    }>;

    // Citations
    referenced_works?: string[];
    related_works?: string[];
    cited_by_api_url?: string;

    // Counts by year
    counts_by_year?: Array<{
        year: number;
        cited_by_count: number;
    }>;

    // Abstract (inverted index format)
    abstract_inverted_index?: Record<string, number[]>;

    // Biblio info
    biblio?: {
        volume?: string;
        issue?: string;
        first_page?: string;
        last_page?: string;
    };

    // Field-weighted citation impact
    fwci?: number;

    // Sustainable Development Goals
    sustainable_development_goals?: Array<{
        id: string;
        display_name: string;
        score: number;
    }>;
}

/**
 * OpenAlex Author metadata
 */
export interface OpenAlexAuthor {
    id: string;
    orcid?: string;
    display_name: string;
    works_count: number;
    cited_by_count: number;
    summary_stats?: {
        '2yr_mean_citedness': number;
        h_index: number;
        i10_index: number;
    };
    affiliations?: Array<{
        institution: {
            id: string;
            display_name: string;
        };
        years: number[];
    }>;
    topics?: Array<{
        id: string;
        display_name: string;
        count: number;
    }>;
}

// Cache for OpenAlex results
const openAlexCache = new Map<string, { data: OpenAlexWork | null; fetchedAt: number }>();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

/**
 * Reconstruct abstract from inverted index
 */
export function reconstructAbstract(invertedIndex: Record<string, number[]>): string {
    if (!invertedIndex || Object.keys(invertedIndex).length === 0) {
        return '';
    }

    // Build array of [position, word] pairs
    const words: [number, string][] = [];
    for (const [word, positions] of Object.entries(invertedIndex)) {
        for (const pos of positions) {
            words.push([pos, word]);
        }
    }

    // Sort by position and join
    words.sort((a, b) => a[0] - b[0]);
    return words.map(w => w[1]).join(' ');
}

/**
 * Format citation count with appropriate suffix
 */
export function formatCitationCount(count: number): string {
    if (count >= 1000000) {
        return `${(count / 1000000).toFixed(1)}M`;
    }
    if (count >= 1000) {
        return `${(count / 1000).toFixed(1)}K`;
    }
    return count.toString();
}

/**
 * Get Open Access status emoji/icon
 */
export function getOAStatusIcon(status?: string): string {
    switch (status) {
        case 'gold': return '🔓'; // Gold OA (published in OA journal)
        case 'green': return '🟢'; // Green OA (self-archived)
        case 'hybrid': return '🟡'; // Hybrid (OA in subscription journal)
        case 'bronze': return '🟠'; // Bronze (free to read but no license)
        case 'closed': return '🔒';
        default: return '';
    }
}

/**
 * Get Open Access status description
 */
export function getOAStatusDescription(status?: string): string {
    switch (status) {
        case 'gold': return 'Gold Open Access';
        case 'green': return 'Green Open Access (self-archived)';
        case 'hybrid': return 'Hybrid Open Access';
        case 'bronze': return 'Bronze (free to read)';
        case 'closed': return 'Closed Access';
        default: return 'Unknown';
    }
}

/**
 * Fetch work metadata from OpenAlex by DOI
 */
export async function fetchOpenAlexWork(doi: string): Promise<OpenAlexWork | null> {
    // Check cache
    const cached = openAlexCache.get(doi);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
        return cached.data;
    }

    const { userAgent, apiKey } = await getOpenAlexConfig();
    const basePath = `/works/doi:${encodeURIComponent(doi)}`;

    return new Promise((resolve) => {
        const options = {
            hostname: 'api.openalex.org',
            path: buildPath(basePath, apiKey),
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'User-Agent': userAgent
            },
            timeout: 8000
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const work = JSON.parse(data) as OpenAlexWork;
                        openAlexCache.set(doi, { data: work, fetchedAt: Date.now() });
                        resolve(work);
                    } catch {
                        openAlexCache.set(doi, { data: null, fetchedAt: Date.now() });
                        resolve(null);
                    }
                } else {
                    openAlexCache.set(doi, { data: null, fetchedAt: Date.now() });
                    resolve(null);
                }
            });
        });

        req.on('error', () => {
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
 * Fetch author metadata from OpenAlex
 */
export async function fetchOpenAlexAuthor(authorId: string): Promise<OpenAlexAuthor | null> {
    const { userAgent, apiKey } = await getOpenAlexConfig();
    const basePath = `/authors/${encodeURIComponent(authorId)}`;

    return new Promise((resolve) => {
        const options = {
            hostname: 'api.openalex.org',
            path: buildPath(basePath, apiKey),
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'User-Agent': userAgent
            },
            timeout: 8000
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        resolve(JSON.parse(data) as OpenAlexAuthor);
                    } catch {
                        resolve(null);
                    }
                } else {
                    resolve(null);
                }
            });
        });

        req.on('error', () => resolve(null));
        req.on('timeout', () => {
            req.destroy();
            resolve(null);
        });

        req.end();
    });
}

/**
 * Search works in OpenAlex
 */
export async function searchOpenAlexWorks(query: string, limit: number = 10): Promise<OpenAlexWork[]> {
    const { userAgent, apiKey } = await getOpenAlexConfig();
    const basePath = `/works?search=${encodeURIComponent(query)}&per_page=${limit}`;

    return new Promise((resolve) => {
        const options = {
            hostname: 'api.openalex.org',
            path: buildPath(basePath, apiKey),
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'User-Agent': userAgent
            },
            timeout: 10000
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const result = JSON.parse(data);
                        resolve(result.results || []);
                    } catch {
                        resolve([]);
                    }
                } else {
                    resolve([]);
                }
            });
        });

        req.on('error', () => resolve([]));
        req.on('timeout', () => {
            req.destroy();
            resolve([]);
        });

        req.end();
    });
}

/**
 * Fetch citing works for a given OpenAlex work ID
 */
export async function fetchCitingWorks(workId: string, limit: number = 10): Promise<OpenAlexWork[]> {
    const { userAgent, apiKey } = await getOpenAlexConfig();
    // Extract just the ID part if full URL provided
    const id = workId.replace('https://openalex.org/', '');
    const basePath = `/works?filter=cites:${id}&per_page=${limit}&sort=cited_by_count:desc`;

    return new Promise((resolve) => {
        const options = {
            hostname: 'api.openalex.org',
            path: buildPath(basePath, apiKey),
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'User-Agent': userAgent
            },
            timeout: 10000
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const result = JSON.parse(data);
                        resolve(result.results || []);
                    } catch {
                        resolve([]);
                    }
                } else {
                    resolve([]);
                }
            });
        });

        req.on('error', () => resolve([]));
        req.on('timeout', () => {
            req.destroy();
            resolve([]);
        });

        req.end();
    });
}

/**
 * Fetch related works for a given work
 */
export async function fetchRelatedWorks(relatedIds: string[], limit: number = 5): Promise<OpenAlexWork[]> {
    if (!relatedIds || relatedIds.length === 0) return [];

    const { userAgent, apiKey } = await getOpenAlexConfig();
    // Take first N related work IDs
    const ids = relatedIds.slice(0, limit).map(id => id.replace('https://openalex.org/', ''));
    const basePath = `/works?filter=openalex:${ids.join('|')}`;

    return new Promise((resolve) => {
        const options = {
            hostname: 'api.openalex.org',
            path: buildPath(basePath, apiKey),
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'User-Agent': userAgent
            },
            timeout: 10000
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const result = JSON.parse(data);
                        resolve(result.results || []);
                    } catch {
                        resolve([]);
                    }
                } else {
                    resolve([]);
                }
            });
        });

        req.on('error', () => resolve([]));
        req.on('timeout', () => {
            req.destroy();
            resolve([]);
        });

        req.end();
    });
}
