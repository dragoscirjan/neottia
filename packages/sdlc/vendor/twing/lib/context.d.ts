export interface TwingContext<K extends string, V> {
    readonly size: number;
    [Symbol.iterator](): IterableIterator<[string, V]>;
    clone(): TwingContext<K, V>;
    delete(key: K): boolean;
    entries(): IterableIterator<[string, V]>;
    get(key: K): V | undefined;
    has(key: K): boolean;
    set(key: K, value: V): TwingContext<K, V>;
    values(): IterableIterator<V>;
}
export declare const createContext: <K extends string, V>(container?: Map<K, V>) => TwingContext<K, V>;
export declare const getEntries: <V>(context: Record<string, V>) => IterableIterator<[string, V]>;
export declare const getValues: <V>(context: Record<string, V>) => Array<V>;
