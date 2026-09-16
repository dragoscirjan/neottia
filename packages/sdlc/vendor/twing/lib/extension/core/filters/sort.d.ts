import { TwingCallable, TwingSynchronousCallable } from "../../../callable-wrapper";
/**
 * Sorts an iterable.
 *
 * @param _executionContext
 * @param iterable
 * @param arrow
 *
 * @returns {Promise<Map<any, any>>}
 */
export declare const sort: TwingCallable<[
    iterable: any,
    arrow: ((a: any, b: any) => Promise<-1 | 0 | 1>) | null
], Map<any, any>>;
export declare const sortSynchronously: TwingSynchronousCallable<[
    iterable: any,
    arrow: ((a: any, b: any) => -1 | 0 | 1) | null
], Map<any, any>>;
