import { TwingBaseBinaryNode } from "../binary";
export interface TwingIsGreaterThanNode extends TwingBaseBinaryNode<"is_greater_than"> {
}
export declare const createIsGreaterThanNode: (operands: [import("../../expression").TwingBaseExpressionNode, import("../../expression").TwingBaseExpressionNode], line: number, column: number) => TwingIsGreaterThanNode;
