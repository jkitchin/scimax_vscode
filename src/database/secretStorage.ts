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

