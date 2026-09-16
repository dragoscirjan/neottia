import { TwingBaseExpressionNode } from "../expression";
export interface TwingSpreadNode extends TwingBaseExpressionNode<"spread", {}, {
    iterable: TwingBaseExpressionNode;
}> {
}
export declare const createSpreadNode: (iterable: TwingBaseExpressionNode, line: number, column: number) => TwingSpreadNode;
