import { TwingNodeVisitor } from "./node-visitor";
import { TwingBaseNode } from "./node";
import type { TwingSource } from "./source";
/**
 * TwingNodeTraverser is a node traverser.
 *
 * It visits all nodes and their children and calls the registered visitors for each.
 */
export type TwingNodeTraverser = (node: TwingBaseNode, source: TwingSource) => TwingBaseNode | null;
export declare const createNodeTraverser: (visitors: Array<TwingNodeVisitor>) => TwingNodeTraverser;
