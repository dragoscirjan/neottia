import { TwingBaseNode, TwingBaseNodeAttributes } from "../node";
import { TwingArrayNode } from "./expression/array";
export declare const VARARGS_NAME = "varargs";
export type TwingMacroNodeAttributes = TwingBaseNodeAttributes & {
    name: string;
};
export interface TwingMacroNode extends TwingBaseNode<"macro", TwingMacroNodeAttributes, {
    body: TwingBaseNode;
    arguments: TwingArrayNode;
}> {
}
export declare const createMacroNode: (name: string, body: TwingBaseNode, macroArguments: TwingArrayNode, line: number, column: number, tag: string) => TwingMacroNode;
