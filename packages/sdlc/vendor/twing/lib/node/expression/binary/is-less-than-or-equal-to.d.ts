import { TwingBaseBinaryNode } from "../binary";
export interface TwingIsLessThanOrEqualToNode extends TwingBaseBinaryNode<"is_less_than_or_equal_to"> {
}
export declare const createIsLessThanOrEqualToNode: (operands: [import("../../expression").TwingBaseExpressionNode, import("../../expression").TwingBaseExpressionNode], line: number, column: number) => TwingIsLessThanOrEqualToNode;
