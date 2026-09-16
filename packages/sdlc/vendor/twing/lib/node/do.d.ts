import { TwingBaseNode, TwingBaseNodeAttributes } from "../node";
import type { TwingBaseExpressionNode } from "./expression";
/**
 * Represents a do node.
 *
 * The do tag works exactly like the regular variable expression ({{ ... }}) just that it doesn't print anything:
 * {% do 1 + 2 %}
 */
export interface TwingDoNode extends TwingBaseNode<"do", TwingBaseNodeAttributes, {
    body: TwingBaseExpressionNode;
}> {
}
export declare const createDoNode: (body: TwingBaseExpressionNode, line: number, column: number, tag: string | null) => TwingDoNode;
