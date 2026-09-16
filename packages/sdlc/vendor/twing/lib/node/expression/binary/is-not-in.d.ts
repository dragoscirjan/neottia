import { TwingBaseBinaryNode } from "../binary";
export interface TwingIsNotInNode extends TwingBaseBinaryNode<"is_not_in"> {
}
export declare const createIsNotInNode: (operands: [import("../../expression").TwingBaseExpressionNode, import("../../expression").TwingBaseExpressionNode], line: number, column: number) => TwingIsNotInNode;
