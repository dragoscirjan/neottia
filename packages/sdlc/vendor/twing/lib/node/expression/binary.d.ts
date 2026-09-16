import type { TwingBaseExpressionNode, TwingBaseExpressionNodeAttributes } from "../expression";
import type { TwingNodeType } from "../../node";
import type { TwingAddNode } from "./binary/add";
import type { TwingAndNode } from "./binary/and";
import type { TwingBitwiseAndNode } from "./binary/bitwise-and";
import type { TwingBitwiseOrNode } from "./binary/bitwise-or";
import type { TwingConcatenateNode } from "./binary/concatenate";
import type { TwingEndsWithNode } from "./binary/ends-with";
import type { TwingIsGreaterThanNode } from "./binary/is-greater-than";
import type { TwingIsGreaterThanOrEqualToNode } from "./binary/is-greater-than-or-equal-to";
import type { TwingBitwiseXorNode } from "./binary/bitwise-xor";
import type { TwingDivideNode } from "./binary/divide";
import type { TwingIsEqualToNode } from "./binary/is-equal-to";
import type { TwingDivideAndFloorNode } from "./binary/divide-and-floor";
import type { TwingIsInNode } from "./binary/is-in";
import type { TwingIsLessThanNode } from "./binary/is-less-than";
import type { TwingIsLessThanOrEqualToNode } from "./binary/is-less-than-or-equal-to";
import type { TwingMatchesNode } from "./binary/matches";
import type { TwingModuloNode } from "./binary/modulo";
import type { TwingMultiplyNode } from "./binary/multiply";
import type { TwingIsNotEqualToNode } from "./binary/is-not-equal-to";
import type { TwingIsNotInNode } from "./binary/is-not-in";
import type { TwingOrNode } from "./binary/or";
import type { TwingPowerNode } from "./binary/power";
import type { TwingRangeNode } from "./binary/range";
import type { TwingStartsWithNode } from "./binary/starts-with";
import type { TwingSubtractNode } from "./binary/subtract";
import type { TwingSpaceshipNode } from "./binary/spaceship";
import type { TwingHasEveryNode } from "./binary/has-every";
import type { TwingHasSomeNode } from "./binary/has-some";
export type TwingBinaryNode = TwingAddNode | TwingAndNode | TwingBitwiseAndNode | TwingBitwiseOrNode | TwingBitwiseXorNode | TwingConcatenateNode | TwingDivideNode | TwingEndsWithNode | TwingHasEveryNode | TwingHasSomeNode | TwingIsEqualToNode | TwingDivideAndFloorNode | TwingIsGreaterThanNode | TwingIsGreaterThanOrEqualToNode | TwingIsInNode | TwingIsLessThanNode | TwingIsLessThanOrEqualToNode | TwingMatchesNode | TwingModuloNode | TwingMultiplyNode | TwingIsNotEqualToNode | TwingIsNotInNode | TwingOrNode | TwingPowerNode | TwingRangeNode | TwingSpaceshipNode | TwingStartsWithNode | TwingSubtractNode;
export interface TwingBaseBinaryNode<Type extends string> extends TwingBaseExpressionNode<Type, TwingBaseExpressionNodeAttributes, {
    left: TwingBaseExpressionNode;
    right: TwingBaseExpressionNode;
}> {
}
export declare const createBaseBinaryNode: <Type extends string>(type: Type, operands: [TwingBaseExpressionNode, TwingBaseExpressionNode], line: number, column: number) => TwingBaseBinaryNode<Type>;
export declare const createBinaryNodeFactory: <InstanceType extends TwingBaseBinaryNode<any>>(type: TwingNodeType<InstanceType>) => (operands: [TwingBaseExpressionNode, TwingBaseExpressionNode], line: number, column: number) => InstanceType;
