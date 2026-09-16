import { TwingBaseNode, TwingBaseNodeAttributes } from "../node";
import type { TwingSource } from "../source";
import { TwingBaseExpressionNode } from "./expression";
import { TwingTraitNode } from "./trait";
import { TwingMacroNode } from "./macro";
import { TwingBlockNode } from "./block";
export type TwingTemplateNodeAttributes = TwingBaseNodeAttributes & {
    index: number;
    source: TwingSource;
};
export type TwingTemplateNodeChildren = {
    body: TwingBaseNode;
    blocks: TwingBaseNode<any, {}, Record<string, TwingBlockNode>>;
    macros: TwingBaseNode<any, {}, Record<string, TwingMacroNode>>;
    traits: TwingBaseNode<any, {}, Record<string, TwingTraitNode>>;
    securityCheck: TwingBaseNode;
    parent?: TwingBaseExpressionNode;
};
export interface TwingTemplateNode extends TwingBaseNode<"template", TwingTemplateNodeAttributes, TwingTemplateNodeChildren> {
    readonly embeddedTemplates: Array<TwingTemplateNode>;
}
export declare const createTemplateNode: (body: TwingTemplateNode["children"]["body"], parent: TwingBaseExpressionNode | null, blocks: TwingTemplateNode["children"]["blocks"], macros: TwingTemplateNode["children"]["macros"], traits: TwingTemplateNode["children"]["traits"], embeddedTemplates: Array<TwingTemplateNode>, source: TwingSource, line: number, column: number) => TwingTemplateNode;
