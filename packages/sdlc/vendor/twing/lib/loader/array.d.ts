import type { TwingLoader, TwingSynchronousLoader } from "../loader";
export interface TwingArrayLoader extends TwingLoader {
    setTemplate(name: string, template: string): void;
}
export interface TwingSynchronousArrayLoader extends TwingSynchronousLoader {
    setTemplate(name: string, template: string): void;
}
export declare const createArrayLoader: (templates: Record<string, string>) => TwingArrayLoader;
export declare const createSynchronousArrayLoader: (templates: Record<string, string>) => TwingSynchronousArrayLoader;
