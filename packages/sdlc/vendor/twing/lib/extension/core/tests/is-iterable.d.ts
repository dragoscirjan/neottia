import { TwingCallable, TwingSynchronousCallable } from "../../../callable-wrapper";
/**
 * Checks if a variable is traversable.
 *
 * <pre>
 * {# evaluates to true if the foo variable is an array or a traversable object #}
 * {% if foo is iterable %}
 *     {# ... #}
 * {% endif %}
 * </pre>
 *
 * @param value A variable
 *
 * @return {Promise<boolean>} true if the value is traversable
 */
export declare const isIterable: TwingCallable<[value: any], boolean>;
export declare const isIterableSynchronously: TwingSynchronousCallable<[value: any], boolean>;
