import { TwingCallable, TwingSynchronousCallable } from "../../../callable-wrapper";
type Range<V = any> = TwingCallable<[
    low: V,
    high: V,
    step: number
], Map<number, V>>;
export declare const range: Range;
type SynchronousRange<V = any> = TwingSynchronousCallable<[
    low: V,
    high: V,
    step: number
], Map<number, V>>;
export declare const rangeSynchronously: SynchronousRange;
export {};
