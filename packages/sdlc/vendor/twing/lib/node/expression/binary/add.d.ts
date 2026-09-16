import type { TwingBaseBinaryNode } from "../binary";
export interface TwingAddNode extends TwingBaseBinaryNode<"add"> {
}
export declare const createAddNode: (operands: [import("../../expression").TwingBaseExpressionNode, import("../../expression").TwingBaseExpressionNode], line: number, column: number) => TwingAddNode;
