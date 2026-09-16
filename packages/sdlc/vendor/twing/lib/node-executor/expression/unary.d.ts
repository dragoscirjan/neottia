import type { TwingNodeExecutor, TwingSynchronousNodeExecutor } from "../../node-executor";
import type { TwingBaseUnaryNode } from "../../node/expression/unary";
export declare const executeUnaryNode: TwingNodeExecutor<TwingBaseUnaryNode<any>>;
export declare const executeUnaryNodeSynchronously: TwingSynchronousNodeExecutor<TwingBaseUnaryNode<any>>;
