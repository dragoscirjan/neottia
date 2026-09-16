import type { TwingFunction } from "../function";
import { TwingSynchronousFunction } from "../function";
/**
 * Get a function by name.
 *
 * @param {string} name         function name
 * @returns {TwingFunction}     A TwingFunction instance or null if the function does not exist
 */
export declare const getFunction: <Function extends TwingFunction | TwingSynchronousFunction>(functions: Map<string, Function>, name: string) => Function | null;
