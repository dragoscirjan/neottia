import { TwingBaseUnaryNode } from "../unary";
export interface TwingNotNode extends TwingBaseUnaryNode<"not"> {
}
export declare const createNotNode: (operand: import("../../expression").TwingBaseExpressionNode, line: number, column: number) => TwingNotNode;
