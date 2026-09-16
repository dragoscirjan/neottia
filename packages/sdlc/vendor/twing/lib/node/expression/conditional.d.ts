import { TwingBaseExpressionNode, TwingBaseExpressionNodeAttributes } from "../expression";
import { TwingBaseNode } from "../../node";
export interface TwingBaseConditionalNode<Type extends string> extends TwingBaseExpressionNode<Type, TwingBaseExpressionNodeAttributes, {
    expr1: TwingBaseNode;
    expr2: TwingBaseNode;
    expr3: TwingBaseNode;
}> {
}
export interface TwingConditionalNode extends TwingBaseConditionalNode<"conditional"> {
}
export declare const createBaseConditionalNode: <Type extends string>(type: Type, expr1: TwingBaseNode, expr2: TwingBaseNode, expr3: TwingBaseNode, line: number, column: number) => TwingBaseConditionalNode<Type>;
export declare const createConditionalNode: (expr1: TwingBaseNode, expr2: TwingBaseNode, expr3: TwingBaseNode, line: number, column: number) => TwingBaseConditionalNode<"conditional">;
