import { TwingTagHandler } from "../tag-handler";
/**
 * Loops over each item of a sequence.
 *
 * <pre>
 * <ul>
 *  {% for user in users %}
 *    <li>{{ user.username|e }}</li>
 *  {% endfor %}
 * </ul>
 * </pre>
 */
export declare const createSpacelessTagHandler: () => TwingTagHandler;
