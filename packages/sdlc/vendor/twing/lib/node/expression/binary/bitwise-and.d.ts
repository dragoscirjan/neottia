import { TwingBaseBinaryNode } from "../binary";
export interface TwingBitwiseAndNode extends TwingBaseBinaryNode<"bitwise_and"> {
}
export declare const createBitwiseAndNode: (operands: [import("../../expression").TwingBaseExpressionNode, import("../../expression").TwingBaseExpressionNode], line: number, column: number) => TwingBitwiseAndNode;
