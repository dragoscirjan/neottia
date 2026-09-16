import type { TwingBaseBinaryNode } from "../binary";
export interface TwingConcatenateNode extends TwingBaseBinaryNode<"concatenate"> {
}
export declare const createConcatenateNode: (operands: [import("../../expression").TwingBaseExpressionNode, import("../../expression").TwingBaseExpressionNode], line: number, column: number) => TwingConcatenateNode;
