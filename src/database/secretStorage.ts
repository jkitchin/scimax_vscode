/**
 * Secure storage for sensitive credentials using VS Code's SecretStorage API
 *
 * SecretStorage uses the OS credential manager:
 * - macOS: Keychain
 * - Windows: Credential Manager
 * - Linux: libsecret (GNOME Keyring, KWallet, etc.)
 *
 * This is more secure than storing API keys in settings.json which is plain text.
 */

import * as vscode from 'vscode';

// Secret storage keys
const OPENAI_API_KEY = 'scimax.openaiApiKey';
const OPENALEX_API_KEY = 'scimax.openalexApiKey';

let extensionContext: vscode.ExtensionContext | null = null;

/**
 * Initialize the secret storage module with extension context
 * Must be called during extension activation
 */
export function initSecretStorage(context: vscode.ExtensionContext): void {
    extensionContext = context;
}

/**
 * Get the SecretStorage instance
 */
function getSecrets(): vscode.SecretStorage {
    if (!extensionContext) {
        throw new Error('Secret storage not initialized. Call initSecretStorage() first.');
    }
    return extensionContext.secrets;
}

/**
 * Store the OpenAI API key securely
 */
export async function storeOpenAIApiKey(apiKey: string): Promise<void> {
    await getSecrets().store(OPENAI_API_KEY, apiKey);
}

/**
 * Retrieve the OpenAI API key
 * Returns undefined if not stored
 */
export async function getOpenAIApiKey(): Promise<string | undefined> {
    return await getSecrets().get(OPENAI_API_KEY);
}

/**
 * Delete the OpenAI API key from secure storage
 */
export async function deleteOpenAIApiKey(): Promise<void> {
    await getSecrets().delete(OPENAI_API_KEY);
}

/**
 * Check if an OpenAI API key is stored
 */
export async function hasOpenAIApiKey(): Promise<boolean> {
    const key = await getOpenAIApiKey();
    return key !== undefined && key.length > 0;
}

// =============================================================================
// OpenAlex API Key Functions
// =============================================================================

/**
 * Store the OpenAlex API key securely
 */
export async function storeOpenAlexApiKey(apiKey: string): Promise<void> {
    await getSecrets().store(OPENALEX_API_KEY, apiKey);
}

/**
 * Retrieve the OpenAlex API key
 * Returns undefined if not stored
 */
export async function getOpenAlexApiKey(): Promise<string | undefined> {
    return await getSecrets().get(OPENALEX_API_KEY);
}

/**
 * Delete the OpenAlex API key from secure storage
 */
export async function deleteOpenAlexApiKey(): Promise<void> {
    await getSecrets().delete(OPENALEX_API_KEY);
}

/**
 * Check if an OpenAlex API key is stored
 */
export async function hasOpenAlexApiKey(): Promise<boolean> {
    const key = await getOpenAlexApiKey();
    return key !== undefined && key.length > 0;
}

// =============================================================================
// Migration Functions
// =============================================================================

/**
 * Migrate API key from settings to SecretStorage (one-time migration)
 * This handles users who configured the API key before SecretStorage was implemented
 */
export async function migrateApiKeyFromSettings(): Promise<boolean> {
    if (!extensionContext) {
        return false;
    }

    const config = vscode.workspace.getConfiguration('scimax.db');
    const settingsKey = config.get<string>('openaiApiKey');

    if (settingsKey && settingsKey.length > 0) {
        // Key exists in settings, migrate it
        console.log('Migrating OpenAI API key from settings to SecretStorage...');

        // Store in SecretStorage
        await storeOpenAIApiKey(settingsKey);

        // Remove from settings (set to empty string to clear it)
        await config.update('openaiApiKey', undefined, vscode.ConfigurationTarget.Global);

        console.log('OpenAI API key migrated successfully');
        return true;
    }

    return false;
}
