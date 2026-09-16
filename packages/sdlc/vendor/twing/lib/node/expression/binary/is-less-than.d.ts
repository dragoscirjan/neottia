import { TwingBaseBinaryNode } from "../binary";
export interface TwingIsLessThanNode extends TwingBaseBinaryNode<"is_less_than"> {
}
export declare const createIsLessThanNode: (operands: [import("../../expression").TwingBaseExpressionNode, import("../../expression").TwingBaseExpressionNode], line: number, column: number) => TwingIsLessThanNode;
