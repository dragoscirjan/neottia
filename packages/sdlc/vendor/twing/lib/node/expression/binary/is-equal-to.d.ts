import { TwingBaseBinaryNode } from "../binary";
export interface TwingIsEqualToNode extends TwingBaseBinaryNode<"is_equal_to"> {
}
export declare const createIsEqualNode: (operands: [import("../../expression").TwingBaseExpressionNode, import("../../expression").TwingBaseExpressionNode], line: number, column: number) => TwingIsEqualToNode;
