import type { TwingLoader, TwingSynchronousLoader } from "../loader";
export interface TwingChainLoader extends TwingLoader {
    readonly loaders: Array<TwingLoader>;
    addLoader(loader: TwingLoader): void;
}
export interface TwingSynchronousChainLoader extends TwingSynchronousLoader {
    readonly loaders: Array<TwingSynchronousLoader>;
    addLoader(loader: TwingSynchronousLoader): void;
}
export declare const createChainLoader: (loaders: Array<TwingLoader>) => TwingChainLoader;
export declare const createSynchronousChainLoader: (loaders: Array<TwingSynchronousLoader>) => TwingSynchronousChainLoader;
