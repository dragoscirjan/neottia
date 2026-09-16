import { TwingCallable, TwingSynchronousCallable } from "../../../callable-wrapper";
/**
 * Return the values from a single column in the input array.
 *
 * @param {*} thing An iterable
 * @param {*} columnKey The column key
 *
 * @return {Promise<Array<any>>} The array of values
 */
export declare const column: TwingCallable;
export declare const columnSynchronously: TwingSynchronousCallable;
