import { TwingCallable, TwingSynchronousCallable } from "../../../callable-wrapper";
/**
 * Batches item.
 *
 * @param _executionContext
 * @param {any[]} items An array of items
 * @param {number} size  The size of the batch
 * @param {any} fill A value used to fill missing items
 * @param {boolean} preserveKeys
 *
 * @returns Promise<Map<any, any>[]>
 */
export declare const batch: TwingCallable<[
    items: Array<any>,
    size: number,
    fill: any,
    preserveKeys: boolean
], Array<Map<any, any>>>;
export declare const batchSynchronously: TwingSynchronousCallable<[
    items: Array<any>,
    size: number,
    fill: any,
    preserveKeys: boolean
], Array<Map<any, any>>>;
