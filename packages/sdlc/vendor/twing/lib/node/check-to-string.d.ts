import { TwingBaseNode, TwingBaseNodeAttributes } from "../node";
import { TwingBaseExpressionNode } from "./expression";
/**
 * Checks if casting an expression to toString() is allowed by the sandbox.
 *
 * For instance, when there is a simple Print statement, like {{ article }},
 * and if the sandbox is enabled, we need to check that the toString()
 * method is allowed if 'article' is an object. The same goes for {{ article|upper }}
 * or {{ random(article) }}.
 */
export interface TwingCheckToStringNode extends TwingBaseNode<"check_to_string", TwingBaseNodeAttributes, {
    value: TwingBaseExpressionNode;
}> {
}
export declare const createCheckToStringNode: (value: TwingBaseExpressionNode, line: number, column: number) => TwingCheckToStringNode;
