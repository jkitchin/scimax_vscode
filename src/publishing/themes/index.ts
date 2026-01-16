/**
 * Theme Registry for Org Publishing
 * Manages available themes and provides factory methods
 */

export * from './themeTypes';

import type { Theme, ThemeConfig, PageContext, ProjectContext, PageInfo } from './themeTypes';
import { DEFAULT_THEME_CONFIG } from './themeTypes';
import { DefaultTheme } from './defaultTheme';
import { BookTheme } from './bookTheme';

// =============================================================================
// Theme Registry
// =============================================================================

/**
 * Registry of available themes
 */
const themeRegistry: Map<string, new () => Theme> = new Map();

/**
 * Register a theme
 */
export function registerTheme(name: string, themeClass: new () => Theme): void {
    themeRegistry.set(name, themeClass);
}

/**
 * Get a theme by name
 */
export function getTheme(name: string): Theme | undefined {
    const ThemeClass = themeRegistry.get(name);
    if (ThemeClass) {
        return new ThemeClass();
    }
    return undefined;
}

/**
 * Get a theme for the given configuration, falling back to default
 */
export function getThemeForConfig(config?: ThemeConfig): Theme {
    const themeName = config?.name || 'default';
    const theme = getTheme(themeName);
    if (theme) {
        return theme;
    }
    // Fall back to default theme
    return new DefaultTheme();
}

/**
 * Check if a theme is registered
 */
export function hasTheme(name: string): boolean {
    return themeRegistry.has(name);
}

/**
 * Get list of registered theme names
 */
export function getAvailableThemes(): string[] {
    return Array.from(themeRegistry.keys());
}

// =============================================================================
// Register Built-in Themes
// =============================================================================

// Register the default theme
registerTheme('default', DefaultTheme);

// Register the book theme
registerTheme('book', BookTheme);

// =============================================================================
// Re-exports for convenience
// =============================================================================

export { DefaultTheme } from './defaultTheme';
export { BookTheme } from './bookTheme';
