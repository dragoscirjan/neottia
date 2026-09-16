import { TwingCallable, TwingSynchronousCallable } from "../../../callable-wrapper";
/**
 * Joins the values to a string.
 *
 * The separator between elements is an empty string per default, you can define it with the optional parameter.
 *
 * <pre>
 *  {{ [1, 2, 3]|join('|') }}
 *  {# returns 1|2|3 #}
 *
 *  {{ [1, 2, 3]|join }}
 *  {# returns 123 #}
 * </pre>
 *
 * @param _executionContext
 * @param value A value
 * @param glue The separator
 * @param and The separator for the last pair
 *
 * @returns {Promise<string>} The concatenated string
 */
export declare const join: TwingCallable<[
    value: any,
    glue: string,
    and: string | null
], string>;
export declare const joinSynchronously: TwingSynchronousCallable<[
    value: any,
    glue: string,
    and: string | null
], string>;
