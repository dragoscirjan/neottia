import { TwingBaseCallNode } from "../call";
import type { TwingArrayNode } from "../array";
export interface TwingFunctionNode extends TwingBaseCallNode<"function"> {
}
export declare const createFunctionNode: (functionName: string, functionArguments: TwingArrayNode, line: number, column: number) => TwingFunctionNode;
