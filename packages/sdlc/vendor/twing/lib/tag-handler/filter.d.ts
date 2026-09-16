import { TwingTagHandler } from "../tag-handler";
/**
 * Filters a section of a template by applying filters.
 *
 * <pre>
 * {% filter upper %}
 *  This text becomes uppercase
 * {% endfilter %}
 * </pre>
 */
export declare const createFilterTagHandler: () => TwingTagHandler;
