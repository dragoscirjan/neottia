import { TwingBaseBinaryNode } from "../binary";
export interface TwingIsNotEqualToNode extends TwingBaseBinaryNode<"is_not_equal_to"> {
}
export declare const createIsNotEqualToNode: (operands: [import("../../expression").TwingBaseExpressionNode, import("../../expression").TwingBaseExpressionNode], line: number, column: number) => TwingIsNotEqualToNode;
