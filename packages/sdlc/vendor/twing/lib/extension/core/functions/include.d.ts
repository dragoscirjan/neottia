import { type TwingSynchronousTemplate, type TwingTemplate } from "../../../template";
import type { TwingCallable, TwingSynchronousCallable } from "../../../callable-wrapper";
/**
 * Renders a template.
 *
 * @param executionContext
 * @param templates The template to render or an array of templates to try consecutively
 * @param variables The variables to pass to the template
 * @param withContext
 * @param ignoreMissing Whether to ignore missing templates or not
 * @param sandboxed
 *
 * @returns {Promise<TwingMarkup>} The rendered template
 */
export declare const include: TwingCallable<[
    templates: string | TwingTemplate | null | Array<string | TwingTemplate | null>,
    variables: Map<string, any>,
    withContext: boolean,
    ignoreMissing: boolean,
    sandboxed: boolean
]>;
export declare const includeSynchronously: TwingSynchronousCallable<[
    templates: string | TwingSynchronousTemplate | null | Array<string | TwingSynchronousTemplate | null>,
    variables: Map<string, any>,
    withContext: boolean,
    ignoreMissing: boolean,
    sandboxed: boolean
]>;
