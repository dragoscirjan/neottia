import { TwingCallable, TwingSynchronousCallable } from "../../../callable-wrapper";
/**
 * Returns a random value depending on the supplied parameter type:
 * - a random item from a Traversable or array
 * - a random character from a string
 * - a random integer between 0 and the integer parameter.
 *
 * @param executionContext
 * @param {*} values The values to pick a random item from
 * @param {number} max Maximum value used when values is an integer
 *
 * @throws TwingErrorRuntime when values is an empty array (does not apply to an empty string which is returned as is)
 *
 * @returns {Promise<any>} A random value from the given sequence
 */
export declare const random: TwingCallable;
export declare const randomSynchronously: TwingSynchronousCallable;
