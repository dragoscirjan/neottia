import { TwingBaseArrayNode } from "./array";
import type { TwingBaseExpressionNode } from "../expression";
export interface TwingHashNode extends TwingBaseArrayNode<"hash"> {
}
export declare const createHashNode: (elements: Array<{
    key: TwingBaseExpressionNode;
    value: TwingBaseExpressionNode;
}>, line: number, column: number) => TwingHashNode;
