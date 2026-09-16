/**
 * Compare by conforming to PHP loose comparisons rules
 *
 * @see http://php.net/manual/en/types.comparisons.php
 * @see https://stackoverflow.com/questions/47969711/php-algorithm-loose-equality-comparison
 */
import { DateTime } from "luxon";
import { MapLike } from "./map-like";
import { TwingMarkup } from "../markup";
type Operand = Buffer | TwingMarkup | DateTime | MapLike<any, any> | string | boolean | number | null | object | Array<any>;
export declare function compare(firstOperand: Operand, secondOperand: Operand): boolean;
export {};
