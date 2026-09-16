import type { TwingSource } from "./source";
import { Token, TokenType } from "twig-lexer";
export interface TwingTokenStream {
    readonly current: Token;
    readonly source: TwingSource;
    /**
     * Tests a token and returns it or throws a syntax error.
     *
     * @return {Token}
     */
    expect(type: TokenType, value?: Array<string> | string | number | null, message?: string | null): Token;
    injectTokens(tokens: Array<Token>): void;
    /**
     * Checks if end of stream was reached.
     *
     * @return boolean
     */
    isEOF(): boolean;
    look(number: number): Token;
    next(): Token;
    nextIf(primary: TokenType, secondary?: Array<string> | string): Token;
    test(type: TokenType, value?: string | number | string[]): boolean;
    toAst(): Array<Token>;
}
export declare const createTokenStream: (tokens: Array<Token>, source: TwingSource) => TwingTokenStream;
