/**
 * Lexes a template string.
 */
import { Lexer, TokenType } from "twig-lexer";
import { TwingTokenStream } from "./token-stream";
import type { TwingOperator } from "./operator";
import type { TwingSource } from "./source";
export declare const typeToEnglish: (type: TokenType) => string;
export declare class TwingLexer extends Lexer {
    constructor(level: 2 | 3, binaryOperators: Array<TwingOperator>, unaryOperators: Array<TwingOperator>);
    tokenizeSource(source: TwingSource): TwingTokenStream;
}
export declare const createLexer: (level: 2 | 3, binaryOperators: Array<TwingOperator>, unaryOperators: Array<TwingOperator>) => TwingLexer;
