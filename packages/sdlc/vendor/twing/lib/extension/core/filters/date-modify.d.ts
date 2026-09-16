import { TwingCallable, TwingSynchronousCallable } from "../../../callable-wrapper";
/**
 * Returns a new date object modified.
 *
 * <pre>
 *   {{ post.published_at|date_modify("-1day")|date("m/d/Y") }}
 * </pre>
 *
 * @param {TwingTemplate} template
 * @param {DateTime|string} date A date
 * @param {string} modifier A modifier string
 *
 * @returns {Promise<DateTime>} A new date object
 */
export declare const dateModify: TwingCallable;
export declare const dateModifySynchronously: TwingSynchronousCallable;
