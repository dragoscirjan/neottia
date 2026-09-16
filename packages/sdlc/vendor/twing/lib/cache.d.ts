import { TwingTemplateNode } from "./node/template";
export interface TwingCache {
    /**
     * Writes a template AST to the cache.
     *
     * @param key The cache key
     * @param content The template AST
     */
    write: (key: string, content: TwingTemplateNode) => Promise<void>;
    /**
     * Loads a template AST from the cache.
     *
     * @param key The cache key
     *
     * @returns The template AST
     */
    load: (key: string) => Promise<TwingTemplateNode | null>;
    /**
     * Returns the modification timestamp of a key.
     *
     * @param {string} key The cache key
     *
     * @returns The modification timestamp
     */
    getTimestamp: (key: string) => Promise<number>;
}
export interface TwingSynchronousCache {
    /**
     * Writes a template AST to the cache.
     *
     * @param key The cache key
     * @param content The template AST
     */
    write: (key: string, content: TwingTemplateNode) => void;
    /**
     * Loads a template AST from the cache.
     *
     * @param key The cache key
     *
     * @returns The template AST
     */
    load: (key: string) => TwingTemplateNode | null;
    /**
     * Returns the modification timestamp of a key.
     *
     * @param {string} key The cache key
     *
     * @returns The modification timestamp
     */
    getTimestamp: (key: string) => number;
}
