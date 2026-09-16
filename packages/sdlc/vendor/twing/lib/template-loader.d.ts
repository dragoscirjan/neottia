import { TwingSynchronousTemplate, type TwingTemplate } from "./template";
import type { TwingEnvironment, TwingSynchronousEnvironment } from "./environment";
/**
 * Loads a template by its name.
 *
 * @param name The name of the template to load
 * @param from The name of the template that requested the load
 */
export type TwingTemplateLoader = (name: string, from: string | null) => Promise<TwingTemplate | null>;
export type TwingSynchronousTemplateLoader = (name: string, from: string | null) => TwingSynchronousTemplate | null;
export declare const createTemplateLoader: (environment: TwingEnvironment) => TwingTemplateLoader;
export declare const createSynchronousTemplateLoader: (environment: TwingSynchronousEnvironment) => TwingSynchronousTemplateLoader;
