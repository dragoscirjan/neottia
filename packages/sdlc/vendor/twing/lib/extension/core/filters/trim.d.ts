import { TwingCallable, TwingSynchronousCallable } from "../../../callable-wrapper";
/**
 * Returns a trimmed string.
 *
 * @returns {Promise<string>}
 *
 * @throws TwingErrorRuntime When an invalid trimming side is used (not a string or not 'left', 'right', or 'both')
 */
export declare const trim: TwingCallable;
export declare const trimSynchronously: TwingSynchronousCallable;
