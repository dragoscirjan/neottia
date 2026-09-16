import { TwingBaseBinaryNode } from "../binary";
export interface TwingOrNode extends TwingBaseBinaryNode<"or"> {
}
export declare const createOrNode: (operands: [import("../../expression").TwingBaseExpressionNode, import("../../expression").TwingBaseExpressionNode], line: number, column: number) => TwingOrNode;
