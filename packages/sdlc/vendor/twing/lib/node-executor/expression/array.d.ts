import type { TwingNodeExecutor, TwingSynchronousNodeExecutor } from "../../node-executor";
import { type TwingBaseArrayNode } from "../../node/expression/array";
export declare const executeArrayNode: TwingNodeExecutor<TwingBaseArrayNode<any>>;
export declare const executeArrayNodeSynchronously: TwingSynchronousNodeExecutor<TwingBaseArrayNode<any>>;
