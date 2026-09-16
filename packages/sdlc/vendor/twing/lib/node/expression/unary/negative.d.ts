import { TwingBaseUnaryNode } from "../unary";
export interface TwingNegativeNode extends TwingBaseUnaryNode<"negative"> {
}
export declare const createNegativeNode: (operand: import("../../expression").TwingBaseExpressionNode, line: number, column: number) => TwingNegativeNode;
