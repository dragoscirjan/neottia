import type { TwingBaseExpressionNodeAttributes } from "../expression";
import { TwingBaseNode } from "../../node";
export type TwingNameNodeAttributes = TwingBaseExpressionNodeAttributes & {
    name: string;
    isAlwaysDefined: boolean;
    shouldIgnoreStrictCheck: boolean;
    shouldTestExistence: boolean;
};
export interface TwingNameNode extends TwingBaseNode<"name", TwingNameNodeAttributes> {
}
export declare const createNameNode: (name: string, line: number, column: number) => TwingNameNode;
export declare const cloneNameNode: (nameNode: TwingNameNode) => TwingNameNode;
