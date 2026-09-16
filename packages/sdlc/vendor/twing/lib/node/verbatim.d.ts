import { TwingBaseTextNode } from "./text";
/**
 * Represents a verbatim node.
 */
export interface TwingVerbatimNode extends TwingBaseTextNode<"verbatim"> {
}
export declare const createVerbatimNode: (data: string, line: number, column: number, tag: string) => TwingVerbatimNode;
