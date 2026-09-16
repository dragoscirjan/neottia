import { TwingCallable, TwingSynchronousCallable } from "../../../callable-wrapper";
/**
 * Loads a template from a string.
 *
 * <pre>
 * {{ include(template_from_string("Hello {{ name }}")) }}
 * </pre>
 *
 * @param executionContext
 * @param code
 * @param name An optional name for the template to be used in error messages
 */
export declare const templateFromString: TwingCallable;
export declare const templateFromStringSynchronously: TwingSynchronousCallable;
