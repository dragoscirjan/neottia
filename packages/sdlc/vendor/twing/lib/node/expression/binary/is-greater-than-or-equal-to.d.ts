import { TwingBaseBinaryNode } from "../binary";
export interface TwingIsGreaterThanOrEqualToNode extends TwingBaseBinaryNode<"is_greater_than_or_equal_to"> {
}
export declare const createIsGreaterThanOrEqualToNode: (operands: [import("../../expression").TwingBaseExpressionNode, import("../../expression").TwingBaseExpressionNode], line: number, column: number) => TwingIsGreaterThanOrEqualToNode;
