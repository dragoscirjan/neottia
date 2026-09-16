import { TwingBaseBinaryNode } from "../binary";
export interface TwingEndsWithNode extends TwingBaseBinaryNode<"ends_with"> {
}
export declare const createEndsWithNode: (operands: [import("../../expression").TwingBaseExpressionNode, import("../../expression").TwingBaseExpressionNode], line: number, column: number) => TwingEndsWithNode;
