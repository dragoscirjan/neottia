import { TwingCallable, TwingSynchronousCallable } from "../../../callable-wrapper";
/**
 * Checks if a variable is empty.
 *
 * <pre>
 * {# evaluates to true if the foo variable is null, false, or the empty string #}
 * {% if foo is empty %}
 *     {# ... #}
 * {% endif %}
 * </pre>
 *
 * @param executionContext
 * @param value A variable
 *
 * @returns {boolean} true if the value is empty, false otherwise
 */
export declare const isEmpty: TwingCallable<[value: any], boolean>;
export declare const isEmptySynchronously: TwingSynchronousCallable<[value: any], boolean>;
