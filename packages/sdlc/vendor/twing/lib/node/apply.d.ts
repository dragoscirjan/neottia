import { TwingBaseNode, TwingBaseNodeAttributes } from "../node";
import { TwingArrayNode } from "./expression/array";
export type TwingApplyNodeAttributes = TwingBaseNodeAttributes & {};
export type TwingApplyNodeChildren = {
    body: TwingBaseNode;
    filters: TwingArrayNode;
};
export interface TwingApplyNode extends TwingBaseNode<"apply", TwingApplyNodeAttributes, TwingApplyNodeChildren> {
}
export declare const createApplyNode: (filters: TwingArrayNode, body: TwingBaseNode, line: number, column: number) => TwingApplyNode;
