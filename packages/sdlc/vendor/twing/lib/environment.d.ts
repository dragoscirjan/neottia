import { TwingTagHandler } from "./tag-handler";
import { TwingNodeVisitor } from "./node-visitor";
import { TwingFilter, TwingSynchronousFilter } from "./filter";
import { TwingParserOptions } from "./parser";
import { TwingLoader, TwingSynchronousLoader } from "./loader";
import { TwingSynchronousTest, TwingTest } from "./test";
import { TwingFunction, TwingSynchronousFunction } from "./function";
import { TwingOperator } from "./operator";
import { TwingEscapingStrategy, TwingEscapingStrategyHandler } from "./escaping-strategy";
import { TwingSource } from "./source";
import { TwingTokenStream } from "./token-stream";
import { TwingExtension, TwingSynchronousExtension } from "./extension";
import { TwingTemplateNode } from "./node/template";
import { RawSourceMap } from "source-map";
import { TwingSandboxSecurityPolicy } from "./sandbox/security-policy";
import { TwingSynchronousTemplate, TwingTemplate } from "./template";
import { TwingCache, TwingSynchronousCache } from "./cache";
import { type TwingContext } from "../lib";
export type TwingNumberFormat = {
    numberOfDecimals: number;
    decimalPoint: string;
    thousandSeparator: string;
};
export type TwingEnvironmentOptions = {
    /**
     * The implicit auto-escaping strategy to apply to the templates.
     *
     * Analogous to adding an `autoescape` tag at the top of each loaded template.
     */
    autoEscapingStrategy?: string;
    /**
     * The persistent cache instance.
     */
    cache?: TwingCache;
    /**
     * The default charset. Defaults to "UTF-8".
     */
    charset?: string;
    dateFormat?: string;
    dateIntervalFormat?: string;
    globals?: Record<string, any>;
    numberFormat?: TwingNumberFormat;
    parserOptions?: TwingParserOptions;
    sandboxPolicy?: TwingSandboxSecurityPolicy;
    timezone?: string;
};
export type TwingSynchronousEnvironmentOptions = Omit<TwingEnvironmentOptions, "cache"> & {
    /**
     * The persistent cache instance.
     */
    cache?: TwingSynchronousCache;
};
export interface TwingEnvironment {
    readonly cache: TwingCache | null;
    readonly charset: string;
    readonly dateFormat: string;
    readonly dateIntervalFormat: string;
    readonly escapingStrategyHandlers: Record<TwingEscapingStrategy, TwingEscapingStrategyHandler>;
    readonly numberFormat: TwingNumberFormat;
    readonly filters: Map<string, TwingFilter>;
    readonly functions: Map<string, TwingFunction>;
    readonly globals: TwingContext<string, any>;
    readonly loader: TwingLoader | TwingSynchronousLoader;
    readonly sandboxPolicy: TwingSandboxSecurityPolicy;
    readonly tests: Map<string, TwingTest>;
    readonly timezone: string;
    /**
     * Convenient method...
     *
     * @param extension
     */
    addExtension(extension: TwingExtension): void;
    addFilter(filter: TwingFilter): void;
    addFunction(aFunction: TwingFunction): void;
    addNodeVisitor(visitor: TwingNodeVisitor): void;
    addOperator(operator: TwingOperator): void;
    addTagHandler(parser: TwingTagHandler): void;
    addTest(test: TwingTest): void;
    /**
     * Loads a template by its name.
     *
     * @param name The name of the template to load
     * @param from The name of the template that requested the load
     *
     * @throws {Error}  When the template cannot be found
     * @throws {TwingParsingError} When an error occurred during the parsing of the source
     *
     * @return
     */
    loadTemplate(name: string, from?: string | null): Promise<TwingTemplate>;
    /**
     * Converts a token list to a template.
     *
     * @param {TwingTokenStream} stream
     * @param {TwingParserOptions} options
     * *
     * @throws {TwingParsingError} When the token stream is syntactically or semantically wrong
     */
    parse(stream: TwingTokenStream, options?: TwingParserOptions): TwingTemplateNode;
    /**
     * Convenient method that renders a template from its name.
     */
    render(name: string, context: Record<string, any>, options?: {
        sandboxed?: boolean;
        strict?: boolean;
    }): Promise<string>;
    /**
     * Convenient method that renders a template from its name and returns both the render result and its belonging source map.
     */
    renderWithSourceMap(name: string, context: Record<string, any>, options?: {
        sandboxed?: boolean;
        strict?: boolean;
    }): Promise<{
        data: string;
        sourceMap: RawSourceMap;
    }>;
    registerEscapingStrategy(handler: TwingEscapingStrategyHandler, name: string): void;
    /**
     * Tokenizes a source code.
     *
     * @param {TwingSource} source The source to tokenize
     * @return {TwingTokenStream}
     */
    tokenize(source: TwingSource): TwingTokenStream;
}
export interface TwingSynchronousEnvironment {
    readonly cache: TwingSynchronousCache | null;
    readonly charset: string;
    readonly dateFormat: string;
    readonly dateIntervalFormat: string;
    readonly escapingStrategyHandlers: Record<TwingEscapingStrategy, TwingEscapingStrategyHandler>;
    readonly numberFormat: TwingNumberFormat;
    readonly filters: Map<string, TwingSynchronousFilter>;
    readonly functions: Map<string, TwingSynchronousFunction>;
    readonly globals: Map<string, any>;
    readonly loader: TwingSynchronousLoader;
    readonly sandboxPolicy: TwingSandboxSecurityPolicy;
    readonly tests: Map<string, TwingSynchronousTest>;
    readonly timezone: string;
    /**
     * Convenient method...
     *
     * @param extension
     */
    addExtension(extension: TwingSynchronousExtension): void;
    addFilter(filter: TwingSynchronousFilter): void;
    addFunction(aFunction: TwingSynchronousFunction): void;
    addNodeVisitor(visitor: TwingNodeVisitor): void;
    addOperator(operator: TwingOperator): void;
    addTagHandler(parser: TwingTagHandler): void;
    addTest(test: TwingSynchronousTest): void;
    /**
     * Loads a template by its name.
     *
     * @param name The name of the template to load
     * @param from The name of the template that requested the load
     *
     * @throws {Error}  When the template cannot be found
     * @throws {TwingParsingError} When an error occurred during the parsing of the source
     *
     * @return
     */
    loadTemplate(name: string, from?: string | null): TwingSynchronousTemplate;
    /**
     * Converts a token list to a template.
     *
     * @param {TwingTokenStream} stream
     * @param {TwingParserOptions} options
     * *
     * @throws {TwingParsingError} When the token stream is syntactically or semantically wrong
     */
    parse(stream: TwingTokenStream, options?: TwingParserOptions): TwingTemplateNode;
    /**
     * Convenient method that renders a template from its name.
     */
    render(name: string, context: Record<string, any>, options?: {
        sandboxed?: boolean;
        strict?: boolean;
    }): string;
    /**
     * Convenient method that renders a template from its name and returns both the render result and its belonging source map.
     */
    renderWithSourceMap(name: string, context: Record<string, any>, options?: {
        sandboxed?: boolean;
        strict?: boolean;
    }): {
        data: string;
        sourceMap: RawSourceMap;
    };
    registerEscapingStrategy(handler: TwingEscapingStrategyHandler, name: string): void;
    /**
     * Tokenizes a source code.
     *
     * @param {TwingSource} source The source to tokenize
     * @return {TwingTokenStream}
     */
    tokenize(source: TwingSource): TwingTokenStream;
}
/**
 * Creates an instance of {@link TwingEnvironment} backed by the passed loader.
 *
 * @param loader
 * @param options
 */
export declare const createEnvironment: (loader: TwingLoader | TwingSynchronousLoader, options?: TwingEnvironmentOptions) => TwingEnvironment;
export declare const createSynchronousEnvironment: (loader: TwingSynchronousLoader, options?: TwingSynchronousEnvironmentOptions) => TwingSynchronousEnvironment;
