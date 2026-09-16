import { TwingCallable, TwingSynchronousCallable } from "../../../callable-wrapper";
/**
 * Converts a date to the given format.
 *
 * <pre>
 *   {{ post.published_at|date("m/d/Y") }}
 * </pre>
 *
 * @param executionContext
 * @param date A date
 * @param format The target format, null to use the default
 * @param timezone The target timezone, null to use the default, false to leave unchanged
 *
 * @return {Promise<string>} The formatted date
 */
export declare const date: TwingCallable;
export declare const dateFilterSynchronously: TwingSynchronousCallable;
