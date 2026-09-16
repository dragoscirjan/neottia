import { TwingBaseUnaryNode } from "../unary";
export interface TwingPositiveNode extends TwingBaseUnaryNode<"positive"> {
}
export declare const createPositiveNode: (operand: import("../../expression").TwingBaseExpressionNode, line: number, column: number) => TwingPositiveNode;
