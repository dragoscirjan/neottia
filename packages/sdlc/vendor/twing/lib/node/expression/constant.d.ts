import type { TwingBaseExpressionNode } from "../expression";
export type TwingConstantNodeValue = string | number | boolean | null;
export type TwingConstantNodeAttributes<Value extends TwingConstantNodeValue> = {
    value: Value;
};
export interface TwingConstantNode<Value extends TwingConstantNodeValue = TwingConstantNodeValue> extends TwingBaseExpressionNode<"constant", TwingConstantNodeAttributes<Value>> {
}
export declare const createConstantNode: <Value extends string | number | boolean | null>(value: Value, line: number, column: number) => TwingConstantNode<Value>;
