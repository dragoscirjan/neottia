import { TwingBaseConditionalNode } from "./conditional";
import { TwingExpressionNode } from "../expression";
export interface TwingNullishCoalescingNode extends TwingBaseConditionalNode<"nullish_coalescing"> {
}
export declare const createNullishCoalescingNode: (operands: [TwingExpressionNode, TwingExpressionNode], line: number, column: number) => TwingNullishCoalescingNode;
