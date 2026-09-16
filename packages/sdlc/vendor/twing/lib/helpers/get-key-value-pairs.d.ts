import type { TwingBaseArrayNode } from "../node/expression/array";
import { TwingConstantNode } from "../node/expression/constant";
import { TwingBaseExpressionNode } from "../node/expression";
export declare const getKeyValuePairs: (node: TwingBaseArrayNode<any>) => Array<{
    key: TwingConstantNode;
    value: TwingBaseExpressionNode;
}>;
