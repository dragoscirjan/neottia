import { TwingBaseExpressionNode, TwingBaseExpressionNodeAttributes } from "../expression";
export interface TwingBaseArrayNode<Type extends string> extends TwingBaseExpressionNode<Type, TwingBaseExpressionNodeAttributes, Record<number, TwingBaseExpressionNode>> {
}
export interface TwingArrayNode extends TwingBaseArrayNode<"array"> {
}
export declare const createBaseArrayNode: <Type extends string>(type: Type, elements: Array<{
    key: TwingBaseExpressionNode;
    value: TwingBaseExpressionNode;
}>, line: number, column: number) => TwingBaseArrayNode<Type>;
export declare const createArrayNode: (elements: Array<{
    key?: TwingBaseExpressionNode;
    value: TwingBaseExpressionNode;
}>, line: number, column: number) => TwingArrayNode;
