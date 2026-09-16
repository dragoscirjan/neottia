import { TwingBaseBinaryNode } from "../binary";
export interface TwingHasEveryNode extends TwingBaseBinaryNode<"has_every"> {
}
export declare const createHasEveryNode: (operands: [import("../../expression").TwingBaseExpressionNode, import("../../expression").TwingBaseExpressionNode], line: number, column: number) => TwingHasEveryNode;
