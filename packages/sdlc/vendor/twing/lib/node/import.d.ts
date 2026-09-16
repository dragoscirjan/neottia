import { TwingBaseNode, TwingBaseNodeAttributes } from "../node";
import type { TwingBaseExpressionNode, TwingExpressionNode } from "./expression";
import type { TwingAssignmentNode } from "./expression/assignment";
export type TwingImportNodeAttributes = TwingBaseNodeAttributes & {
    global: boolean;
};
export interface TwingImportNode extends TwingBaseNode<"import", TwingImportNodeAttributes, {
    templateName: TwingBaseExpressionNode;
    alias: TwingAssignmentNode;
}> {
}
export declare const createImportNode: (templateName: TwingExpressionNode, alias: TwingAssignmentNode, global: boolean, line: number, column: number, tag: string) => TwingImportNode;
