import { TwingBaseNode, TwingBaseNodeAttributes } from "../node";
import { TwingBaseExpressionNode } from "./expression";
export interface TwingDeprecatedNode extends TwingBaseNode<"deprecated", TwingBaseNodeAttributes, {
    message: TwingBaseExpressionNode;
}> {
}
export declare const createDeprecatedNode: (message: TwingBaseExpressionNode, line: number, column: number, tag: string) => TwingDeprecatedNode;
