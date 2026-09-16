import { TwingCallable, TwingSynchronousCallable } from "../../../callable-wrapper";
/**
 * Returns the keys of the passed array.
 *
 * @param _executionContext
 * @param values An array
 *
 * @returns {Promise<Array<any>>} The keys
 */
export declare const keys: TwingCallable<[
    values: Array<any>
], Array<any>>;
export declare const keysSynchronously: TwingSynchronousCallable<[
    values: Array<any>
], Array<any>>;
