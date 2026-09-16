import { TwingCallable, TwingSynchronousCallable } from "../../../callable-wrapper";
/**
 * Returns the first element of the item.
 *
 * @param executionContext
 * @param item
 *
 * @returns {Promise<any>} The first element of the item
 */
export declare const first: TwingCallable<[
    item: any
]>;
export declare const firstSynchronously: TwingSynchronousCallable<[
    item: any
]>;
