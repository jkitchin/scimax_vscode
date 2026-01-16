/**
 * Type declarations for citation-js packages
 * @citation-js/core, @citation-js/plugin-bibtex, @citation-js/plugin-csl
 */

declare module '@citation-js/core' {
    export interface CiteFormatOptions {
        format?: 'html' | 'text' | 'rtf';
        template?: string;
        lang?: string;
        entry?: string;
        prepend?: (entry: unknown) => string;
        append?: (entry: unknown) => string;
    }

    export class Cite {
        constructor(data?: unknown, options?: { forceType?: string });

        static async(data: unknown, options?: { forceType?: string }): Promise<Cite>;

        set(data: unknown, options?: { forceType?: string }): Cite;
        add(data: unknown, options?: { forceType?: string }): Cite;
        reset(): Cite;

        format(
            style: 'bibliography' | 'citation' | 'bibtex' | 'data' | 'ris',
            options?: CiteFormatOptions
        ): string;

        get(options?: { format?: string; type?: string; style?: string }): unknown[];

        data: unknown[];
        log: unknown[];
    }

    export const plugins: {
        add(name: string, plugin: unknown): void;
        remove(name: string): void;
        has(name: string): boolean;
        list(): string[];
        input: {
            add(type: string, options: unknown): void;
            has(type: string): boolean;
            remove(type: string): void;
        };
        output: {
            add(name: string, formatter: unknown): void;
            has(name: string): boolean;
            remove(name: string): void;
        };
        config: {
            get(name: string): unknown;
            set(name: string, value: unknown): void;
        };
    };

    export const util: {
        Register: unknown;
        TokenStack: unknown;
        Grammar: unknown;
        Translator: unknown;
    };
}

declare module '@citation-js/plugin-bibtex' {
    // Plugin auto-registers with @citation-js/core when imported
    export {};
}

declare module '@citation-js/plugin-csl' {
    // Plugin auto-registers with @citation-js/core when imported
    export {};
}
