import { TwingBaseExpressionNode, TwingBaseExpressionNodeAttributes } from "../expression";
import type { TwingArrayNode } from "./array";
import { TwingBaseNode } from "../../node";
export type TwingMethodCallNodeAttributes = TwingBaseExpressionNodeAttributes & {
    methodName: string;
    shouldTestExistence: boolean;
};
export interface TwingMethodCallNode extends TwingBaseExpressionNode<"method_call", TwingMethodCallNodeAttributes, {
    operand: TwingBaseNode<any, {
        name: string;
    }>;
    arguments: TwingArrayNode;
}> {
}
export declare const createMethodCallNode: (operand: TwingBaseNode<any, {
    name: string;
}>, methodName: string, methodArguments: TwingArrayNode, line: number, column: number) => TwingMethodCallNode;
export declare const cloneMethodCallNode: (methodCallNode: TwingMethodCallNode) => TwingMethodCallNode;
