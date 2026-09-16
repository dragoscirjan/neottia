import { TwingCallable, TwingSynchronousCallable } from "../../../callable-wrapper";
/**
 * Rounds a number.
 *
 * @param value The value to round
 * @param {number} precision The rounding precision
 * @param {string} method The method to use for rounding
 *
 * @returns {Promise<number>} The rounded number
 */
export declare const round: TwingCallable;
export declare const roundSynchronously: TwingSynchronousCallable;
