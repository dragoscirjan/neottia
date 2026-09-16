import { TwingBaseNode, TwingBaseNodeAttributes } from "../node";
export type TwingSetNodeAttributes = TwingBaseNodeAttributes & {
    captures: boolean;
};
export interface TwingSetNode extends TwingBaseNode<"set", TwingSetNodeAttributes, {
    names: TwingBaseNode;
    values: TwingBaseNode;
}> {
}
export declare const createSetNode: (captures: boolean, names: TwingSetNode["children"]["names"], values: TwingSetNode["children"]["values"], line: number, column: number, tag: string) => TwingSetNode;
