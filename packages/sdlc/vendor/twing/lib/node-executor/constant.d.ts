import type { TwingNodeExecutor, TwingSynchronousNodeExecutor } from "../node-executor";
import type { TwingConstantNode } from "../node/expression/constant";
export declare const executeConstantNode: TwingNodeExecutor<TwingConstantNode>;
export declare const executeConstantNodeSynchronously: TwingSynchronousNodeExecutor<TwingConstantNode>;
