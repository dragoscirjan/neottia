import type { TwingBaseBinaryNode } from "../binary";
export interface TwingAndNode extends TwingBaseBinaryNode<"and"> {
}
export declare const createAndNode: (operands: [import("../../expression").TwingBaseExpressionNode, import("../../expression").TwingBaseExpressionNode], line: number, column: number) => TwingAndNode;
