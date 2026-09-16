import { TwingContext } from "./context";
import { TwingEnvironment, TwingSynchronousEnvironment } from "./environment";
import { TwingOutputBuffer } from "./output-buffer";
import { TwingSourceMapRuntime } from "./source-map-runtime";
import { TwingTemplateNode } from "./node/template";
import { TwingMarkup } from "./markup";
import { TwingSource } from "./source";
import { type TwingNodeExecutor, TwingSynchronousNodeExecutor } from "./node-executor";
import { TwingSynchronousTemplateLoader, type TwingTemplateLoader } from "./template-loader";
import type { TwingExecutionContext, TwingSynchronousExecutionContext } from "./execution-context";
import { type MapLike } from "./helpers/map-like";
export type TwingTemplateBlockMap = Map<string, [template: TwingTemplate, name: string]>;
export type TwingSynchronousTemplateBlockMap = Map<string, [template: TwingSynchronousTemplate, name: string]>;
export type TwingTemplateBlockHandler = (executionContent: TwingExecutionContext) => Promise<void>;
export type TwingSynchronousTemplateBlockHandler = (executionContent: TwingSynchronousExecutionContext) => void;
export type TwingTemplateMacroHandler = (executionContent: TwingExecutionContext, ...macroArguments: Array<any>) => Promise<TwingMarkup>;
export type TwingSynchronousTemplateMacroHandler = (executionContent: TwingSynchronousExecutionContext, ...macroArguments: Array<any>) => TwingMarkup;
export type TwingTemplateAliases = TwingContext<string, TwingTemplate>;
export type TwingSynchronousTemplateAliases = Record<string, TwingSynchronousTemplate>;
/**
 * The shape of a template. A template
 */
export interface TwingTemplate {
    readonly aliases: TwingTemplateAliases;
    readonly ast: TwingTemplateNode;
    readonly blockHandlers: Map<string, TwingTemplateBlockHandler>;
    readonly canBeUsedAsATrait: boolean;
    readonly embeddedTemplates: Map<number, TwingTemplate>;
    readonly source: TwingSource;
    readonly macroHandlers: Map<string, TwingTemplateMacroHandler>;
    readonly name: string;
    displayBlock(executionContext: TwingExecutionContext, name: string, useBlocks: boolean): Promise<void>;
    displayParentBlock(executionContext: TwingExecutionContext, name: string): Promise<void>;
    /**
     * Semantically speaking, provide a closure to the template:
     *   * an environment providing the filters, functions, globals and tests;
     *   * a context providing the variables;
     *   * a block map providing the available blocks;
     *   * an output buffer providing the mean to output the result of an expression.
     *
     * Technically speaking, execute the template and stream the result to the output buffer.
     *
     * @param environment
     * @param context
     * @param blocks
     * @param outputBuffer
     * @param options
     */
    execute(environment: TwingEnvironment, context: TwingContext<any, any>, blocks: TwingTemplateBlockMap, outputBuffer: TwingOutputBuffer, options?: {
        nodeExecutor?: TwingNodeExecutor;
        sandboxed?: boolean;
        sourceMapRuntime?: TwingSourceMapRuntime;
        /**
         * Controls whether accessing invalid variables (variables and or attributes/methods that do not exist) triggers an error.
         *
         * When set to `true`, accessing invalid variables triggers an error.
         */
        strict?: boolean;
        templateLoader?: TwingTemplateLoader;
    }): Promise<void>;
    getBlocks(executionContext: TwingExecutionContext): Promise<TwingTemplateBlockMap>;
    getParent(executionContext: TwingExecutionContext): Promise<TwingTemplate | null>;
    getTraits(executionContext: TwingExecutionContext): Promise<TwingTemplateBlockMap>;
    hasBlock(executionContext: TwingExecutionContext, name: string, blocks: TwingTemplateBlockMap): Promise<boolean>;
    hasMacro(name: string): Promise<boolean>;
    /**
     * @throws {TwingTemplateLoadingError} When no embedded template exists for the passed identifier.
     */
    loadTemplate(executionContext: TwingExecutionContext, identifier: TwingTemplate | string | Array<string | TwingTemplate | null>): Promise<TwingTemplate>;
    render(environment: TwingEnvironment, context: Record<string, any>, options?: {
        nodeExecutor?: TwingNodeExecutor;
        outputBuffer?: TwingOutputBuffer;
        sandboxed?: boolean;
        sourceMapRuntime?: TwingSourceMapRuntime;
        /**
         * Controls whether accessing invalid variables (variables and or attributes/methods that do not exist) triggers an error.
         *
         * When set to `true`, accessing invalid variables triggers an error.
         */
        strict?: boolean;
        templateLoader?: TwingTemplateLoader;
    }): Promise<string>;
}
export interface TwingSynchronousTemplate {
    readonly aliases: TwingSynchronousTemplateAliases;
    readonly ast: TwingTemplateNode;
    readonly blockHandlers: Map<string, TwingSynchronousTemplateBlockHandler>;
    readonly canBeUsedAsATrait: boolean;
    readonly embeddedTemplates: Map<number, TwingSynchronousTemplate>;
    readonly source: TwingSource;
    readonly macroHandlers: Map<string, TwingSynchronousTemplateMacroHandler>;
    readonly name: string;
    displayBlock(executionContext: TwingSynchronousExecutionContext, name: string, useBlocks: boolean): void;
    displayParentBlock(executionContext: TwingSynchronousExecutionContext, name: string): void;
    /**
     * Semantically speaking, provide a closure to the template:
     *   * an environment providing the filters, functions, globals and tests;
     *   * a context providing the variables;
     *   * a block map providing the available blocks;
     *   * an output buffer providing the mean to output the result of an expression.
     *
     * Technically speaking, execute the template and stream the result to the output buffer.
     *
     * @param environment
     * @param context
     * @param blocks
     * @param outputBuffer
     * @param options
     */
    execute(environment: TwingSynchronousEnvironment, context: MapLike<string, any> | Record<string, any>, blocks: TwingSynchronousTemplateBlockMap, outputBuffer: TwingOutputBuffer, options?: {
        nodeExecutor?: TwingSynchronousNodeExecutor;
        sandboxed?: boolean;
        sourceMapRuntime?: TwingSourceMapRuntime;
        /**
         * Controls whether accessing invalid variables (variables and or attributes/methods that do not exist) triggers an error.
         *
         * When set to `true`, accessing invalid variables triggers an error.
         */
        strict?: boolean;
        templateLoader?: TwingSynchronousTemplateLoader;
    }): void;
    getBlocks(executionContext: TwingSynchronousExecutionContext): TwingSynchronousTemplateBlockMap;
    getParent(executionContext: TwingSynchronousExecutionContext): TwingSynchronousTemplate | null;
    getTraits(executionContext: TwingSynchronousExecutionContext): TwingSynchronousTemplateBlockMap;
    hasBlock(executionContext: TwingSynchronousExecutionContext, name: string, blocks: TwingSynchronousTemplateBlockMap): boolean;
    hasMacro(name: string): boolean;
    /**
     * @throws {TwingTemplateLoadingError} When no embedded template exists for the passed identifier.
     */
    loadTemplate(executionContext: TwingSynchronousExecutionContext, identifier: TwingSynchronousTemplate | string | Array<string | TwingSynchronousTemplate | null>): TwingSynchronousTemplate;
    render(environment: TwingSynchronousEnvironment, context: MapLike<string, any> | Record<string, any>, options?: {
        nodeExecutor?: TwingSynchronousNodeExecutor;
        outputBuffer?: TwingOutputBuffer;
        sandboxed?: boolean;
        sourceMapRuntime?: TwingSourceMapRuntime;
        /**
         * Controls whether accessing invalid variables (variables and or attributes/methods that do not exist) triggers an error.
         *
         * When set to `true`, accessing invalid variables triggers an error.
         */
        strict?: boolean;
        templateLoader?: TwingSynchronousTemplateLoader;
    }): string;
}
export declare const executeSynchronousTemplate: (template: TwingSynchronousTemplate, runtime: TwingSynchronousEnvironment, context: MapLike<string, any>, blocks: TwingSynchronousTemplateBlockMap, outputBuffer: TwingOutputBuffer, options?: {
    nodeExecutor?: TwingSynchronousNodeExecutor;
    sandboxed?: boolean;
    sourceMapRuntime?: TwingSourceMapRuntime;
    /**
     * Controls whether accessing invalid variables (variables and or attributes/methods that do not exist) triggers an error.
     *
     * When set to `true`, accessing invalid variables triggers an error.
     */
    strict?: boolean;
    templateLoader?: TwingSynchronousTemplateLoader;
}) => void;
export declare const renderSynchronousTemplate: (template: TwingSynchronousTemplate, runtime: TwingSynchronousEnvironment, context: MapLike<string, any>, options?: {
    nodeExecutor?: TwingSynchronousNodeExecutor;
    outputBuffer?: TwingOutputBuffer;
    sandboxed?: boolean;
    sourceMapRuntime?: TwingSourceMapRuntime;
    /**
     * Controls whether accessing invalid variables (variables and or attributes/methods that do not exist) triggers an error.
     *
     * When set to `true`, accessing invalid variables triggers an error.
     */
    strict?: boolean;
    templateLoader?: TwingSynchronousTemplateLoader;
}) => string;
export declare const createTemplate: (ast: TwingTemplateNode) => TwingTemplate;
export declare const createSynchronousTemplate: (ast: TwingTemplateNode) => TwingSynchronousTemplate;
