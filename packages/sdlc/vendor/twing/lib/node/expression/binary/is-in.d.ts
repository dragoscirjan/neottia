import { TwingBaseBinaryNode } from "../binary";
export interface TwingIsInNode extends TwingBaseBinaryNode<"is_in"> {
}
export declare const createIsInNode: (operands: [import("../../expression").TwingBaseExpressionNode, import("../../expression").TwingBaseExpressionNode], line: number, column: number) => TwingIsInNode;
