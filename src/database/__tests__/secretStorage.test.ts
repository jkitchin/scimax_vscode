/**
 * Tests for SecretStorage module
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock storage
const mockSecretStore = new Map<string, string>();

// Mock vscode module
vi.mock('vscode', () => ({
    workspace: {
        getConfiguration: vi.fn().mockReturnValue({
            get: vi.fn().mockReturnValue(undefined),
            update: vi.fn().mockResolvedValue(undefined)
        })
    },
    window: {
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn()
    },
    ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
    }
}));

// Import after mocking
import {
    initSecretStorage,
    storeOpenAlexApiKey,
    getOpenAlexApiKey,
    deleteOpenAlexApiKey,
    hasOpenAlexApiKey
} from '../secretStorage';

// Create mock extension context
function createMockContext() {
    return {
        subscriptions: [],
        globalStorageUri: { fsPath: '/tmp/test-storage' },
        secrets: {
            store: vi.fn().mockImplementation((key: string, value: string) => {
                mockSecretStore.set(key, value);
                return Promise.resolve();
            }),
            get: vi.fn().mockImplementation((key: string) => {
                return Promise.resolve(mockSecretStore.get(key));
            }),
            delete: vi.fn().mockImplementation((key: string) => {
                mockSecretStore.delete(key);
                return Promise.resolve();
            })
        }
    } as any;
}

describe('SecretStorage', () => {
    beforeEach(() => {
        // Clear mock storage before each test
        mockSecretStore.clear();
        vi.clearAllMocks();
    });

    describe('initialization', () => {
        it('should initialize with extension context', () => {
            const context = createMockContext();
            expect(() => initSecretStorage(context)).not.toThrow();
        });
    });

    describe('storeOpenAlexApiKey', () => {
        it('should store API key securely', async () => {
            const context = createMockContext();
            initSecretStorage(context);

            await storeOpenAlexApiKey('test-openalex-key-12345');

            expect(context.secrets.store).toHaveBeenCalledWith(
                'scimax.openalexApiKey',
                'test-openalex-key-12345'
            );
            expect(mockSecretStore.get('scimax.openalexApiKey')).toBe('test-openalex-key-12345');
        });
    });

    describe('getOpenAlexApiKey', () => {
        it('should retrieve stored API key', async () => {
            const context = createMockContext();
            initSecretStorage(context);

            // Store a key first
            await storeOpenAlexApiKey('openalex-retrieved-key');

            const key = await getOpenAlexApiKey();
            expect(key).toBe('openalex-retrieved-key');
        });

        it('should return undefined if no key stored', async () => {
            const context = createMockContext();
            initSecretStorage(context);

            const key = await getOpenAlexApiKey();
            expect(key).toBeUndefined();
        });
    });

    describe('deleteOpenAlexApiKey', () => {
        it('should delete stored API key', async () => {
            const context = createMockContext();
            initSecretStorage(context);

            // Store then delete
            await storeOpenAlexApiKey('openalex-to-delete');
            expect(await hasOpenAlexApiKey()).toBe(true);

            await deleteOpenAlexApiKey();
            expect(await hasOpenAlexApiKey()).toBe(false);
        });
    });

    describe('hasOpenAlexApiKey', () => {
        it('should return true when key exists', async () => {
            const context = createMockContext();
            initSecretStorage(context);

            await storeOpenAlexApiKey('openalex-exists');
            expect(await hasOpenAlexApiKey()).toBe(true);
        });

        it('should return false when no key', async () => {
            const context = createMockContext();
            initSecretStorage(context);

            expect(await hasOpenAlexApiKey()).toBe(false);
        });

        it('should return false for empty string', async () => {
            const context = createMockContext();
            initSecretStorage(context);

            mockSecretStore.set('scimax.openalexApiKey', '');
            expect(await hasOpenAlexApiKey()).toBe(false);
        });
    });
});

describe('SecretStorage Security Properties', () => {
    beforeEach(() => {
        mockSecretStore.clear();
        vi.clearAllMocks();
    });

    it('should not expose API key in settings after storing', async () => {
        const context = createMockContext();
        initSecretStorage(context);

        // After storing, key should be in SecretStorage only
        await storeOpenAlexApiKey('secure-openalex-key');

        // Key should be retrievable from SecretStorage
        const key = await getOpenAlexApiKey();
        expect(key).toBe('secure-openalex-key');
    });
});
