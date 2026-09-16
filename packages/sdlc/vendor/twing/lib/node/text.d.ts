import { TwingBaseNodeAttributes, TwingBaseNode } from "../node";
export type TwingBaseTextNodeAttributes = TwingBaseNodeAttributes & {
    data: string;
};
export interface TwingBaseTextNode<Type extends string> extends TwingBaseNode<Type, TwingBaseTextNodeAttributes> {
}
export interface TwingTextNode extends TwingBaseTextNode<"text"> {
}
export declare const createBaseTextNode: <Type extends string>(type: Type, data: string, line: number, column: number, tag?: string | null) => TwingBaseTextNode<Type>;
export declare const createTextNode: (data: string, line: number, column: number) => TwingTextNode;
