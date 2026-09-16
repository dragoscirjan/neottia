import { TwingCallable, TwingSynchronousCallable } from "../../../callable-wrapper";
/**
 * Replaces strings within a string.
 *
 * @param {string} value String to replace in
 * @param {Array<string>|Map<string, string>} from Replace values
 *
 * @returns {Promise<string>}
 */
export declare const replace: TwingCallable;
export declare const replaceSynchronously: TwingSynchronousCallable;
