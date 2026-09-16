import type { TwingLoader, TwingSynchronousLoader } from "../loader";
export interface TwingFilesystemLoaderFilesystemStats {
    isFile(): boolean;
    readonly mtime: Date;
}
export interface TwingFilesystemLoaderFilesystem {
    stat(path: string, callback: (error: Error | null, stats: TwingFilesystemLoaderFilesystemStats | null) => void): void;
    readFile(path: string, callback: (error: Error | null, data: Buffer | null) => void): void;
}
export interface TwingSynchronousFilesystemLoaderFilesystem {
    statSync(path: string): TwingFilesystemLoaderFilesystemStats | null;
    readFileSync(path: string): Buffer | null;
}
export interface TwingFilesystemLoader extends TwingLoader {
    /**
     * Adds a path where templates are stored.
     *
     * @param path A path where to look for templates
     * @param namespace A path namespace
     */
    addPath(path: string, namespace?: string | null): void;
    /**
     * Prepends a path where templates are stored.
     *
     * @param path A path where to look for templates
     * @param namespace A path namespace
     */
    prependPath(path: string, namespace?: string | null): void;
}
export interface TwingSynchronousFilesystemLoader extends TwingSynchronousLoader {
    /**
     * Adds a path where templates are stored.
     *
     * @param path A path where to look for templates
     * @param namespace A path namespace
     */
    addPath(path: string, namespace?: string | null): void;
    /**
     * Prepends a path where templates are stored.
     *
     * @param path A path where to look for templates
     * @param namespace A path namespace
     */
    prependPath(path: string, namespace?: string | null): void;
}
export declare const createFilesystemLoader: (filesystem: TwingFilesystemLoaderFilesystem) => TwingFilesystemLoader;
export declare const createSynchronousFilesystemLoader: (filesystem: TwingSynchronousFilesystemLoaderFilesystem) => TwingSynchronousFilesystemLoader;
