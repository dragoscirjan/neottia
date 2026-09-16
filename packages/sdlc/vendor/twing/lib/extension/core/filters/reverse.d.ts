import { TwingCallable, TwingSynchronousCallable } from "../../../callable-wrapper";
/**
 * Reverses a variable.
 *
 * @param {string | Map<*, *>} item A traversable instance, or a string
 * @param {boolean} preserveKeys Whether to preserve key or not
 *
 * @returns {Promise<string | Map<any, any>>} The reversed input
 */
export declare const reverse: TwingCallable;
export declare const reverseSynchronously: TwingSynchronousCallable;
