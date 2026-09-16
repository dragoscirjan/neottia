import { TwingCallableWrapperOptions, TwingCallableArgument, TwingCallable, TwingCallableWrapper, TwingSynchronousCallableWrapper, TwingSynchronousCallable } from "./callable-wrapper";
export type TwingFilterOptions = TwingCallableWrapperOptions;
export interface TwingFilter extends TwingCallableWrapper {
}
export interface TwingSynchronousFilter extends TwingSynchronousCallableWrapper {
}
export declare const createFilter: (name: string, callable: TwingCallable, acceptedArguments: TwingCallableArgument[], options?: TwingFilterOptions) => TwingFilter;
export declare const createSynchronousFilter: (name: string, callable: TwingSynchronousCallable, acceptedArguments: TwingCallableArgument[], options?: TwingFilterOptions) => TwingSynchronousFilter;
