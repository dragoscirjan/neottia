import { TwingContext } from "../context";
export type MapLike<K extends string, V> = Map<K, V> | TwingContext<K, V>;
export declare function isAMapLike(candidate: any): candidate is MapLike<any, any>;
export declare const every: (iterable: MapLike<any, any> | Array<any>, comparator: (value: any, key: any) => Promise<boolean>) => Promise<boolean>;
export declare const everySynchronously: (iterable: MapLike<any, any> | Array<any>, comparator: (value: any, key: any) => boolean) => boolean;
export declare const some: (iterable: MapLike<any, any> | Array<any>, comparator: (value: any, key: any) => Promise<boolean>) => Promise<boolean>;
export declare const someSynchronously: (iterable: MapLike<any, any> | Array<any>, comparator: (value: any, key: any) => boolean) => boolean;
