import type { TwingExpressionNode } from "./node/expression";
import type { TwingPrintNode } from "./node/print";
import type { TwingBlockReferenceNode } from "./node/block-reference";
import type { TwingTextNode } from "./node/text";
import type { TwingAutoEscapeNode } from "./node/auto-escape";
import type { TwingCheckSecurityNode } from "./node/check-security";
import type { TwingCheckToStringNode } from "./node/check-to-string";
import type { TwingCommentNode } from "./node/comment";
import type { TwingDeprecatedNode } from "./node/deprecated";
import type { TwingDoNode } from "./node/do";
import type { TwingEmbedNode } from "./node/include/embed";
import type { TwingIncludeNode } from "./node/include/include";
import type { TwingFlushNode } from "./node/flush";
import type { TwingForNode } from "./node/for";
import type { TwingForLoopNode } from "./node/for-loop";
import type { TwingImportNode } from "./node/import";
import type { TwingLineNode } from "./node/line";
import type { TwingMacroNode } from "./node/macro";
import type { TwingTemplateNode } from "./node/template";
import type { TwingBlockNode } from "./node/block";
import type { TwingTraitNode } from "./node/trait";
import type { TwingSetNode } from "./node/set";
import type { TwingVerbatimNode } from "./node/verbatim";
import type { TwingSandboxNode } from "./node/sandbox";
import type { TwingSpacelessNode } from "./node/spaceless";
import type { TwingWithNode } from "./node/with";
import type { TwingIfNode } from "./node/if";
import type { TwingMethodCallNode } from "./node/expression/method-call";
import type { TwingEscapeNode } from "./node/expression/escape";
import type { TwingApplyNode } from "./node/apply";
export type TwingNode = TwingApplyNode | TwingAutoEscapeNode | TwingBlockNode | TwingBlockReferenceNode | TwingCheckSecurityNode | TwingCheckToStringNode | TwingCommentNode | TwingDeprecatedNode | TwingDoNode | TwingEmbedNode | TwingEscapeNode | TwingExpressionNode | TwingFlushNode | TwingForLoopNode | TwingForNode | TwingIfNode | TwingImportNode | TwingIncludeNode | TwingLineNode | TwingMacroNode | TwingMethodCallNode | TwingTemplateNode | TwingPrintNode | TwingSandboxNode | TwingSetNode | TwingSpacelessNode | TwingTextNode | TwingTraitNode | TwingVerbatimNode | TwingWithNode;
export type TwingNodeType<T> = T extends TwingBaseNode<infer Type, any, any> ? Type : never;
export type TwingNodeAttributes<T> = T extends TwingBaseNode<any, infer Attributes, any> ? Attributes : never;
export type TwingNodeChildren<T> = T extends TwingBaseNode<any, any, infer Children> ? Children : never;
export type TwingBaseNodeAttributes = Record<never, never>;
export type TwingBaseNodeChildren = Record<string, TwingBaseNode>;
export interface TwingBaseNode<Type extends string | null = any, Attributes extends TwingBaseNodeAttributes = TwingBaseNodeAttributes, Children extends TwingBaseNodeChildren = TwingBaseNodeChildren> {
    readonly attributes: Attributes;
    readonly children: Children;
    readonly column: number;
    readonly line: number;
    readonly tag: string | null;
    readonly type: Type;
}
export type KeysOf<T> = T extends T ? keyof T : never;
export declare const getChildren: <T extends TwingBaseNode>(node: T) => Array<[KeysOf<TwingNodeChildren<T>>, TwingNodeChildren<T>[any]]>;
export declare const getChildrenCount: (node: TwingBaseNode) => number;
export declare const createBaseNode: <Type extends string | null, Attributes extends TwingBaseNodeAttributes, Children extends TwingBaseNodeChildren>(type: Type, attributes?: Attributes, children?: Children, line?: number, column?: number, tag?: string | null) => TwingBaseNode<Type, Attributes, Children>;
/**
 * Create a node acting as a container for the passed list of indexed nodes.
 *
 * @param children The children of the created node
 * @param line The line of the created node
 * @param column The column of the created node
 * @param tag The tag of the created node
 */
export declare const createNode: <Children extends TwingBaseNodeChildren>(children?: Children, line?: number, column?: number, tag?: string | null) => TwingBaseNode<null, {}, Children>;
