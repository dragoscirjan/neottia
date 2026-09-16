import { TwingMarkup } from "../markup";
import { TwingEnvironment, TwingSynchronousEnvironment } from "../environment";
import { TwingEscapingStrategy } from "../escaping-strategy";
import { TwingSynchronousTemplate, TwingTemplate } from "../template";
export declare const escapeValue: (template: TwingTemplate, environment: TwingEnvironment, value: string | boolean | TwingMarkup | null | undefined, strategy: TwingEscapingStrategy | string, charset: string | null) => Promise<string | boolean | TwingMarkup>;
export declare const escapeValueSynchronously: (template: TwingTemplate | TwingSynchronousTemplate, environment: TwingEnvironment | TwingSynchronousEnvironment, value: string | boolean | TwingMarkup | null | undefined, strategy: TwingEscapingStrategy | string, charset: string | null) => string | boolean | TwingMarkup;
