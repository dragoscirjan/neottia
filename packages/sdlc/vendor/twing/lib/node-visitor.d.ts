import type { TwingBaseNode } from "./node";
import type { TwingSource } from "./source";
/**
 * The interface that all node visitors must implement.
 */
export interface TwingNodeVisitor {
    /**
     * Called before the passed node is visited.
     *
     * @return The modified node
     */
    enterNode(node: TwingBaseNode, source: TwingSource): TwingBaseNode;
    /**
     * Called after the passed node has been visited.
     *
     * @return The modified node or null if the node must be removed from its parent
     */
    leaveNode(node: TwingBaseNode, source: TwingSource): TwingBaseNode | null;
}
/**
 * Convenient factory for TwingNodeVisitor
 */
export declare const createNodeVisitor: (enterNode: (node: TwingBaseNode, source: TwingSource) => TwingBaseNode, leaveNode: (node: TwingBaseNode, source: TwingSource) => TwingBaseNode | null) => TwingNodeVisitor;
