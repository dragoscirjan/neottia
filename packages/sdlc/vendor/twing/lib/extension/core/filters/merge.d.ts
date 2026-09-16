import { TwingCallable, TwingSynchronousCallable } from "../../../callable-wrapper";
/**
 * Merges an array with another one.
 *
 * <pre>
 *  {% set items = { 'apple': 'fruit', 'orange': 'fruit' } %}
 *
 *  {% set items = items|merge({ 'peugeot': 'car' }) %}
 *
 *  {# items now contains { 'apple': 'fruit', 'orange': 'fruit', 'peugeot': 'car' } #}
 * </pre>
 *
 * @param {any} iterable1 An iterable
 * @param {any} source An iterable
 *
 * @return {Promise<Map<any, any>>} The merged map
 */
export declare const merge: TwingCallable;
export declare const mergeSynchronously: TwingSynchronousCallable;
