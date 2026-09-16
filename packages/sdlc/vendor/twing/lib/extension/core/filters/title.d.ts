import type { TwingMarkup } from "../../../markup";
import { TwingCallable, TwingSynchronousCallable } from "../../../callable-wrapper";
/**
 * Returns a title-cased string.
 *
 * @param _executionContext
 * @param string A string
 *
 * @returns The title-cased string
 */
export declare const title: TwingCallable<[
    string: string | TwingMarkup
], string>;
export declare const titleSynchronously: TwingSynchronousCallable<[
    string: string | TwingMarkup
], string>;
