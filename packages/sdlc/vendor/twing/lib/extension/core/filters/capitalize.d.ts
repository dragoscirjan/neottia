import type { TwingMarkup } from "../../../markup";
import type { TwingCallable } from "../../../callable-wrapper";
import { TwingSynchronousCallable } from "../../../callable-wrapper";
/**
 * Returns a capitalized string.
 *
 * @param {string | TwingMarkup} string A string
 *
 * @returns {Promise<string>} The capitalized string
 */
export declare const capitalize: TwingCallable<[
    string: string | TwingMarkup
], string>;
export declare const capitalizeSynchronously: TwingSynchronousCallable<[
    string: string | TwingMarkup
], string>;
