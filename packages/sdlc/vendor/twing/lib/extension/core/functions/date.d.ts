import { DateTime } from "luxon";
import { TwingCallable, TwingSynchronousCallable } from "../../../callable-wrapper";
/**
 * Converts an input to a DateTime instance.
 *
 * <pre>
 *    {% if date(user.created_at) < date('+2days') %}
 *      {# do something #}
 *    {% endif %}
 * </pre>
 *
 * @param {TwingTemplate} template
 * @param {Date | DateTime | Duration | number | string} input A date or null to use the current time
 * @param {string | null | boolean} timezone The target timezone, null to use the default, false to leave unchanged
 *
 * @returns {Promise<DateTime | Duration>}
 */
export declare const createDateTime: (defaultTimezone: string, input: Date | DateTime | number | string | null, timezone: string | null | false) => Promise<DateTime>;
export declare const date: TwingCallable;
export declare const createDateTimeSynchronously: (defaultTimezone: string, input: Date | DateTime | number | string | null, timezone: string | null | false) => DateTime;
export declare const dateSynchronously: TwingSynchronousCallable;
