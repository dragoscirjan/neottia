import { TwingBaseBinaryNode } from "../binary";
export interface TwingSubtractNode extends TwingBaseBinaryNode<"subtract"> {
}
export declare const createSubtractNode: (operands: [import("../../expression").TwingBaseExpressionNode, import("../../expression").TwingBaseExpressionNode], line: number, column: number) => TwingSubtractNode;
