import type { TwingNodeExecutor, TwingSynchronousNodeExecutor } from "../node-executor";
import type { TwingImportNode } from "../node/import";
export declare const executeImportNode: TwingNodeExecutor<TwingImportNode>;
export declare const executeImportNodeSynchronously: TwingSynchronousNodeExecutor<TwingImportNode>;
