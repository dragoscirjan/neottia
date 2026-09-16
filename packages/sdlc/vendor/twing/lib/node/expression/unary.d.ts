import { TwingBaseExpressionNode, TwingBaseExpressionNodeAttributes } from "../expression";
import type { TwingNodeType } from "../../node";
import type { TwingNegativeNode } from "./unary/negative";
import type { TwingNotNode } from "./unary/not";
import type { TwingPositiveNode } from "./unary/positive";
export type TwingUnaryNode = TwingNegativeNode | TwingNotNode | TwingPositiveNode;
export interface TwingBaseUnaryNode<Type extends string> extends TwingBaseExpressionNode<Type, TwingBaseExpressionNodeAttributes, {
    operand: TwingBaseExpressionNode;
}> {
}
export declare const createUnaryNodeFactory: <InstanceType extends TwingBaseUnaryNode<any>>(type: TwingNodeType<InstanceType>) => (operand: TwingBaseExpressionNode, line: number, column: number) => InstanceType;
export declare const createBaseUnaryNode: <Type extends string>(type: Type, operand: TwingBaseExpressionNode, line: number, column: number) => TwingBaseUnaryNode<Type>;
