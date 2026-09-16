import { TwingBaseNode } from "../../../node";
import { TwingBaseCallNode } from "../call";
import type { TwingArrayNode } from "../array";
export interface TwingFilterNode extends TwingBaseCallNode<"filter"> {
}
export declare const createFilterNode: (operand: TwingBaseNode, filterName: string, filterArguments: TwingArrayNode, line: number, column: number) => TwingFilterNode;
