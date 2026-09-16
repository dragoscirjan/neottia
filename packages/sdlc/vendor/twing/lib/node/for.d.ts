import { TwingBaseNode, TwingBaseNodeAttributes } from "../node";
import type { TwingAssignmentNode } from "./expression/assignment";
import type { TwingBaseExpressionNode } from "./expression";
export type TwingForNodeAttributes = TwingBaseNodeAttributes & {
    hasAnIf: boolean;
};
export type TwingForNodeChildren = {
    keyTarget: TwingAssignmentNode;
    valueTarget: TwingAssignmentNode;
    sequence: TwingBaseExpressionNode;
    body: TwingBaseNode;
    else?: TwingBaseNode;
};
export interface TwingForNode extends TwingBaseNode<"for", TwingForNodeAttributes, TwingForNodeChildren> {
}
export declare const createForNode: (keyTarget: TwingAssignmentNode, valueTarget: TwingAssignmentNode, sequence: TwingBaseExpressionNode, ifExpression: TwingBaseExpressionNode | null, body: TwingBaseNode, elseNode: TwingBaseNode | null, line: number, column: number, tag: string) => TwingForNode;
