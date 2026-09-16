import { TwingBaseExpressionNode, TwingBaseExpressionNodeAttributes } from "../expression";
import { TwingBaseNode } from "../../node";
export type TwingBlockFunctionNodeAttributes = TwingBaseExpressionNodeAttributes & {
    shouldTestExistence: boolean;
};
export type TwingBlockFunctionNodeChildren = {
    name: TwingBaseNode;
    template?: TwingBaseNode;
};
export interface TwingBlockFunctionNode extends TwingBaseExpressionNode<"block_function", TwingBlockFunctionNodeAttributes, TwingBlockFunctionNodeChildren> {
}
export declare const createBlockFunctionNode: (name: TwingBaseNode, template: TwingBaseNode | null, line: number, column: number, tag?: string) => TwingBlockFunctionNode;
export declare const cloneBlockReferenceExpressionNode: (blockFunctionNode: TwingBlockFunctionNode) => TwingBlockFunctionNode;
