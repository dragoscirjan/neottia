import type { TwingTokenStream } from "./token-stream";
import { TwingTagHandler } from "./tag-handler";
import { TwingNodeVisitor } from "./node-visitor";
import { TwingBaseNode } from "./node";
import { TwingBaseExpressionNode, TwingExpressionNode } from "./node/expression";
import { TwingTemplateNode } from "./node/template";
import { TwingMacroNode } from "./node/macro";
import { TwingAssignmentNode } from "./node/expression/assignment";
import { TwingArrayNode } from "./node/expression/array";
import { TwingSynchronousTest, TwingTest } from "./test";
import { TwingOperator } from "./operator";
import { Token } from "twig-lexer";
import { TwingFilterNode } from "./node/expression/call/filter";
import type { TwingTraitNode } from "./node/trait";
import { TwingFilter, TwingSynchronousFilter } from "./filter";
import { TwingFunction, TwingSynchronousFunction } from "./function";
import { TwingBlockNode } from "./node/block";
type TwingParserImportedSymbolAlias = {
    name: string;
    node: TwingBaseNode<any, {
        name: string;
    }>;
};
type TwingParserImportedSymbolType = Map<string, TwingParserImportedSymbolAlias>;
type TwingParserImportedSymbol = {
    method: TwingParserImportedSymbolType;
    template: Array<string>;
};
export type TwingParserOptions = {
    strict?: boolean;
    level?: 2 | 3;
};
type ParseTest = [tag: string, test: (token: Token) => boolean];
export interface TwingParser {
    parent: TwingBaseNode | null;
    addImportedSymbol(type: 'template', alias: string): void;
    addImportedSymbol(type: 'method', alias: string, name: string, node: TwingBaseNode<any, {
        name: string;
    }>): void;
    addTrait(trait: TwingTraitNode): void;
    embedTemplate(template: TwingTemplateNode): void;
    getBlock(name: string): TwingBlockNode | null;
    getVarName(prefix?: string): string;
    isMainScope(): boolean;
    parse(stream: TwingTokenStream, tag?: string | null, test?: ParseTest[1] | null): TwingTemplateNode;
    parseArguments(stream: TwingTokenStream, namedArguments?: boolean, definition?: boolean, allowArrow?: true): TwingArrayNode;
    parseAssignmentExpression(stream: TwingTokenStream): TwingBaseNode<null, {}, {
        [key: number]: TwingAssignmentNode;
    }>;
    parseExpression(stream: TwingTokenStream, precedence?: number, allowArrow?: true): TwingExpressionNode;
    parseFilterDefinitions(stream: TwingTokenStream): Array<{
        name: string;
        arguments: TwingArrayNode;
    }>;
    parseFilterExpressionRaw(stream: TwingTokenStream, node: TwingBaseExpressionNode, tag?: string | null): TwingFilterNode;
    parseMultiTargetExpression(stream: TwingTokenStream): TwingBaseNode<null>;
    peekBlockStack(): string;
    popBlockStack(): void;
    popLocalScope(): void;
    pushBlockStack(name: string): void;
    pushLocalScope(): void;
    setBlock(name: string, node: TwingBlockNode): void;
    setMacro(name: string, node: TwingMacroNode): void;
    subparse(stream: TwingTokenStream, tag: string | null, test: ParseTest[1] | null): TwingBaseNode;
}
export type StackEntry = {
    stream: TwingTokenStream;
    parent: TwingBaseExpressionNode | null;
    blocks: Record<string, TwingBlockNode>;
    blockStack: Array<string>;
    macros: Record<string, TwingMacroNode>;
    importedSymbols: Array<TwingParserImportedSymbol>;
    traits: Record<string, TwingTraitNode>;
    embeddedTemplates: Array<TwingTemplateNode>;
};
export declare const createParser: (unaryOperators: Array<TwingOperator>, binaryOperators: Array<TwingOperator>, additionalTagHandlers: Array<TwingTagHandler>, visitors: Array<TwingNodeVisitor>, filters: Map<string, TwingFilter | TwingSynchronousFilter>, functions: Map<string, TwingFunction | TwingSynchronousFunction>, tests: Map<string, TwingTest | TwingSynchronousTest>, options?: TwingParserOptions) => TwingParser;
export {};
