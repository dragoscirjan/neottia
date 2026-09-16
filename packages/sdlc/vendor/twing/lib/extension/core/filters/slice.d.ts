import { TwingCallable, TwingSynchronousCallable } from "../../../callable-wrapper";
/**
 * Slices a variable.
 *
 * @param _executionContext
 * @param item A variable
 * @param start Start of the slice
 * @param length Size of the slice
 * @param preserveKeys Whether to preserve key or not (when the input is an object)
 *
 * @returns {Promise<string | Map<any, any>>} The sliced variable
 */
export declare const slice: TwingCallable<[
    item: any,
    start: number,
    length: number | null,
    preserveKeys: boolean
], string | Map<any, any>>;
export declare const sliceSynchronously: TwingSynchronousCallable<[
    item: any,
    start: number,
    length: number | null,
    preserveKeys: boolean
], string | Map<any, any>>;
