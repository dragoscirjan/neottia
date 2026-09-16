import { TwingCallableWrapperOptions, TwingCallableArgument, TwingCallable, TwingCallableWrapper, TwingSynchronousCallableWrapper, TwingSynchronousCallable } from "./callable-wrapper";
export interface TwingFunction extends TwingCallableWrapper {
}
export interface TwingSynchronousFunction extends TwingSynchronousCallableWrapper {
}
export declare const createFunction: (name: string, callable: TwingCallable, acceptedArguments: TwingCallableArgument[], options?: TwingCallableWrapperOptions) => TwingFunction;
export declare const createSynchronousFunction: (name: string, callable: TwingSynchronousCallable, acceptedArguments: TwingCallableArgument[], options?: TwingCallableWrapperOptions) => TwingSynchronousFunction;
