import type { TwingNodeExecutor, TwingSynchronousNodeExecutor } from "../../node-executor";
import type { TwingAssignmentNode } from "../../node/expression/assignment";
export declare const executeAssignmentNode: TwingNodeExecutor<TwingAssignmentNode>;
export declare const executeAssignmentNodeSynchronously: TwingSynchronousNodeExecutor<TwingAssignmentNode>;
