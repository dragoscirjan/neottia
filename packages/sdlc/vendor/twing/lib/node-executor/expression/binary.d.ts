import type { TwingNodeExecutor, TwingSynchronousNodeExecutor } from "../../node-executor";
import type { TwingBaseBinaryNode } from "../../node/expression/binary";
export declare const executeBinaryNode: TwingNodeExecutor<TwingBaseBinaryNode<any>>;
export declare const executeBinaryNodeSynchronously: TwingSynchronousNodeExecutor<TwingBaseBinaryNode<any>>;
