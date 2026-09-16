import { TwingTagHandler } from "../tag-handler";
/**
 * Deprecates a section of a template.
 *
 * <pre>
 * {% deprecated 'The "base.twig" template is deprecated, use "layout.twig" instead.' %}
 *
 * {% extends 'layout.html.twig' %}
 * </pre>
 *
 * @author Eric MORAND <eric.morand@gmail.com>
 */
export declare const createDeprecatedTagHandler: () => TwingTagHandler;
