import { TwingBaseNode, TwingBaseNodeAttributes, TwingNode } from "../node";
export type TwingCheckSecurityNodeAttributes = TwingBaseNodeAttributes & {
    usedFilters: Map<string, TwingNode>;
    usedTags: Map<string, TwingNode>;
    usedFunctions: Map<string, TwingNode>;
};
export interface TwingCheckSecurityNode extends TwingBaseNode<"check_security", TwingCheckSecurityNodeAttributes> {
}
export declare const createCheckSecurityNode: (usedFilters: Map<string, TwingNode>, usedTags: Map<string, TwingNode>, usedFunctions: Map<string, TwingNode>, line: number, column: number) => TwingCheckSecurityNode;
