import type { TwingCallable, TwingSynchronousCallable } from "../../../callable-wrapper";
/**
 * Returns a template content without rendering it.
 *
 * @param executionContext
 * @param name The template name
 * @param ignoreMissing Whether to ignore missing templates or not
 *
 * @return The template source
 */
export declare const source: TwingCallable<[
    name: string,
    ignoreMissing: boolean
], string | null>;
export declare const sourceSynchronously: TwingSynchronousCallable<[
    name: string,
    ignoreMissing: boolean
], string | null>;
