import { TwingBaseNode } from "../../node";
import { TwingBaseExpressionNodeAttributes } from "../expression";
export type TwingAssignmentNodeAttributes = TwingBaseExpressionNodeAttributes & {
    name: string;
};
export interface TwingAssignmentNode extends TwingBaseNode<"assignment", TwingAssignmentNodeAttributes> {
}
export declare const createAssignmentNode: (name: string, line: number, column: number) => TwingAssignmentNode;
