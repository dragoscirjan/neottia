import { TwingBaseBinaryNode } from "../binary";
export interface TwingMultiplyNode extends TwingBaseBinaryNode<"multiply"> {
}
export declare const createMultiplyNode: (operands: [import("../../expression").TwingBaseExpressionNode, import("../../expression").TwingBaseExpressionNode], line: number, column: number) => TwingMultiplyNode;
